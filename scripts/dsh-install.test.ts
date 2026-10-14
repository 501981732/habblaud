import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { connect, install, parseArgs, status, uninstall } from './dsh-install';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(options: { leaveBundleOnRemove?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'habblaud-dsh-install-'));
  directories.push(home);
  const profileDir = join(home, 'profiles', 'web');
  mkdirSync(profileDir, { recursive: true });
  const manifest = {
    name: 'dsh-profile-web', private: true, userField: { untouched: true }, dependencies: { 'other-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'other-plugin'], userSetting: 'keep' } },
  };
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '- id: existing-user-override\n  disabled: true\n');
  const bin = join(home, 'fake-dsh');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const [command, flag, profile, action, bundle] = process.argv.slice(2);
if (command !== 'plugin' || flag !== '--profile' || profile !== 'web' ||
  (action !== 'add' && action !== 'remove') ||
  (action === 'add' && !path.isAbsolute(bundle)) ||
  (action === 'remove' && bundle !== 'habblaud-dsh-bridge')) process.exit(19);
const dir = path.join(process.env.DSH_HOME, 'profiles', profile);
const file = path.join(dir, 'package.json');
fs.mkdirSync(dir, { recursive: true });
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) :
  { dependencies: {}, dsh: { profile: { bundles: [] } } };
