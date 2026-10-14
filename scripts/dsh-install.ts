// Manage only the Habblaud local bundle in a DSH profile. DSH itself performs
// package installation and appends the bundle layer; this script backs up its
// potentially edited profile files and never reads credentials or session data.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = scriptDir.endsWith(`${join('dist', 'scripts')}`) ? resolve(scriptDir, '..', '..') : resolve(scriptDir, '..');
const bundleName = 'habblaud-dsh-bridge';
const componentId = 'habblaud-native-bridge';
const profileFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'] as const;

export interface DshInstallOptions {
  profile: string;
  dshHome: string;
  dshBin?: string;
  rootDir?: string;
}

function projectRoot(options: DshInstallOptions): string { return resolve(options.rootDir ?? sourceRoot); }
function bundleDir(options: DshInstallOptions): string { return join(projectRoot(options), 'integrations', 'dsh'); }
function expectedVersion(options: DshInstallOptions): string | undefined {
  const manifest = JSON.parse(readFileSync(join(bundleDir(options), 'package.json'), 'utf8')) as {
    name?: string; peerDependencies?: Record<string, string>;
  };
  if (manifest.name !== bundleName) throw new Error('Invalid local Habblaud DSH bundle');
  return manifest.peerDependencies?.['@deepseek-ai/dsh'];
}

interface Manifest {
  dependencies?: Record<string, string>;
  dsh?: { profile?: { bundles?: string[] } };
}

export interface DshInstallStatus {
  profileDir: string;
  dependency?: string;
  enabled: boolean;
  localSource: boolean;
}

function validProfile(profile: string): void {
  if (!/^[a-z][a-z0-9_-]*$/i.test(profile) || ['desktop', 'node_modules'].includes(profile.toLowerCase())) {
    throw new Error('Invalid DSH profile name');
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function checkedProfileDir(options: DshInstallOptions): string {
  const home = resolve(options.dshHome);
  const profiles = join(home, 'profiles');
  const profileDir = join(profiles, options.profile);
  for (const dir of [home, profiles, profileDir]) {
    const stat = lstatIfPresent(dir);
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe DSH profile path');
  }
  return profileDir;
}

function readManifest(path: string): Manifest | undefined {
  const stat = lstatIfPresent(path);
  if (!stat) return undefined;
  if (!stat.isFile()) throw new Error('DSH profile package.json is not a regular file');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid DSH profile package.json');
  const manifest = parsed as Manifest;
  if (manifest.dependencies !== undefined && (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies))) {
    throw new Error('Invalid DSH profile dependencies');
  }
  if (manifest.dependencies && Object.values(manifest.dependencies).some((value) => typeof value !== 'string')) {
    throw new Error('Invalid DSH profile dependency source');
  }
  const bundles = manifest.dsh?.profile?.bundles;
  if (bundles !== undefined && (!Array.isArray(bundles) || bundles.some((name) => typeof name !== 'string'))) {
    throw new Error('Invalid DSH profile bundles');
  }
  return manifest;
}

function sameLocalSource(spec: string | undefined, profileDir: string, expectedDir: string): boolean {
  if (!spec || !/^(?:file|link):/.test(spec)) return false;
  const path = spec.replace(/^(?:file|link):/, '');
  return resolve(profileDir, path) === expectedDir;
}

function regularFile(path: string): boolean {
  try { return lstatSync(path).isFile(); } catch { return false; }
}

function yamlLibrary(bin?: string): {
  parseDocument: (source: string, options?: object) => any;
  isSeq: (value: unknown) => boolean;
  isMap: (value: unknown) => boolean;
} {
  // The DSH CLI already depends on yaml. Resolve from its own installation,
  // then from the development checkout used by isolated tests.
  let resolvedBin: string | undefined;
  if (bin) try { resolvedBin = realpathSync(bin); } catch { /* PATH command: use the development fallback. */ }
  const origins = [resolvedBin, fileURLToPath(import.meta.url)].filter((value): value is string => Boolean(value));
  for (const origin of origins) {
    try { return createRequire(origin)('yaml'); } catch { /* Try next origin. */ }
  }
  throw new Error('DSH YAML parser unavailable');
}

function componentEnabled(profileDir: string, bin?: string): boolean {
  const file = join(profileDir, 'cordis.patch.yml');
  const stat = lstatIfPresent(file);
  if (!stat) return true;
  if (!stat.isFile()) throw new Error('DSH profile patch is not a regular file');
  const yaml = yamlLibrary(bin);
  const document = yaml.parseDocument(readFileSync(file, 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: unknown) => value }],
  });
  if (document.errors[0] || !yaml.isSeq(document.contents)) throw new Error('Invalid DSH profile patch');
  let enabled = true;
  for (let i = 0; i < document.contents.items.length; i++) {
    const item = document.contents.items[i];
    if (!yaml.isMap(item) || document.getIn([i, 'id']) !== componentId || item.has('insert')) continue;
    const name = document.getIn([i, 'name']);
    if (name === undefined || name === bundleName) enabled = document.getIn([i, 'disabled']) !== true;
  }
  return enabled;
}

