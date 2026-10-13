import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEvent, BridgePermissionResult, BridgePoll } from '../../shared/native-bridge';
import { PiBridgeExtension, type PiBridge } from './extension';

function fixture(over: { approvals?: boolean; permission?: PiBridge['permission'] } = {}) {
  const handlers = new Map<string, (event: Record<string, unknown>, ctx: unknown) => unknown>();
  const sent: BridgeEvent[][] = [];
  const acknowledgements: Array<{ id: string; ok: boolean; error?: string }[]> = [];
  const prompts: Array<{ text: string; mode: string }> = [];
  const pending: BridgePoll[] = [];
  const bridge: PiBridge = {
    send: async (events) => { sent.push(events); return true; },
    poll: async () => pending.shift(),
    acknowledge: async (results) => { acknowledgements.push(results); },
    permission: over.permission ?? (async () => ({ behavior: 'terminal' })),
    stop: async () => undefined,
  };
  let sessionId = 'pi-1';
  const ctx = {
    cwd: '/repo', hasUI: true, model: { id: 'test-model' },
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => undefined,
      getHeader: () => ({ type: 'session', id: sessionId, cwd: '/repo', timestamp: '2026-10-13T00:00:00Z' }),
      getBranch: () => [],
      getLeafId: () => null,
      getSessionName: () => undefined,
    },
    ui: { confirm: vi.fn(async () => true) },
  };
  const api = {
    on: (event: string, handler: (e: Record<string, unknown>, ctx: unknown) => unknown) => { handlers.set(event, handler); },
    sendUserMessage: (text: string, opts: { deliverAs: string }) => { prompts.push({ text, mode: opts.deliverAs }); },
  };
  const extension = new PiBridgeExtension(api as never, { createBridge: () => bridge, approvals: over.approvals ?? false, pollMs: 100, heartbeatMs: 500 });
  extension.install();
  const fire = async (event: string, data: Record<string, unknown> = {}) => handlers.get(event)?.(data, ctx);
  return { extension, bridge, sent, acknowledgements, prompts, pending, ctx, fire, setSessionId: (id: string) => { sessionId = id; } };
}

const flatten = (events: BridgeEvent[][]) => events.flat();

afterEach(() => { vi.useRealTimers(); });

