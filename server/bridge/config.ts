import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BRIDGE_VERSION, type BridgeConnectionConfig } from '../../shared/native-bridge';

function privateDirectory(path: string, owned = false): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('桥接配置目录必须是真实目录');
  if (owned) chmodSync(path, 0o700);
}

/** The address embedded in native clients may only point at this machine. */
export function localBridgeUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('桥接地址无效'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || !url.port || url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      (host !== 'localhost' && host !== '::1' && !/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host))) {
    throw new Error('桥接地址必须是带端口的本机 HTTP 地址');
  }
  return url.origin;
}

function existing(path: string): BridgeConnectionConfig | undefined {
  let fd: number | undefined;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('桥接配置文件必须是普通文件');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!fstatSync(fd).isFile() || fstatSync(fd).size > 8192) throw new Error('桥接配置文件无效');
    const value = JSON.parse(readFileSync(fd, 'utf8')) as Partial<BridgeConnectionConfig>;
    if (value.version !== BRIDGE_VERSION || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(value.token)) return undefined;
    return { version: BRIDGE_VERSION, url: '', token: value.token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Persist a loopback bridge token without following an existing symlink or exposing it in logs. */
export function ensureBridgeConfig(dataDir: string, rawUrl: string, configFile = process.env.HABBLAUD_BRIDGE_CONFIG ?? join(dataDir, 'bridge.json')): BridgeConnectionConfig {
  const url = localBridgeUrl(rawUrl);
  privateDirectory(dataDir, true);
  privateDirectory(dirname(configFile));
  const previous = existing(configFile);
  const result: BridgeConnectionConfig = { version: BRIDGE_VERSION, url, token: previous?.token ?? randomBytes(32).toString('base64url') };
  const tmp = `${configFile}.${randomBytes(8).toString('hex')}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, JSON.stringify(result), 'utf8');
    closeSync(fd);
    fd = undefined;
    // Existing target was inspected before this rename; rename replaces a link rather than following it.
    renameSync(tmp, configFile);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }
  return result;
}