export function status(options: DshInstallOptions): DshInstallStatus {
  validProfile(options.profile);
  const profileDir = checkedProfileDir(options);
  const manifest = readManifest(join(profileDir, 'package.json'));
  const dependency = manifest?.dependencies?.[bundleName];
  const selected = manifest?.dsh?.profile?.bundles?.includes(bundleName) === true;
  return {
    profileDir,
    ...(dependency ? { dependency } : {}),
    enabled: selected && componentEnabled(profileDir, options.dshBin),
    localSource: sameLocalSource(dependency, profileDir, bundleDir(options)),
  };
}

function executable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

/** Prefer an explicit executable/PATH. A version-matching npx cache is a local fallback, never a fixed user path. */
export function findDshBin(explicit?: string, options?: DshInstallOptions): string {
  if (explicit) {
    if (explicit.includes('/') && !executable(explicit)) throw new Error(`DSH CLI is not executable: ${explicit}`);
    return explicit;
  }
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const path = join(dir, 'dsh');
    if (executable(path)) return path;
  }
  const cache = process.env.npm_config_cache ?? join(homedir(), '.npm');
  const npx = join(cache, '_npx');
  const candidates: Array<{ bin: string; mtime: number }> = [];
  if (existsSync(npx)) for (const dir of readdirSync(npx)) {
    const install = join(npx, dir, 'node_modules');
    const bin = join(install, '.bin', 'dsh');
    const packageFile = join(install, '@deepseek-ai', 'dsh', 'package.json');
    if (!executable(bin) || !existsSync(packageFile)) continue;
    try {
      const version = (JSON.parse(readFileSync(packageFile, 'utf8')) as { version?: string }).version;
      if (version === (options ? expectedVersion(options) : undefined)) candidates.push({ bin, mtime: statSync(packageFile).mtimeMs });
    } catch { /* Ignore an incomplete cache install. */ }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  if (candidates[0]) return candidates[0].bin;
  throw new Error('DSH CLI not found; pass --dsh <executable> or set HABBLAUD_DSH_BIN');
}

function backupFiles(profileDir: string): string[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backups: string[] = [];
  for (const name of profileFiles) {
    const file = join(profileDir, name);
    const stat = lstatIfPresent(file);
    if (!stat) continue;
    if (!stat.isFile()) throw new Error(`Refusing to edit non-file DSH profile entry: ${name}`);
    let backup = `${file}.habblaud-backup-${stamp}`;
    let ordinal = 1;
    while (existsSync(backup)) backup = `${file}.habblaud-backup-${stamp}-${ordinal++}`;
    copyFileSync(file, backup);
    backups.push(backup);
  }
  return backups;
}

function backupPrivate(file: string): string {
  const backup = `${file}.habblaud-backup-${Date.now()}-${process.pid}`;
  copyFileSync(file, backup);
  chmodSync(backup, 0o600);
  return backup;
}

