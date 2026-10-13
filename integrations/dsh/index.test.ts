import { describe, expect, it, vi } from 'vitest';
import type { BridgeEvent, BridgePoll } from '../../shared/native-bridge';
import { DshBridge } from './index';
import type { DshEvent, DshHeader } from './mapping';

const header: DshHeader = { id: 'session-a', createdAt: Date.now(), cwd: '/tmp/app' };
const promptEvent: DshEvent = { type: 'user/message', seq: 0, time: Date.now(),
  data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } };

function fixture(poll: BridgePoll | undefined = { messages: [], viewers: 0, permissions: false, messaging: false }) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const sent: BridgeEvent[] = [];
  const prompt = vi.fn(async () => ({ accepted: true as const }));
  const ctx = {
    sessionQuery: {
      listSessions: vi.fn(async () => [{ header, live: true, persisted: true }]),
      readSession: vi.fn(async () => ({ session: header, events: [promptEvent] })),
    },
    sessionController: { prompt },
    agents: { get: () => undefined, list: (): ReturnType<ConstructorParameters<typeof DshBridge>[0]['agents']['list']> => [] },
    on: (name: string, handler: (...args: any[]) => unknown) => {
      handlers.set(name, handler); return () => true;
    },
    effect: () => undefined,
  };
  const client = {
    send: vi.fn(async (events: BridgeEvent[]) => { sent.push(...events); return true; }),
    poll: vi.fn(async (): Promise<BridgePoll | undefined> => poll),
    acknowledge: vi.fn(async () => {}),
    permission: vi.fn(async () => ({ behavior: 'terminal' as const })),
    stop: vi.fn(async () => {}),
  };
  return { ctx, client, handlers, sent, prompt };
}

async function settled(bridge: DshBridge): Promise<void> {
  const internal = bridge as unknown as { polling: boolean; flushing?: Promise<void> };
  await vi.waitFor(() => expect(internal.polling).toBe(false));
  await internal.flushing;
}