if (action === 'add') {
  data.dependencies['habblaud-dsh-bridge'] = 'file:' + bundle;
  data.dsh.profile.bundles.push('habblaud-dsh-bridge');
} else {
  delete data.dependencies['habblaud-dsh-bridge'];
  if (!${options.leaveBundleOnRemove === true}) data.dsh.profile.bundles = data.dsh.profile.bundles.filter((name) => name !== 'habblaud-dsh-bridge');
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n');
fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'changed lock\\n');
fs.writeFileSync(path.join(dir, 'called'), JSON.stringify(process.argv.slice(2)));
`, { mode: 0o755 });
  return { home, profileDir, bin };
}

test('parses a local profile and CLI path without changing DSH files', () => {
  const { home, profileDir, bin } = fixture();
  const args = parseArgs(['install', '--profile', 'web', '--dsh', bin, '--dsh-home', home], {});
  assert.equal(args.options.dshHome, home);
  assert.equal(args.options.dshBin, bin);
  assert.equal(parseArgs(['uninstall', '--profile', 'web', '--dsh-home', home], {}).command, 'uninstall');
  assert.deepEqual(status(args.options), { profileDir, enabled: false, localSource: false });
  assert.throws(() => parseArgs(['install', '--profile', '../web'], {}), /Invalid/);
  assert.equal(readdirSync(profileDir).filter((name) => name.includes('backup')).length, 0);
});

test('uninstalls through DSH, backs up modified profile files and keeps unrelated configuration', () => {
  const { home, profileDir, bin } = fixture();
  const opts = { profile: 'web', dshHome: home, dshBin: bin };
  install(opts);
  const installedManifest = readFileSync(join(profileDir, 'package.json'), 'utf8');
  const installedLock = readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8');
  const userPatch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
  const result = uninstall(opts);
  assert.equal(result.changed, true);
  assert.equal(result.backups.length, 2);
  assert.deepEqual(result.backups.map((path) => readFileSync(path, 'utf8')).sort(), [installedManifest, installedLock].sort());
  assert.deepEqual(JSON.parse(readFileSync(join(profileDir, 'called'), 'utf8')), ['plugin', '--profile', 'web', 'remove', 'habblaud-dsh-bridge']);
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { 'other-plugin': '1.0.0' });
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'other-plugin']);
  assert.deepEqual(manifest.userField, { untouched: true });
  assert.equal(manifest.dsh.profile.userSetting, 'keep');
  assert.equal(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'), userPatch);
  assert.deepEqual(uninstall(opts), { changed: false, backups: [], status: result.status });
  assert.equal(readdirSync(profileDir).filter((name) => name.includes('backup')).length, 4);
});

test('clears only the Habblaud bundle when the native remove leaves an orphan', () => {
  const { home, profileDir, bin } = fixture({ leaveBundleOnRemove: true });
  const opts = { profile: 'web', dshHome: home, dshBin: bin };
  install(opts);
  const result = uninstall(opts);
  assert.equal(result.changed, true);
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { 'other-plugin': '1.0.0' });
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'other-plugin']);
  assert.deepEqual(manifest.userField, { untouched: true });
  assert.equal(manifest.dsh.profile.userSetting, 'keep');
});

test('removes a locally installed but disabled bundle without enabling it', () => {
  const { home, profileDir, bin } = fixture();
  const opts = { profile: 'web', dshHome: home, dshBin: bin };
  install(opts);
  const file = join(profileDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== 'habblaud-dsh-bridge');
  writeFileSync(file, JSON.stringify(manifest));
  assert.equal(status(opts).enabled, false);
  assert.equal(status(opts).localSource, true);
  assert.equal(uninstall(opts).changed, true);
  assert.deepEqual(status(opts), { profileDir, enabled: false, localSource: false });
});

test('removes a stale owned bundle selection without calling the package manager', () => {
  const { home, profileDir, bin } = fixture();
  const file = join(profileDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.dsh.profile.bundles.push('habblaud-dsh-bridge');
  writeFileSync(file, JSON.stringify(manifest));
  const result = uninstall({ profile: 'web', dshHome: home, dshBin: bin });
  assert.equal(result.changed, true);
  assert.equal(result.backups.length, 2);
  assert.equal(existsSync(join(profileDir, 'called')), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'other-plugin']);
});

test('installs via local DSH CLI, backs up edited manifest/lock, preserves other plugin and user patch, then is idempotent', () => {
  const { home, profileDir, bin } = fixture();
  const opts = { profile: 'web', dshHome: home, dshBin: bin };
  const beforeManifest = readFileSync(join(profileDir, 'package.json'), 'utf8');
  const beforeLock = readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8');
  const beforePatch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
  const result = install(opts);
  assert.equal(result.changed, true);
  assert.equal(result.backups.length, 2);
  assert.deepEqual(result.backups.map((path) => readFileSync(path, 'utf8')).sort(), [beforeManifest, beforeLock].sort());
  assert.equal(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'), beforePatch);
  assert.deepEqual(JSON.parse(readFileSync(join(profileDir, 'called'), 'utf8')).slice(0, 4), ['plugin', '--profile', 'web', 'add']);
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['other-plugin'], '1.0.0');
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'other-plugin', 'habblaud-dsh-bridge']);
  assert.deepEqual(install(opts), { changed: false, backups: [], status: result.status });
  assert.equal(readdirSync(profileDir).filter((name) => name.includes('backup')).length, 2);
});

test('refuses to replace an existing Habblaud package from a different source', () => {
  const { home, profileDir, bin } = fixture();
  const file = join(profileDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.dependencies['habblaud-dsh-bridge'] = '1.0.0';
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => install({ profile: 'web', dshHome: home, dshBin: bin }), /different/);
  assert.throws(() => uninstall({ profile: 'web', dshHome: home, dshBin: bin }), /different/);
  assert.equal(existsSync(join(profileDir, 'called')), false);
  assert.equal(readdirSync(profileDir).filter((name) => name.includes('backup')).length, 0);
});

test('connect installs and enables once, then keeps unrelated profile configuration untouched', () => {
  const { home, profileDir, bin } = fixture();
  const opts = { profile: 'web', dshHome: home, dshBin: bin };
  const originalPatch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.equal(connect(opts).status.enabled, true);
  assert.equal(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'), originalPatch);
  assert.equal(connect(opts).changed, false);
  assert.equal(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).userField.untouched, true);
});

test('connect initializes a DSH web profile that has not been started yet', () => {
  const { home, profileDir, bin } = fixture();
  rmSync(profileDir, { recursive: true });
  const result = connect({ profile: 'web', dshHome: home, dshBin: bin });
  assert.equal(result.status.enabled, true);
  assert.equal(result.status.localSource, true);
});

test('connect re-enables only the owned bundle and component and preserves other overrides', () => {
  const { home, profileDir, bin } = fixture();
  const opts = { profile: 'web', dshHome: home, dshBin: bin };
  install(opts);
  const file = join(profileDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== 'habblaud-dsh-bridge');
  writeFileSync(file, JSON.stringify(manifest));
  const patch = join(profileDir, 'cordis.patch.yml');
  writeFileSync(patch, '# user comment\n- id: existing-user-override\n  disabled: true\n- id: habblaud-native-bridge\n  disabled: true\n');
  assert.equal(status(opts).enabled, false);
  const result = connect(opts);
  assert.equal(result.status.enabled, true);
  assert.equal(result.backups.length, 2);
  assert.equal(readFileSync(patch, 'utf8').includes('# user comment'), true);
  assert.equal(readFileSync(patch, 'utf8').includes('existing-user-override'), true);
  assert.equal(readFileSync(patch, 'utf8').includes('disabled: false'), true);
  assert.equal(connect(opts).changed, false);
});

test('connect refuses a different source without editing the profile', () => {
  const { home, profileDir, bin } = fixture();
  const file = join(profileDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.dependencies['habblaud-dsh-bridge'] = 'https://example.invalid/bridge.tgz';
  writeFileSync(file, JSON.stringify(manifest));
  const before = readFileSync(file, 'utf8');
  assert.throws(() => connect({ profile: 'web', dshHome: home, dshBin: bin }), /different/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
