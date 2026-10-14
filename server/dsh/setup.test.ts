import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';
import { DshSetupService } from './setup';

const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'habblaud-dsh-setup-'));
  fixtures.push(base);
  const rootDir = join(base, 'project');
  const home = join(base, 'home');
  const profileDir = join(home, '.dsh', 'profiles', 'web');
  mkdirSync(join(rootDir, 'integrations', 'dsh', 'dist'), { recursive: true });
  mkdirSync(join(rootDir, 'dist', 'scripts'), { recursive: true });
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(rootDir, 'integrations', 'dsh', 'package.json'), JSON.stringify({ name: 'habblaud-dsh-bridge', peerDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' } }));
  writeFileSync(join(rootDir, 'integrations', 'dsh', 'dist', 'index.js'), 'export default {}');
  const manifest = { dependencies: {}, dsh: { profile: { bundles: ['other-plugin'] } }, userField: true };
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest));
  const bin = join(base, 'dsh');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const marker = join(base, 'helper-calls');
  const helper = join(rootDir, 'dist', 'scripts', 'dsh-install.js');
  writeFileSync(helper, `import fs from 'node:fs';
import path from 'node:path';
const marker = ${JSON.stringify(marker)};
const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;
fs.writeFileSync(marker, String(count + 1));
await new Promise(resolve => setTimeout(resolve, 60));
const args = process.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1];
const home = args[args.indexOf('--dsh-home') + 1];
const root = args[args.indexOf('--root') + 1];
const file = path.join(home, 'profiles', profile, 'package.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { dependencies: {}, dsh: { profile: { bundles: [] } } };
data.dependencies['habblaud-dsh-bridge'] = 'link:' + path.join(root, 'integrations', 'dsh');
data.dsh.profile.bundles.push('habblaud-dsh-bridge');
fs.writeFileSync(file, JSON.stringify(data));
`, { mode: 0o600 });
  let live = false;
  const service = new DshSetupService({ rootDir, home, env: { HABBLAUD_DSH_BIN: bin }, connected: () => live });
  return { base, rootDir, home, profileDir, marker, helper, service, setLive: (value: boolean) => { live = value; } };
}

test('one profile connects once under concurrent requests, then reports installed until a live bridge appears', async () => {
  const f = fixture();
  assert.equal(f.service.status().state, 'ready');
  const first = f.service.connect();
  const second = f.service.connect();
  assert.equal(f.service.status().state, 'connecting');
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.state, 'installed');
  assert.equal(b.state, 'installed');
  assert.equal(readFileSync(f.marker, 'utf8'), '1');
  f.setLive(true);
  assert.equal(f.service.status().state, 'connected');
});

test('different-source package blocks connect before the helper runs', async () => {
  const f = fixture();
  const file = join(f.profileDir, 'package.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.dependencies['habblaud-dsh-bridge'] = 'https://example.invalid/other.tgz';
  writeFileSync(file, JSON.stringify(data));
  const result = await f.service.connect();
  assert.equal(result.error, 'different-source');
  assert.equal(result.canConnect, false);
  assert.equal(readFileSync(file, 'utf8'), JSON.stringify(data));
});

test('failed helper returns a safe error and retry can succeed', async () => {
  const f = fixture();
  const successfulHelper = readFileSync(f.helper, 'utf8');
  writeFileSync(f.helper, 'process.exit(1);\n');
  const failure = await f.service.connect();
  assert.equal(failure.error, 'install-failed');
  assert.equal(failure.canConnect, true);
  writeFileSync(f.helper, successfulHelper);
  const retried = await f.service.connect();
  assert.equal(retried.error, undefined);
  assert.equal(retried.state, 'installed');
});

test('multiple profiles need an explicit selection', async () => {
  const f = fixture();
  const second = join(f.home, '.dsh', 'profiles', 'research');
  mkdirSync(second);
  writeFileSync(join(second, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
  const status = f.service.status();
  assert.equal(status.profile, '');
  assert.equal(status.canConnect, false);
  assert.equal(status.profiles.length, 2);
  assert.equal(status.error, undefined);
  assert.equal((await f.service.connect()).profile, '');
  assert.equal(f.service.status('web').canConnect, true);
});

test('package-manager and unrelated directories are not DSH profiles', () => {
  const f = fixture();
  const profilesDir = join(f.home, '.dsh', 'profiles');
  mkdirSync(join(profilesDir, 'node_modules'));
  mkdirSync(join(profilesDir, 'backups'));
  assert.equal(f.service.status().profile, 'web');
  assert.deepEqual(f.service.status().profiles.map((profile) => profile.name), ['web']);
  assert.equal(f.service.status('node_modules').canConnect, false);
});

test('a new DSH installation defaults to a creatable web profile', async () => {
  const f = fixture();
  rmSync(f.profileDir, { recursive: true });
  const ready = f.service.status();
  assert.equal(ready.profile, 'web');
  assert.equal(ready.canConnect, true);
  assert.equal((await f.service.connect()).state, 'installed');
});

test('a heartbeat from another profile cannot mark the selected profile connected', async () => {
  const f = fixture();
  await f.service.connect('web');
  const second = join(f.home, '.dsh', 'profiles', 'research');
  mkdirSync(second);
  writeFileSync(join(second, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
  f.setLive(true);
  assert.equal(f.service.status('web').connected, true);
  assert.equal(f.service.status('web').state, 'installed');
  assert.equal(f.service.status('research').state, 'ready');
});

test('live activity cannot mask a disabled component or unavailable helper', async () => {
  const f = fixture();
  const file = join(f.profileDir, 'package.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.dependencies['habblaud-dsh-bridge'] = 'link:' + join(f.rootDir, 'integrations', 'dsh');
  data.dsh.profile.bundles.push('habblaud-dsh-bridge');
  writeFileSync(file, JSON.stringify(data));
  writeFileSync(join(f.profileDir, 'cordis.patch.yml'), '- id: habblaud-native-bridge\n  disabled: true\n');
  f.setLive(true);
  assert.equal(f.service.status().state, 'disabled');
  writeFileSync(join(f.profileDir, 'cordis.patch.yml'), '- { id: habblaud-native-bridge, disabled: true }\n');
  assert.equal(f.service.status().state, 'disabled');
  writeFileSync(join(f.profileDir, 'cordis.patch.yml'), '- id: habblaud-native-bridge\n  disabled: true\n');
  await f.service.connect();
  assert.equal(readFileSync(f.marker, 'utf8'), '1');
  rmSync(f.helper);
  assert.equal(f.service.status().state, 'unavailable');
  assert.equal(f.service.status().error, 'bridge-not-built');
});
