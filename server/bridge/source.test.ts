import { readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeEnvelope, BridgeEvent, BridgeSession, NativeProvider } from '../../shared/native-bridge';
import type { TerminalEntry } from '../../shared/types';
import type { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { NATIVE_TIMEOUT_MS, NativeSource } from './source';

setQuiet(true);
const NOW = Date.UTC(2026, 9, 13, 10);
const HOUR = 60 * 60_000;
const created: Array<{ source: NativeSource; cleanup: () => void }> = [];
afterEach(() => { for (const entry of created.splice(0)) { entry.source.stop(); entry.cleanup(); } });

function fixture(provider: NativeProvider = 'dsh') {
  const tmp = tempDir('habblaud-native-test-');
  let now = NOW;
  const accounts: Pick<AccountsService, 'setProviderAccounts'> = {
    setProviderAccounts: (p, list) => list.map((input) => ({ id: input.detected.id, provider: p,
      dir: input.dir, detected: { ...input.detected, provider: p } })),
  };
  let source!: NativeSource;
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: NOW,
    accounts: () => [], sources: () => [], accountName: () => undefined,
    messages: () => source.reachable(), now: () => now });
  const dir = join(tmp.dir, 'cache');
  source = new NativeSource({ provider, office, accounts, dir, home: tmp.dir, now: () => now });
  source.start();
  created.push({ source, cleanup: tmp.cleanup });
  const session = (id: string, extra: Partial<BridgeSession> = {}): BridgeSession => ({
    sessionId: id, account: 'primary', cwd: '/workspace/app', startedAt: NOW - HOUR,
    status: 'working', capabilities: { messages: true, permissions: true, history: true, terminal: true }, ...extra,
  });
  const ingest = (instanceId: string, seq: number, ...events: BridgeEvent[]) => {
    const envelope: BridgeEnvelope = { version: 1, provider, instanceId, seq, events };
    source.ingest(envelope);
  };
  return { source, office, dir, root: tmp.dir, session, ingest,
    advance: (ms: number) => { now += ms; },
    id: (sessionId: string) => source.agentId(sessionId, 'primary'),
  };
}

const user = (id: string, text = id, at = NOW): TerminalEntry => ({ kind: 'user', id, at, text });