function writeAtomic(file: string, content: string, mode = 0o600): void {
  const temp = `${file}.habblaud-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temp, content, { flag: 'wx', mode });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) rmSync(temp);
  }
}

/** Explicitly enable only our bundle and component in an existing local install. */
function enableOwned(options: DshInstallOptions, bin: string): string[] {
  const profileDir = checkedProfileDir(options);
  const file = join(profileDir, 'package.json');
  const manifest = readManifest(file);
  if (!manifest?.dependencies?.[bundleName] || !sameLocalSource(manifest.dependencies[bundleName], profileDir, bundleDir(options))) {
    throw new Error('This profile uses a different habblaud-dsh-bridge package; no files changed');
  }
  const backups: string[] = [];
  const bundles = manifest.dsh?.profile?.bundles;
  if (!bundles) throw new Error('Invalid DSH profile bundles');
  // Validate the patch before changing the bundle selection, so malformed
  // user configuration cannot leave a half-enabled install.
  const patch = join(profileDir, 'cordis.patch.yml');
  const patchStat = lstatIfPresent(patch);
  if (patchStat && !patchStat.isFile()) throw new Error('DSH profile patch is not a regular file');
  const yaml = yamlLibrary(bin);
  const document = yaml.parseDocument(patchStat ? readFileSync(patch, 'utf8') : '[]\n', {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: unknown) => value }],
  });
  if (document.errors[0] || !yaml.isSeq(document.contents)) throw new Error('Invalid DSH profile patch');
  let target = -1;
  for (let i = 0; i < document.contents.items.length; i++) {
    const item = document.contents.items[i];
    if (!yaml.isMap(item) || document.getIn([i, 'id']) !== componentId || item.has('insert')) continue;
    const name = document.getIn([i, 'name']);
    if (name === undefined || name === bundleName) target = i;
  }
  const patchNeedsEnable = target >= 0 && document.getIn([target, 'disabled']) === true;
  if (!bundles.includes(bundleName)) {
    backups.push(backupPrivate(file));
    bundles.push(bundleName);
    writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`, statSync(file).mode & 0o777);
  }
  if (!patchNeedsEnable) return backups;
  if (patchStat) backups.push(backupPrivate(patch));
  if (target >= 0) document.setIn([target, 'disabled'], false);
  else document.add({ id: componentId, disabled: false });
  writeAtomic(patch, String(document));
  return backups;
}

/** Opt-in path used by Habblaud's Connect DSH button. */
export function connect(options: DshInstallOptions): { changed: boolean; backups: string[]; status: DshInstallStatus } {
  const before = status(options);
  if (before.dependency && !before.localSource) throw new Error('This profile already uses a different habblaud-dsh-bridge package; no files changed');
  if (!existsSync(join(bundleDir(options), 'dist', 'index.js'))) throw new Error('Build integrations first (npm run build:integrations)');
  const bin = findDshBin(options.dshBin, options);
  const backups = before.dependency ? [] : installInternal({ ...options, dshBin: bin }, true).backups;
  backups.push(...enableOwned(options, bin));
  const after = status({ ...options, dshBin: bin });
  if (!after.dependency || !after.localSource || !after.enabled) throw new Error('DSH bundle was not enabled');
  return { changed: backups.length > 0 || !before.dependency, backups, status: after };
}

