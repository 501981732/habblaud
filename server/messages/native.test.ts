import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../shared/types';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { MessageRegistry } from './registry';

const NATIVE = 'dsh:session-1';
const CLAUDE = 'claude:1';
const SESSION = 'session-1';

function deferred<T>() {
  let done!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { done = resolve; });
  return { promise, done };
}

function setup(run: (agent: AgentInfo, text: string, id: string) => Promise<{ ok: boolean; error?: string }>) {
  let registry: MessageRegistry;
  const connected = new Set([NATIVE]);
  const office = new Office({
    names: new NameStore(null), version: 't', startedAt: 0, accounts: () => [], sources: () => [],
    accountName: () => undefined, messages: () => registry?.reachable() ?? new Set(),
  });
  office.addMain({ id: NATIVE, provider: 'dsh', account: 'dsh', sessionId: SESSION, cwd: '/p/a', role: 'Agent', startedAt: 1, status: 'working' });
  office.get(NATIVE)!.capabilities = { messages: true };
  office.addMain({ id: CLAUDE, account: 'claude', sessionId: SESSION, cwd: '/p/a', role: 'Agent', startedAt: 1, status: 'working' });
  registry = new MessageRegistry({ office, native: { reachable: () => connected, run } });
  return { office, registry, connected };
}

const idOf = (r: ReturnType<MessageRegistry['send']>) => {
  if (!('message' in r)) throw new Error('message rejected');
  return r.message.id;
};

describe('MessageRegistry native delivery', () => {
  it('uses the native queue, where delivered means accepted, and never exposes it to Claude inbox/ack', async () => {
    const calls: Array<{ agent: AgentInfo; text: string; id: string }> = [];
    const pending = deferred<{ ok: boolean }>();
    const { office, registry } = setup((agent, text, id) => { calls.push({ agent, text, id }); return pending.promise; });
    expect(registry.reachable()).toEqual(new Set([NATIVE]));
    const id = idOf(registry.send({ agentId: NATIVE, text: 'hello native' }));
    expect(registry.get(id)?.status).toBe('sent');
    expect(registry.inbox({ session: SESSION })).toEqual([]);
    registry.ack({ session: SESSION, results: [{ id, ok: true }] });
    expect(registry.get(id)?.status).toBe('sent');
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agent: { id: NATIVE, provider: 'dsh' }, text: 'hello native', id });
    pending.done({ ok: true });
    await vi.waitFor(() => expect(registry.get(id)?.status).toBe('delivered'));
    const activity = office.detail(NATIVE)!.history.find((x) => x.id.endsWith(`#msg:${id}`));
    expect(activity?.i18n).toEqual({ key: 'Mensagem pelo Habblaud' });
  });

  it('keeps native messages sequential, reports refusal, and loses presence on disconnect', async () => {
    const first = deferred<{ ok: boolean; error?: string }>();
    const calls: string[] = [];
    const { registry, connected } = setup(async (_agent, text) => {
      calls.push(text);
      return text === 'first' ? first.promise : { ok: true };
    });
    const a = idOf(registry.send({ agentId: NATIVE, text: 'first' }));
    const b = idOf(registry.send({ agentId: NATIVE, text: 'second' }));
    await Promise.resolve();
    expect(calls).toEqual(['first']);
    expect(registry.get(b)?.status).toBe('queued');
    first.done({ ok: false, error: 'queue refused' });
    await vi.waitFor(() => expect(registry.get(b)?.status).toBe('delivered'));
    expect(registry.get(a)).toMatchObject({ status: 'failed', error: 'queue refused' });
    connected.clear();
    expect(registry.canMessage(NATIVE)).toBe(false);
    expect(registry.send({ agentId: NATIVE, text: 'third' })).toMatchObject({ error: 'unavailable' });
  });

  it('does not let a native session satisfy Claude presence with the same session id', () => {
    const { registry, office } = setup(async () => ({ ok: true }));
    office.get(CLAUDE)!.status = 'offline';
    expect(registry.inbox({ session: SESSION })).toEqual([]);
    expect(registry.canMessage(CLAUDE)).toBe(false);
    expect(registry.canMessage(NATIVE)).toBe(true);
  });

  it('invokes a native delivery method with its receiver intact', async () => {
    const { registry } = setup(function (this: { reachable: () => Set<string> }) {
      expect(this.reachable().has(NATIVE)).toBe(true);
      return Promise.resolve({ ok: true });
    });
    const id = idOf(registry.send({ agentId: NATIVE, text: 'hello' }));
    await vi.waitFor(() => expect(registry.get(id)?.status).toBe('delivered'));
  });
});