describe('DSH native Cordis bridge', () => {
  it('loads exact history, then ignores a duplicate live seq and forwards the next one', async () => {
    const f = fixture();
    const bridge = new DshBridge(f.ctx, f.client);
    try {
      await bridge.start();
      await vi.waitFor(() => expect(f.sent.some((item) => item.type === 'terminal')).toBe(true));
      expect(f.sent[0]).toMatchObject({ type: 'session', session: { sessionId: header.id } });
      const before = f.sent.filter((item) => item.type === 'terminal').length;
      f.handlers.get('session/event')!({ id: header.id, header }, promptEvent);
      const next: DshEvent = { type: 'turn/start', seq: 1, time: Date.now(), data: { turn: 1 } };
      f.handlers.get('session/event')!({ id: header.id, header }, next);
      await vi.waitFor(() => expect(f.sent.some((item) => item.type === 'status' && item.status === 'working')).toBe(true));
      expect(f.sent.filter((item) => item.type === 'terminal')).toHaveLength(before);
    } finally { await bridge.stop(); }
  });

  it('passes a polled command to native SessionController and acknowledges inbox admission', async () => {
    const f = fixture({ viewers: 1, permissions: true, messaging: true,
      messages: [{ id: 'command-1', sessionId: header.id, text: 'continue', mode: 'queue' }] });
    const bridge = new DshBridge(f.ctx, f.client);
    try {
      await bridge.start();
      await vi.waitFor(() => expect(f.client.acknowledge).toHaveBeenCalledWith([{ id: 'command-1', ok: true }]));
      expect(f.prompt).toHaveBeenCalledWith({ requestId: 'command-1', sessionId: header.id,
        mode: 'queue', content: [{ type: 'text', text: 'continue' }] }, expect.any(AbortSignal));
      await (bridge as unknown as { poll(): Promise<void> }).poll();
      expect(f.prompt).toHaveBeenCalledTimes(1);
      expect(f.client.acknowledge).toHaveBeenCalledTimes(2);
    } finally { await bridge.stop(); }
  });

  it('re-registers an instance and exact history after a server restart with an empty transport queue', async () => {
    const f = fixture();
    let registered = false;
    let live = false;
    f.client.send.mockImplementation(async (events) => {
      f.sent.push(...events);
      registered = true;
      if (events.some((event) => event.type === 'session' && !event.historical)) live = true;
      return true;
    });
    f.client.poll.mockImplementation(async () => registered
      ? { messages: [], viewers: 1, permissions: true, messaging: true } : undefined);
    const bridge = new DshBridge(f.ctx, f.client);
    const runPoll = () => (bridge as unknown as { poll(): Promise<void> }).poll();
    try {
      await bridge.start();
      await vi.waitFor(() => expect(f.client.poll).toHaveBeenCalled());
      await settled(bridge);
      await runPoll();
      const before = f.sent.length;
      registered = live = false;
      await runPoll(); // The restarted server reports that this instance is unknown.
      await runPoll();
      expect(registered).toBe(true);
      expect(live).toBe(true);
      expect(f.sent.slice(before)[0]).toEqual({ type: 'heartbeat' });
      expect(f.sent.slice(before)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'session', historical: false }),
        expect.objectContaining({ type: 'terminal', reset: true }),
      ]));
      expect(f.ctx.sessionQuery.listSessions).toHaveBeenCalledTimes(2);
    } finally { await bridge.stop(); }
  });

  it('probes transport before rereading the corpus, then registers known live agents even when history is unavailable', async () => {
    const f = fixture();
    const agent = { session: { id: header.id, header }, status: 'running' as const, options: { model: 'GLM-5.3' } };
    f.ctx.agents.list = () => [agent];
    f.client.poll.mockResolvedValue(undefined);
    const bridge = new DshBridge(f.ctx, f.client);
    const runPoll = () => (bridge as unknown as { poll(): Promise<void> }).poll();
    try {
      await bridge.start();
      await vi.waitFor(() => expect(f.client.poll).toHaveBeenCalled());
      await settled(bridge);
      const before = f.ctx.sessionQuery.listSessions.mock.calls.length;
      f.client.send.mockResolvedValueOnce(false);
      await runPoll();
      expect(f.ctx.sessionQuery.listSessions).toHaveBeenCalledTimes(before);
      f.ctx.sessionQuery.listSessions.mockRejectedValueOnce(new Error('Corpus unavailable'));
      f.client.poll.mockResolvedValue({ messages: [], viewers: 1, permissions: true, messaging: true });
      f.sent.length = 0;
      await runPoll();
      expect(f.sent).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'session', historical: false, session: expect.objectContaining({ sessionId: header.id, status: 'working', model: 'GLM-5.3' }),
      })]));
    } finally { await bridge.stop(); }
  });

  it('waits for restored session delivery before making a local viewer available', async () => {
    const f = fixture();
    const bridge = new DshBridge(f.ctx, f.client);
    const internal = bridge as unknown as { poll(): Promise<void>; viewerAvailable(): boolean };
    try {
      await bridge.start();
      await vi.waitFor(() => expect(f.client.poll).toHaveBeenCalled());
      await settled(bridge);
      f.client.poll.mockResolvedValueOnce(undefined);
      await internal.poll();
      let finish!: (ok: boolean) => void;
      f.client.send.mockImplementation(async (events) => {
        f.sent.push(...events);
        if (events.some((event) => event.type === 'session')) return new Promise<boolean>((resolve) => { finish = resolve; });
        return true;
      });
      f.client.poll.mockResolvedValue({ messages: [], viewers: 1, permissions: true, messaging: true });
      const before = f.client.poll.mock.calls.length;
      const reconnect = internal.poll();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(f.client.poll).toHaveBeenCalledTimes(before);
      expect(internal.viewerAvailable()).toBe(false);
      finish(true);
      await reconnect;
      expect(internal.viewerAvailable()).toBe(true);
    } finally { await bridge.stop(); }
  });
});