/** Only clear this bundle's orphaned selection; leave other dependencies and profile fields intact. */
function clearOrphanBundle(profileDir: string): void {
  const file = join(profileDir, 'package.json');
  const manifest = readManifest(file);
  if (!manifest || manifest.dependencies?.[bundleName]) throw new Error('Refusing to edit a DSH profile that still has the Habblaud dependency');
  const bundles = manifest.dsh?.profile?.bundles;
  if (!bundles?.includes(bundleName)) return;
  manifest.dsh!.profile!.bundles = bundles.filter((name) => name !== bundleName);
  const temp = `${file}.habblaud-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: statSync(file).mode & 0o777 });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) rmSync(temp);
  }
}

/** Invoke the installed DSH 0.2.0-rc.2 plugin manager with a local absolute path. */
function installInternal(options: DshInstallOptions, allowDisabled: boolean): { changed: boolean; backups: string[]; status: DshInstallStatus } {
  const before = status(options);
  if (!existsSync(join(bundleDir(options), 'dist', 'index.js'))) throw new Error('Build integrations first (npm run build:integrations)');
  if (before.dependency) {
    if (!before.localSource) throw new Error('This profile already uses a different habblaud-dsh-bridge package; no files changed');
    if (!before.enabled) throw new Error('The Habblaud bundle is installed but disabled; enable it in the DSH plugin manager');
    return { changed: false, backups: [], status: before };
  }
  if (before.enabled) throw new Error('The profile selects the Habblaud bundle without a dependency; no files changed');
  const bin = findDshBin(options.dshBin, options);
  const backups = backupFiles(before.profileDir);
  const child = spawnSync(bin, ['plugin', '--profile', options.profile, 'add', bundleDir(options)], {
    cwd: projectRoot(options),
    env: { ...process.env, DSH_HOME: resolve(options.dshHome) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    throw new Error(`DSH plugin add failed (exit ${child.status ?? 'unknown'}); profile backups: ${backups.length}. Check DSH diagnostics locally.`);
  }
  const after = status({ ...options, dshBin: bin });
  if (!after.dependency || (!allowDisabled && !after.enabled) || !after.localSource) {
    throw new Error(`DSH plugin add exited successfully without enabling the local bundle; profile backups: ${backups.length}`);
  }
  return { changed: true, backups, status: after };
}

export function install(options: DshInstallOptions): { changed: boolean; backups: string[]; status: DshInstallStatus } {
  return installInternal(options, false);
}

/** Remove only the local Habblaud package via DSH's own profile manager. */
export function uninstall(options: DshInstallOptions): { changed: boolean; backups: string[]; status: DshInstallStatus } {
  const before = status(options);
  if (before.dependency && !before.localSource) {
    throw new Error('This profile uses a different habblaud-dsh-bridge package; no files changed');
  }
  if (!before.dependency && !before.enabled) return { changed: false, backups: [], status: before };
  const bin = before.dependency ? findDshBin(options.dshBin, options) : undefined;
  const backups = backupFiles(before.profileDir);
  if (before.dependency) {
    const child = spawnSync(bin!, ['plugin', '--profile', options.profile, 'remove', bundleName], {
      cwd: projectRoot(options),
      env: { ...process.env, DSH_HOME: resolve(options.dshHome) },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
    });
    if (child.error || child.status !== 0) {
      throw new Error(`DSH plugin remove failed (exit ${child.status ?? 'unknown'}); profile backups: ${backups.length}. Check DSH diagnostics locally.`);
    }
  }
  const afterNative = status(options);
  if (afterNative.dependency) {
    throw new Error(`DSH plugin remove exited without removing the Habblaud dependency; profile backups: ${backups.length}`);
  }
  if (afterNative.enabled) clearOrphanBundle(afterNative.profileDir);
  const after = status(options);
  if (after.dependency || after.enabled) {
    throw new Error(`DSH profile still selects the Habblaud bundle; profile backups: ${backups.length}`);
  }
  return { changed: true, backups, status: after };
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { command: 'install' | 'uninstall' | 'status' | 'connect'; options: DshInstallOptions } {
  const [command = 'status', ...args] = argv;
  if (command !== 'install' && command !== 'uninstall' && command !== 'status' && command !== 'connect') throw new Error('Usage: dsh-install.ts install|uninstall|status|connect [--profile web] [--dsh <executable>] [--dsh-home <directory>]');
  const options: DshInstallOptions = { profile: 'web', dshHome: env.DSH_HOME ?? join(homedir(), '.dsh'), dshBin: env.HABBLAUD_DSH_BIN };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--profile') options.profile = value;
    else if (flag === '--dsh') options.dshBin = value;
    else if (flag === '--dsh-home') options.dshHome = value;
    else if (flag === '--root') options.rootDir = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  validProfile(options.profile);
  if (!isAbsolute(options.dshHome)) options.dshHome = resolve(options.dshHome);
  if (options.rootDir && !isAbsolute(options.rootDir)) options.rootDir = resolve(options.rootDir);
  return { command, options };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    if (command === 'connect') {
      const result = connect(options);
      process.stdout.write(`DSH profile ${options.profile}: Habblaud bundle enabled; ${result.backups.length} profile file backups saved.\n`);
    } else if (command === 'install') {
      const result = install(options);
      process.stdout.write(result.changed
        ? `DSH profile ${options.profile}: Habblaud bundle installed; ${result.backups.length} profile file backups saved.\n`
        : `DSH profile ${options.profile}: Habblaud bundle already installed.\n`);
    } else if (command === 'uninstall') {
      const result = uninstall(options);
      process.stdout.write(result.changed
        ? `DSH profile ${options.profile}: Habblaud bundle removed; ${result.backups.length} profile file backups saved.\n`
        : `DSH profile ${options.profile}: Habblaud bundle was not installed.\n`);
    } else {
      const result = status(options);
      process.stdout.write(`DSH profile ${options.profile}: ${!result.dependency ? 'not installed' : result.enabled ? 'installed and enabled' : 'installed but disabled'}${result.dependency && !result.localSource ? ' (different source)' : ''}.\n`);
    }
  } catch (error) {
    process.stderr.write(`DSH installation: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}
