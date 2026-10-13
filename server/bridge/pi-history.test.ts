import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { piAccountLabel } from '../../integrations/native/accounts';
import type { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { PiHistory, piHistoryRoots } from './pi-history';
import { NativeSource } from './source';

setQuiet(true);
const opened: Array<{ source: NativeSource; cleanup: () => void }> = [];
afterEach(() => { for (const item of opened.splice(0)) { item.source.stop(); item.cleanup(); } });

function fixture() {
  const tmp = tempDir('habblaud-pi-history-');
  const now = Date.now();
  const accounts: Pick<AccountsService, 'setProviderAccounts'> = {
    setProviderAccounts: (provider, list) => list.map((input) => ({ id: input.detected.id, provider,
      dir: input.dir, detected: { ...input.detected, provider } })),
  };
  let source!: NativeSource;
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: now,
    accounts: () => [], sources: () => [], accountName: () => undefined,
    messages: () => source.reachable(), now: () => now });
  source = new NativeSource({ provider: 'pi', office, accounts, dir: join(tmp.dir, 'cache'), home: tmp.dir, now: () => now });
  source.start();
  opened.push({ source, cleanup: tmp.cleanup });
  const agentDir = (name: string) => join(tmp.dir, name);
  const writeSession = (agent: string, id: string, lines: object[], project = 'project') => {
    const root = join(agentDir(agent), 'sessions', project);
    mkdirSync(root, { recursive: true });
    const path = join(root, `${id}.jsonl`);
    const header = { type: 'session', version: 3, id, timestamp: new Date(now - 1000).toISOString(), cwd: `/workspace/${project}` };
    writeFileSync(path, [header, ...lines].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    return path;
  };
  const message = (id: string, parentId: string | null, role: 'user' | 'assistant', text: string) => ({
    type: 'message', id, parentId, timestamp: new Date(now - 500).toISOString(),
    message: { role, timestamp: now - 500, content: role === 'user' ? text : [{ type: 'text', text }] },
  });
  const entries = (account: string, sessionId: string) => {
    const resolved = source.resolve(account, sessionId);
    if ('status' in resolved) throw new Error(`missing ${account}/${sessionId}`);
    return resolved.createConversation!('test-agent').load().entries;
  };
  return { tmp, now, source, office, agentDir, writeSession, message, entries };
}

describe('Pi cold history scanner', () => {
  it('keeps only the active JSONL branch and never turns a closed session live', async () => {
    const f = fixture();
    f.writeSession('agent-a', 'same', [
      f.message('a', null, 'user', '用户原文'),
      f.message('old', 'a', 'assistant', '废弃分支'),
      f.message('new', 'a', 'assistant', '当前分支'),
    ]);
    const history = new PiHistory({ source: f.source, roots: piHistoryRoots({ PI_CODING_AGENT_DIR: f.agentDir('agent-a') }, f.tmp.dir), now: () => f.now });
    const sessions = await history.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ provider: 'pi', sessionId: 'same', open: false });
    expect(f.office.list()).toHaveLength(0);
    expect(f.source.sources()[0]).toMatchObject({ sessions: 0, ok: false });
    expect(f.entries(sessions[0].account, 'same').map((e) => e.kind === 'assistant' ? e.text : '')).toContain('当前分支');
    expect(f.entries(sessions[0].account, 'same').map((e) => e.kind === 'assistant' ? e.text : '')).not.toContain('废弃分支');
  });

  it('isolates two configured Pi accounts even when native session IDs coincide', async () => {
    const f = fixture();
    f.writeSession('agent-a', 'shared-id', [f.message('a', null, 'user', '甲账户原文')]);
    f.writeSession('agent-b', 'shared-id', [f.message('b', null, 'user', '乙账户原文')]);
    const roots = piHistoryRoots({ HABBLAUD_PI_DIRS: [f.agentDir('agent-a'), f.agentDir('agent-b')].join(delimiter) }, f.tmp.dir);
    const history = new PiHistory({ source: f.source, roots, now: () => f.now });
    const sessions = await history.list();
    expect(sessions).toHaveLength(2);
    const a = `pi:${piAccountLabel(f.agentDir('agent-a'))}`;
    const b = `pi:${piAccountLabel(f.agentDir('agent-b'))}`;
    expect(a).not.toBe(b);
    expect(sessions.map((s) => s.account).sort()).toEqual([a, b].sort());
    expect(f.entries(a, 'shared-id')).toMatchObject([{ kind: 'user', text: '甲账户原文' }]);
    expect(f.entries(b, 'shared-id')).toMatchObject([{ kind: 'user', text: '乙账户原文' }]);
    expect(history.resolve(a, 'unknown')).toMatchObject({ status: 404 });
  });

  it('skips symlinked files and directories that lead outside the session root', async () => {
    const f = fixture();
    const root = join(f.agentDir('agent-a'), 'sessions');
    f.writeSession('agent-a', 'good', [f.message('a', null, 'user', '保留')]);
    const external = f.writeSession('outside', 'secret', [f.message('x', null, 'user', '外部内容')]);
    symlinkSync(external, join(root, 'linked.jsonl'));
    symlinkSync(join(f.agentDir('outside'), 'sessions', 'project'), join(root, 'linked-directory'));
    const history = new PiHistory({ source: f.source, roots: [root], now: () => f.now });
    const sessions = await history.list();
    expect(sessions.map((s) => s.sessionId)).toEqual(['good']);
    expect(JSON.stringify(f.entries(sessions[0].account, 'good'))).not.toContain('外部内容');
  });

  it('refreshes the same historical session after its JSONL file changes', async () => {
    const f = fixture();
    f.writeSession('agent-a', 'updated', [f.message('a', null, 'user', '初始原文')]);
    const history = new PiHistory({ source: f.source, roots: [join(f.agentDir('agent-a'), 'sessions')], now: () => f.now });
    const first = await history.list();
    expect(f.entries(first[0].account, 'updated')).toMatchObject([{ kind: 'user', text: '初始原文' }]);
    f.writeSession('agent-a', 'updated', [f.message('a', null, 'user', '修改后的原文'), f.message('b', 'a', 'assistant', '新的回复内容')]);
    const second = await history.list();
    expect(second).toHaveLength(1);
    expect(second[0].open).toBe(false);
    expect(f.entries(second[0].account, 'updated')).toMatchObject([
      { kind: 'user', text: '修改后的原文' }, { kind: 'assistant', text: '新的回复内容' },
    ]);
  });
});