describe('Pi native extension', () => {
  it('localizes generated waiting and interruption copy but preserves a Pi prompt title', async () => {
    const f = fixture();
    await f.fire('session_start');
    await f.fire('ui_prompt_start');
    await f.fire('ui_prompt_start', { title: 'Nested Pi title' });
    await f.fire('ui_prompt_end');
    await f.fire('ui_prompt_end');
    await f.fire('ui_prompt_start', { title: 'Custom question from Pi' });
    await f.fire('ui_prompt_end');
    await f.fire('agent_settled', { aborted: true });
    await f.extension.shutdown();
    const events = flatten(f.sent);
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'waiting',
      waitingFor: 'Aguardando você', waitingForI18n: { key: 'Aguardando você' } }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'waiting',
      waitingFor: 'Custom question from Pi' }));
    expect(events.filter((e) => e.type === 'status' && e.waitingFor === 'Aguardando você')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'status' && e.waitingFor === 'Custom question from Pi'))
      .toEqual([expect.not.objectContaining({ waitingForI18n: expect.anything() })]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'activity', activity: expect.objectContaining({
      text: 'Execução interrompida', i18n: { key: 'Execução interrompida' },
    }) }));
  });

  it('stays working after agent_end and settles only at agent_settled; concurrent tools correlate by id', async () => {
    const f = fixture();
    await f.fire('session_start');
    await f.fire('agent_start');
    await f.fire('tool_execution_start', { toolCallId: 'a', toolName: 'bash', args: { command: 'npm test' } });
    await f.fire('tool_execution_start', { toolCallId: 'b', toolName: 'read', args: { path: 'a.ts' } });
    await f.fire('tool_execution_end', { toolCallId: 'b', toolName: 'read', result: { content: [{ type: 'text', text: 'file' }] }, isError: false });
    await f.fire('agent_end');
    await f.fire('agent_start'); // Pi retry or queued continuation
    await f.fire('tool_execution_end', { toolCallId: 'a', toolName: 'bash', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false });
    await f.fire('agent_settled', { aborted: false });
    await f.extension.shutdown();
    const events = flatten(f.sent);
    const statuses = events.filter((e) => e.type === 'status');
    expect(statuses.filter((e) => e.status === 'idle')).toHaveLength(2); // initial bootstrap + final settle
    expect(statuses.at(-1)).toMatchObject({ status: 'idle' });
    const results = events.filter((e) => e.type === 'terminal').flatMap((e) => e.entries).filter((e) => e.kind === 'result');
    expect(results.map((e) => e.kind === 'result' && e.toolUseId)).toEqual(['tool:b', 'tool:a']);
  });

  it('switches session identity and closes the old session', async () => {
    const f = fixture();
    await f.fire('session_start');
    await f.fire('session_shutdown');
    f.setSessionId('pi-2');
    await f.fire('session_start');
    await f.fire('agent_start');
    await f.extension.shutdown();
    expect(flatten(f.sent).filter((e) => e.type === 'closed').map((e) => e.sessionId)).toEqual(['pi-1', 'pi-2']);
    expect(flatten(f.sent).filter((e) => e.type === 'session').map((e) => e.session.sessionId)).toEqual(['pi-1', 'pi-2']);
  });

  it('queues messages with Pi semantics and acknowledges accepted delivery', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.fire('session_start');
    f.pending.push({ viewers: 1, permissions: false, messaging: true, messages: [
      { id: 'm1', sessionId: 'pi-1', text: '马上处理', mode: 'steer' },
      { id: 'm2', sessionId: 'pi-1', text: '接下来处理', mode: 'queue' },
    ] });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.prompts).toEqual([{ text: '马上处理', mode: 'steer' }, { text: '接下来处理', mode: 'followUp' }]);
    expect(f.acknowledgements[0]).toEqual([{ id: 'm1', ok: true }, { id: 'm2', ok: true }]);
    await f.extension.shutdown();
  });

  it('does not inject a duplicate message when the acknowledgement is retried', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.fire('session_start');
    f.bridge.acknowledge = async () => { throw new Error('offline'); };
    const command = { id: 'm1', sessionId: 'pi-1', text: '只送一次', mode: 'queue' as const };
    f.pending.push({ viewers: 1, permissions: false, messaging: true, messages: [command] });
    await vi.advanceTimersByTimeAsync(100);
    f.pending.push({ viewers: 1, permissions: false, messaging: true, messages: [command] });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.prompts).toEqual([{ text: '只送一次', mode: 'followUp' }]);
    await f.extension.shutdown();
  });

  it('uses central allow/deny and Pi confirmation fallback; headless fallback blocks', async () => {
    const approved = fixture({ approvals: true, permission: async () => ({ behavior: 'allow' }) });
    await approved.fire('session_start');
    expect(await approved.fire('tool_call', { toolCallId: 'a', toolName: 'bash', input: { command: 'echo hi' } })).toBeUndefined();
    await approved.extension.shutdown();

    const denied = fixture({ approvals: true, permission: async () => ({ behavior: 'deny', message: '不允许' }) });
    await denied.fire('session_start');
    expect(await denied.fire('tool_call', { toolCallId: 'b', toolName: 'write', input: {} })).toEqual({ block: true, reason: '不允许' });
    await denied.extension.shutdown();

    const fallback = fixture({ approvals: true });
    await fallback.fire('session_start');
    expect(await fallback.fire('tool_call', { toolCallId: 'c', toolName: 'bash', input: {} })).toBeUndefined();
    expect(fallback.ctx.ui.confirm).toHaveBeenCalledOnce();
    fallback.ctx.hasUI = false;
    expect(await fallback.fire('tool_call', { toolCallId: 'd', toolName: 'bash', input: {} })).toMatchObject({ block: true });
    await fallback.extension.shutdown();
  });

  it('reports the web approval wait and restores the actual settled status after a decision', async () => {
    let decide!: (result: BridgePermissionResult) => void;
    const f = fixture({ approvals: true, permission: () => new Promise((resolve) => { decide = resolve; }) });
    await f.fire('session_start');
    const pending = f.fire('tool_call', { toolCallId: 'a', toolName: 'bash', input: {} });
    await vi.waitFor(() => expect(flatten(f.sent)).toContainEqual(expect.objectContaining({
      type: 'status', status: 'waiting', waitingFor: 'aprovar uma permissão',
      waitingForI18n: { key: 'aprovar uma permissão' },
    })));
    await f.fire('agent_settled');
    await f.fire('tool_execution_start', { toolCallId: 'elsewhere', toolName: 'read', args: {} });
    decide({ behavior: 'allow' });
    expect(await pending).toBeUndefined();
    await f.extension.shutdown();
    const statuses = flatten(f.sent).filter((e) => e.type === 'status');
    expect(statuses.filter((e) => e.status === 'waiting')).toHaveLength(3);
    expect(statuses.at(-1)).toMatchObject({ status: 'idle' });
    expect(statuses.at(-1)).not.toHaveProperty('waitingFor');
    expect(statuses.at(-2)).toMatchObject({ status: 'waiting', waitingForI18n: { key: 'aprovar uma permissão' } });
  });

  it('keeps parallel approvals and Pi prompts independent', async () => {
    const decisions = new Map<string, (result: BridgePermissionResult) => void>();
    const f = fixture({ approvals: true, permission: (request) => new Promise((resolve) => {
      decisions.set(request.callId!, resolve);
    }) });
    await f.fire('session_start');
    await f.fire('agent_start');
    const first = f.fire('tool_call', { toolCallId: 'a', toolName: 'bash', input: {} });
    const second = f.fire('tool_call', { toolCallId: 'b', toolName: 'write', input: {} });
    await f.fire('ui_prompt_start', { title: 'Pi question' });
    decisions.get('a')!({ behavior: 'allow' });
    expect(await first).toBeUndefined();
    await f.fire('ui_prompt_end');
    await f.fire('agent_settled');
    decisions.get('b')!({ behavior: 'deny' });
    expect(await second).toMatchObject({ block: true });
    await f.extension.shutdown();
    const statuses = flatten(f.sent).filter((e) => e.type === 'status');
    expect(statuses).toContainEqual(expect.objectContaining({ status: 'waiting', waitingFor: 'Pi question' }));
    expect(statuses.filter((e) => e.waitingFor === 'Pi question')).toHaveLength(2);
    expect(statuses.at(-2)).toMatchObject({ status: 'waiting', waitingForI18n: { key: 'aprovar uma permissão' } });
    expect(statuses.at(-1)).toMatchObject({ status: 'idle' });
  });

  it('aborts a pending permission when the session closes', async () => {
    let release!: (r: BridgePermissionResult) => void;
    const f = fixture({ approvals: true, permission: () => new Promise((resolve) => { release = resolve; }) });
    await f.fire('session_start');
    const pending = f.fire('tool_call', { toolCallId: 'a', toolName: 'bash', input: {} });
    await f.fire('session_shutdown');
    release({ behavior: 'allow' });
    expect(await pending).toMatchObject({ block: true });
  });

  it('blocks on cancelled or timed-out approval', async () => {
    const cancelled = fixture({ approvals: true, permission: async () => ({ behavior: 'cancelled' }) });
    await cancelled.fire('session_start');
    expect(await cancelled.fire('tool_call', { toolCallId: 'x', toolName: 'bash', input: {} })).toMatchObject({ block: true });
    expect(cancelled.ctx.ui.confirm).not.toHaveBeenCalled();
    await cancelled.extension.shutdown();

    vi.useFakeTimers();
    const timeout = fixture({ approvals: true, permission: (_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    await timeout.fire('session_start');
    const pending = timeout.fire('tool_call', { toolCallId: 'y', toolName: 'write', input: {} });
    await vi.advanceTimersByTimeAsync(70_000);
    expect(await pending).toMatchObject({ block: true });
    await timeout.extension.shutdown();
  });

  it('keeps Pi confirmation available after a full bridge approval wait', async () => {
    vi.useFakeTimers();
    const f = fixture({ approvals: true, permission: () => new Promise((resolve) => {
      setTimeout(() => resolve({ behavior: 'terminal' }), 35_000);
    }) });
    await f.fire('session_start');
    const pending = f.fire('tool_call', { toolCallId: 'late', toolName: 'bash', input: {} });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await pending).toBeUndefined();
    expect(f.ctx.ui.confirm).toHaveBeenCalledOnce();
    await f.extension.shutdown();
  });
});
