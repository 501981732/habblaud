import { spawn } from 'node:child_process';
import { constants, accessSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DshSetupError, DshSetupPort, DshSetupProfile, DshSetupStatus } from '../../shared/dsh-setup';

const bundleName = 'habblaud-dsh-bridge';
const componentId = 'habblaud-native-bridge';
const profileName = /^[a-z][a-z0-9_-]*$/i;

function validProfileName(name: string): boolean {
  return profileName.test(name) && !['desktop', 'node_modules'].includes(name.toLowerCase());
}

export interface DshSetupOptions {
  rootDir: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  enabled?: boolean;
  connected: () => boolean;
}

function regularFile(path: string): boolean {
  try { return lstatSync(path).isFile(); } catch { return false; }
}

function safeDirectory(path: string): boolean {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

function executable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

/** Only select a known local DSH executable; never accept a browser-supplied path. */
function findBin(home: string, env: NodeJS.ProcessEnv, expectedVersion?: string): string | undefined {
  if (env.HABBLAUD_DSH_BIN) return executable(env.HABBLAUD_DSH_BIN) ? env.HABBLAUD_DSH_BIN : undefined;
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    const bin = join(dir, 'dsh');
    if (executable(bin)) return bin;
  }
  const cache = env.npm_config_cache ?? join(home, '.npm');
  const npx = join(cache, '_npx');
  if (!safeDirectory(npx)) return undefined;
  const candidates: Array<{ bin: string; mtime: number }> = [];
  for (const dir of readdirSync(npx)) {
    const base = join(npx, dir, 'node_modules');
    const bin = join(base, '.bin', 'dsh');
    const manifest = join(base, '@deepseek-ai', 'dsh', 'package.json');
    if (!executable(bin) || !regularFile(manifest)) continue;
    try {
      const info = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
      if (expectedVersion && info.version !== expectedVersion) continue;
      candidates.push({ bin, mtime: lstatSync(manifest).mtimeMs });
    } catch { /* Skip partial cache entries. */ }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.bin;
}

function selectedProfile(home: string, profile: string, rootDir: string, bin?: string): { installed: boolean; enabled: boolean; differentSource: boolean } {
  const dir = join(home, 'profiles', profile);
  if (!safeDirectory(dir)) return { installed: false, enabled: false, differentSource: false };
  const file = join(dir, 'package.json');
  if (!regularFile(file)) return { installed: false, enabled: false, differentSource: false };
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>;
      dsh?: { profile?: { bundles?: string[] } };
    };
    const spec = manifest.dependencies?.[bundleName];
    const installed = typeof spec === 'string';
    const selected = manifest.dsh?.profile?.bundles?.includes(bundleName) === true;
    const source = typeof spec === 'string' && /^(file|link):/.test(spec)
      ? resolve(dir, spec.replace(/^(file|link):/, '')) : '';
    return { installed, enabled: installed && selected && !componentDisabled(dir, bin), differentSource: installed && source !== join(rootDir, 'integrations', 'dsh') };
  } catch { return { installed: false, enabled: false, differentSource: false }; }
}