describe('NativeSource', () => {
  it('isolates provider identity and materializes only live sessions', async () => {
    const f = fixture('dsh');
    f.source.ingest({ version: 1, provider: 'pi', instanceId: 'pi-1', seq: 1,
      events: [{ type: 'session', session: f.session('wrong') }] });
    expect(f.source.sources()[0]).toMatchObject({ provider: 'dsh', sessions: 0, ok: false });
    f.ingest('dsh-1', 1, { type: 'session', session: f.session('historical', { status: 'offline' }), historical: true });
    expect(f.office.list()).toHaveLength(0);
    expect(f.source.owns('dsh-1', 'historical')).toBeUndefined();
    expect((await f.source.list()).map((s) => [s.provider, s.sessionId, s.open])).toEqual([['dsh', 'historical', false]]);
    f.ingest('dsh-1', 2, { type: 'session', session: f.session('live') });
    const agent = f.office.get(f.id('live'));
    expect(agent).toMatchObject({ id: f.id('live'), provider: 'dsh', account: 'dsh:primary', sessionId: 'live', status: 'working' });
    expect(f.source.ownerOf(f.id('live'))).toEqual({ instanceId: 'dsh-1', sessionId: 'live' });
    expect(f.source.hasAccount('dsh:primary')).toBe(true);
    const pi = fixture('pi');
    pi.ingest('pi-1', 1, { type: 'session', session: pi.session('live') });
    expect(pi.id('live')).not.toBe(f.id('live'));
    expect(pi.office.get(pi.id('live'))).toMatchObject({ provider: 'pi', account: 'pi:primary' });
  });

  it('attaches a child published before its parent and does not turn historical children live', () => {
    const f = fixture();
    f.ingest('one', 1, { type: 'session', session: f.session('child', { parentSessionId: 'parent', role: 'reviewer' }) });
    expect(f.office.get(f.id('child'))).toBeUndefined();
    f.ingest('one', 2, { type: 'session', session: f.session('old-child', { parentSessionId: 'parent', status: 'offline' }), historical: true });
    f.ingest('one', 3, { type: 'session', session: f.session('parent') });
    expect(f.office.get(f.id('child'))).toMatchObject({ kind: 'sub', provider: 'dsh', parentId: f.id('parent'), role: 'reviewer' });
    expect(f.office.get(f.id('old-child'))).toBeUndefined();
    expect(f.source.owns('one', 'child')).toBe(f.id('child'));
  });

  it('deduplicates envelope sequences, activity IDs and terminal IDs', () => {
    const f = fixture();
    f.ingest('one', 1, { type: 'session', session: f.session('s') });
    const activity: BridgeEvent = { type: 'activity', sessionId: 's', activity: {
      id: 's:1', kind: 'run', icon: '⌨️', text: 'Executing', at: NOW }, historical: false };
    const terminal: BridgeEvent = { type: 'terminal', sessionId: 's', entries: [user('u1')] };
    f.ingest('one', 2, activity, terminal);
    f.ingest('one', 2, activity, terminal);
    f.ingest('one', 3, activity, terminal);
    expect(f.office.get(f.id('s'))?.recent.filter((a) => a.id === 's:1')).toHaveLength(1);
    expect(f.source.conversation(f.id('s'))?.load().entries).toEqual([user('u1')]);
    expect(f.source.conversation(f.id('s'))?.load().truncated).toBe(false);
  });

  it('retires an old instance after replacement and uses fresh poll heartbeat for message presence', () => {
    const f = fixture();
    f.ingest('old', 1, { type: 'session', session: f.session('s', { title: 'Old' }) });
    expect(f.source.reachable()).not.toContain(f.id('s'));
    expect(f.source.poll('old')).toBe(true);
    expect(f.source.reachable()).toContain(f.id('s'));
    expect(f.office.commit().snapshot.agents.find((a) => a.id === f.id('s'))?.canMessage).toBe(true);
    f.ingest('new', 1, { type: 'session', session: f.session('s', { title: 'New' }) });
    f.ingest('old', 2, { type: 'status', sessionId: 's', status: 'offline' });
    f.ingest('old', 3, { type: 'session', session: f.session('s', { title: 'Stale' }) });
    expect(f.source.ownerOf(f.id('s'))).toEqual({ instanceId: 'new', sessionId: 's' });
    expect(f.office.get(f.id('s'))?.title).toBe('New');
    expect(f.source.reachable()).not.toContain(f.id('s'));
    expect(f.source.poll('new')).toBe(true);
    expect(f.source.reachable()).toContain(f.id('s'));
    f.office.markDirty();
    expect(f.office.commit().snapshot.agents.find((a) => a.id === f.id('s'))?.canMessage).toBe(true);
    f.advance(10_001);
    expect(f.source.reachable()).not.toContain(f.id('s'));
    f.office.markDirty();
    expect(f.office.commit().snapshot.agents.find((a) => a.id === f.id('s'))?.canMessage).toBeUndefined();
    f.source.poll('new');
    expect(f.source.reachable()).toContain(f.id('s'));
    f.advance(NATIVE_TIMEOUT_MS);
    f.source.expire();
    expect(f.source.ownerOf(f.id('s'))).toBeUndefined();
    expect(f.office.get(f.id('s'))?.status).toBe('offline');
  });

  it.each(['dsh', 'pi'] as const)('restores %s after a 45-second timeout only with a newer live session', (provider) => {
    const f = fixture(provider);
    const live: BridgeEvent = { type: 'session', session: f.session('s') };
    f.ingest('same', 1, live);
    expect(f.source.poll('same')).toBe(true);
    expect(f.source.reachable()).toContain(f.id('s'));

    f.advance(NATIVE_TIMEOUT_MS);
    f.source.expire();
    expect(f.source.ownerOf(f.id('s'))).toBeUndefined();
    expect(f.office.get(f.id('s'))?.status).toBe('offline');
    expect(f.source.sources()[0]).toMatchObject({ sessions: 0, ok: false });

    // A reconnected transport may poll first; that must enable the adapter's
    // resync without making a stale or duplicate envelope look live.
    expect(f.source.poll('same')).toBe(true);
    expect(f.source.reachable()).not.toContain(f.id('s'));
    f.ingest('same', 1, live);
    f.ingest('same', 2, { type: 'status', sessionId: 's', status: 'working' });
    expect(f.source.ownerOf(f.id('s'))).toBeUndefined();
    expect(f.source.sources()[0]?.ok).toBe(false);

    f.ingest('same', 3, live);
    expect(f.source.ownerOf(f.id('s'))).toEqual({ instanceId: 'same', sessionId: 's' });
    expect(f.office.get(f.id('s'))?.status).toBe('working');
    expect(f.source.reachable()).toContain(f.id('s'));
    expect(f.source.sources()[0]).toMatchObject({ sessions: 1, ok: true });
  });

  it('keeps an explicit stop terminal and prevents an expired replaced owner from reclaiming a session', () => {
    const f = fixture();
    const old: BridgeEvent = { type: 'session', session: f.session('s', { title: 'Old' }) };
    const replacement: BridgeEvent = { type: 'session', session: f.session('s', { title: 'New' }) };
    f.ingest('old', 1, old);
    f.ingest('new', 1, replacement);
    f.advance(NATIVE_TIMEOUT_MS - 1);
    f.source.poll('new');
    f.advance(1);
    f.source.expire();
    expect(f.source.ownerOf(f.id('s'))).toEqual({ instanceId: 'new', sessionId: 's' });
    expect(f.source.poll('old')).toBe(true);
    f.ingest('old', 2, old);
    expect(f.source.ownerOf(f.id('s'))).toEqual({ instanceId: 'new', sessionId: 's' });
    expect(f.office.get(f.id('s'))?.title).toBe('New');

    f.source.stopInstance('new');
    expect(f.source.poll('new')).toBe(false);
    f.ingest('new', 2, replacement);
    expect(f.source.ownerOf(f.id('s'))).toBeUndefined();
    expect(f.office.get(f.id('s'))?.status).toBe('offline');
  });

  it('retires the oldest expired id before the 128-instance capacity blocks a new plugin', () => {
    const f = fixture();
    for (let n = 0; n < 128; n++) f.ingest(`old-${n}`, 1, { type: 'heartbeat' });
    f.advance(NATIVE_TIMEOUT_MS);
    f.source.expire();
    f.ingest('fresh', 1, { type: 'session', session: f.session('s') });
    expect(f.source.ownerOf(f.id('s'))).toEqual({ instanceId: 'fresh', sessionId: 's' });
    expect(f.source.poll('old-0')).toBe(false);
    f.ingest('old-0', 2, { type: 'session', session: f.session('stale') });
    expect(f.source.ownerOf(f.id('stale'))).toBeUndefined();
  });

  it('sends virtual conversation append, then init on reset or truncation', () => {
    const f = fixture();
    f.ingest('one', 1, { type: 'session', session: f.session('s') });
    f.ingest('one', 2, { type: 'terminal', sessionId: 's', entries: [user('u1')] });
    const reader = f.source.conversation(f.id('s'))!;
    expect(reader.load()).toMatchObject({ entries: [user('u1')], truncated: false });
    f.ingest('one', 3, { type: 'terminal', sessionId: 's', entries: [user('u2')], truncated: true });
    expect(reader.poll()).toEqual({ append: [user('u2')] });
    expect(reader.load().truncated).toBe(true);
    f.ingest('one', 4, { type: 'terminal', sessionId: 's', entries: [user('u3')], reset: true, truncated: true });
    expect(reader.poll()).toMatchObject({ init: { entries: [user('u3')], truncated: true } });
    expect(reader.poll()).toEqual({ append: [] });
    expect(f.source.transcriptPathOf(f.id('s'))).toMatch(/^[^\0]+\.jsonl$/);
  });

  it('restores private recent history after restart without reviving office agents or arbitrary paths', async () => {
    const f = fixture();
    f.ingest('one', 1, { type: 'session', session: f.session('s') });
    f.ingest('one', 2, { type: 'terminal', sessionId: 's', entries: [user('u1', 'synthetic text')] });
    const path = f.source.transcriptPathOf(f.id('s'))!;
    expect(path.startsWith(`${f.dir}/`)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path.replace(/\.jsonl$/, '.json')).mode & 0o777).toBe(0o600);
    f.source.stop();
    const accounts: Pick<AccountsService, 'setProviderAccounts'> = { setProviderAccounts: (p, list) => list.map((input) => ({
      id: input.detected.id, provider: p, dir: input.dir, detected: { ...input.detected, provider: p },
    })) };
    const office = new Office({ names: new NameStore(null), version: 'test', startedAt: NOW,
      accounts: () => [], sources: () => [], accountName: () => undefined, now: () => NOW });
    const restored = new NativeSource({ provider: 'dsh', office, accounts, dir: f.dir, home: f.root, now: () => NOW });
    restored.start();
    created.push({ source: restored, cleanup: () => {} });
    expect(office.list()).toEqual([]);
    expect((await restored.list()).map((s) => [s.sessionId, s.open])).toEqual([['s', false]]);
    expect(restored.resolve('dsh:primary', 's')).toMatchObject({ path });
    expect(restored.resolve('dsh:primary', '../s')).toMatchObject({ status: 404 });
    expect(restored.resolve('../dsh:primary', 's')).toMatchObject({ status: 404 });
    expect(restored.transcriptPathOf('/etc/passwd')).toBeUndefined();
    expect(readFileSync(path, 'utf8')).toContain('synthetic text');
  });

  it('does not follow a cached transcript symlink outside the private cache', async () => {
    const f = fixture();
    f.ingest('one', 1, { type: 'session', session: f.session('s', { status: 'offline' }), historical: true });
    const path = f.source.transcriptPathOf(f.id('s'))!;
    const outside = join(f.root, 'outside.jsonl');
    writeFileSync(outside, `${JSON.stringify(user('outside', 'outside-only'))}\n`);
    symlinkSync(outside, path);
    const office = new Office({ names: new NameStore(null), version: 'test', startedAt: NOW,
      accounts: () => [], sources: () => [], accountName: () => undefined, now: () => NOW });
    const accounts: Pick<AccountsService, 'setProviderAccounts'> = { setProviderAccounts: (p, list) => list.map((input) => ({
      id: input.detected.id, provider: p, dir: input.dir, detected: { ...input.detected, provider: p },
    })) };
    const restored = new NativeSource({ provider: 'dsh', office, accounts, dir: f.dir, home: f.root, now: () => NOW });
    restored.start();
    created.push({ source: restored, cleanup: () => {} });
    expect(restored.resolve('dsh:primary', 's')).toMatchObject({ status: 404 });
    expect(restored.transcriptPathOf(f.id('s'))).toBeUndefined();
    expect(restored.conversation(f.id('s'))).toBeUndefined();
  });
});