// Reuse the parser shipped with DSH when available. No credentials or session
// data are accessed; only this component's id and disabled flag are inspected.
function componentDisabled(dir: string, bin?: string): boolean {
  const file = join(dir, 'cordis.patch.yml');
  if (!existsSync(file)) return false;
  if (!regularFile(file)) return true;
  const text = readFileSync(file, 'utf8');
  if (bin) try {
    const yaml = createRequire(realpathSync(bin))('yaml') as {
      parseDocument: (source: string, options?: object) => any;
      isSeq: (value: unknown) => boolean;
      isMap: (value: unknown) => boolean;
    };
    const document = yaml.parseDocument(text, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: unknown) => value }],
    });
    if (document.errors[0] || !yaml.isSeq(document.contents)) return true;
    let disabled = false;
    for (let i = 0; i < document.contents.items.length; i++) {
      const item = document.contents.items[i];
      if (!yaml.isMap(item) || document.getIn([i, 'id']) !== componentId || item.has('insert')) continue;
      const name = document.getIn([i, 'name']);
      if (name === undefined || name === bundleName) disabled = document.getIn([i, 'disabled']) === true;
    }
    return disabled;
  } catch { /* If DSH's parser is unavailable, retain a conservative read. */ }
  // DSH's usual switch shape is simple; uncertain YAML is shown as disabled so
  // a user click still runs the authoritative installer helper.
  let id = '';
  let disabled = false;
  let recognized = false;
  let recognizedItems = 0;
  for (const line of text.split(/\r?\n/)) {
    const start = line.match(/^\s*-\s+id:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/);
    if (start) { id = start[1]; if (id === componentId) recognizedItems++; continue; }
    if (id !== componentId) continue;
    const flag = line.match(/^\s+disabled:\s*(true|false)\s*(?:#.*)?$/);
    if (flag) { disabled = flag[1] === 'true'; recognized = true; }
  }
  const mentions = text.split(componentId).length - 1;
  return disabled || (mentions > 0 && (!recognized || mentions > recognizedItems));
}

export class DshSetupService implements DshSetupPort {
  private readonly rootDir: string;
  private readonly userHome: string;
  private readonly dshHome: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly enabled: boolean;
  private readonly connected: () => boolean;
  private readonly pending = new Map<string, Promise<DshSetupStatus>>();
  private readonly errors = new Map<string, DshSetupError>();

  constructor(options: DshSetupOptions) {
    this.rootDir = resolve(options.rootDir);
    this.env = options.env ?? process.env;
    this.userHome = options.home ?? homedir();
    this.dshHome = resolve(this.env.DSH_HOME ?? join(this.userHome, '.dsh'));
    this.enabled = options.enabled !== false;
    this.connected = options.connected;
  }

  private profiles(bin?: string): DshSetupProfile[] {
    const path = join(this.dshHome, 'profiles');
    if (!safeDirectory(this.dshHome) || !safeDirectory(path)) return [];
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && validProfileName(entry.name) &&
        (regularFile(join(path, entry.name, 'package.json')) || regularFile(join(path, entry.name, 'cordis.patch.yml'))))
      .map((entry) => ({ name: entry.name, ...selectedProfile(this.dshHome, entry.name, this.rootDir, bin) }))
      .map(({ name, installed, enabled }) => ({ name, installed, enabled }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveProfile(requested: string | undefined, profiles: DshSetupProfile[]): string {
    if (requested !== undefined) return validProfileName(requested) ? requested : '';
    return profiles.length === 0 ? 'web' : profiles.length === 1 ? profiles[0].name : '';
  }

  status(profile?: string): DshSetupStatus {
    const helper = join(this.rootDir, 'dist', 'scripts', 'dsh-install.js');
    const bundle = join(this.rootDir, 'integrations', 'dsh', 'dist', 'index.js');
    const bundleManifest = join(this.rootDir, 'integrations', 'dsh', 'package.json');
    let version: string | undefined;
    if (regularFile(bundleManifest)) try {
      version = (JSON.parse(readFileSync(bundleManifest, 'utf8')) as { peerDependencies?: Record<string, string> }).peerDependencies?.['@deepseek-ai/dsh'];
    } catch { /* A broken local install is not connectable. */ }
    const bin = findBin(this.userHome, this.env, version);
    const profiles = this.profiles(bin);
    const name = this.resolveProfile(profile, profiles);
    const selected = profiles.find((item) => item.name === name);
    const canCreateDefault = profiles.length === 0 && name === 'web';
    const running = name !== '' && this.pending.has(name);
    const connected = this.connected();
    // NativeSource reports the provider's heartbeat, without a profile id.
    // With several profiles it cannot prove that the selected one is running.
    const selectedConnected = connected && profiles.length === 1 && selected?.enabled === true;
    let error: DshSetupError | undefined = name ? this.errors.get(name) : undefined;
    if (!this.enabled) error = 'setup-disabled';
    else if (!regularFile(helper) || !regularFile(bundle)) error = 'bridge-not-built';
    else if (!bin) error = 'dsh-not-found';
    else if (name && !selected && !canCreateDefault) error = 'profile-not-found';
    else if (selectedProfile(this.dshHome, name, this.rootDir, bin).differentSource) error = 'different-source';
    const canConnect = this.enabled && Boolean((selected || canCreateDefault) && bin && regularFile(helper) && regularFile(bundle)) && error !== 'different-source' && error !== 'setup-disabled';
    const unavailable = error && ['setup-disabled', 'bridge-not-built', 'dsh-not-found', 'profile-not-found'].includes(error);
    const state = unavailable ? 'unavailable' : running ? 'connecting' : error ? 'error' :
      selectedConnected ? 'connected' : selected?.enabled ? 'installed' : selected?.installed ? 'disabled' : 'ready';
    return {
      state, profile: name, profiles, canConnect, connected,
      autostart: selected?.enabled === true,
      ...(error ? { error } : {}),
    };
  }

  async connect(profile?: string): Promise<DshSetupStatus> {
    const initial = this.status(profile);
    const name = initial.profile;
    if (!name || !initial.canConnect) return initial;
    const existing = this.pending.get(name);
    if (existing) return existing;
    this.errors.delete(name);
    const before = this.status(name);
    const bin = findBin(this.userHome, this.env);
    if (!bin) { this.errors.set(name, 'dsh-not-found'); return this.status(name); }
    const task = this.runHelper(name, bin).then((exitedSuccessfully) => {
      const after = selectedProfile(this.dshHome, name, this.rootDir, bin);
      const success = exitedSuccessfully && after.installed && after.enabled && !after.differentSource;
      if (!success) this.errors.set(name, before.profiles.find((item) => item.name === name)?.installed ? 'enable-failed' : 'install-failed');
      else this.errors.delete(name);
      this.pending.delete(name);
      return this.status(name);
    });
    this.pending.set(name, task);
    return task;
  }

  private runHelper(profile: string, bin: string): Promise<boolean> {
    const helper = join(this.rootDir, 'dist', 'scripts', 'dsh-install.js');
    return new Promise((resolveResult) => {
      const child = spawn(process.execPath, [helper, 'connect', '--profile', profile, '--dsh-home', this.dshHome, '--root', this.rootDir, '--dsh', bin], {
        cwd: this.rootDir,
        env: { ...this.env, DSH_HOME: this.dshHome },
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      let done = false;
      const finish = (success: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolveResult(success);
      };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish(false); }, 200_000);
      timer.unref();
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
    });
  }
}
