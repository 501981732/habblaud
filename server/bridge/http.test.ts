import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEnvelope, NativeProvider } from '../../shared/native-bridge';
import type { AgentInfo } from '../../shared/types';
import type { WaitResult } from '../permissions/registry';
import type { NativeSource } from './source';
import { NativeBridgeHttpController, readBridgeJson, type NativeBridgeHttpOptions } from './http';

const TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz123456';
const identity = (provider: NativeProvider = 'pi', instanceId = 'pi-a') => ({ version: 1 as const, provider, instanceId });
const agent = (provider: NativeProvider, id: string): AgentInfo => ({ id, provider } as AgentInfo);

class SourceFake {
  private sessions = new Map<string, { instanceId: string; agentId: string }>();
  private instances = new Set<string>();
  private polled = new Set<string>();
  constructor(readonly provider: NativeProvider) {}
  ingest(envelope: BridgeEnvelope): void {
    this.instances.add(envelope.instanceId);
    for (const event of envelope.events) {
      if (event.type === 'session') this.sessions.set(event.session.sessionId, { instanceId: envelope.instanceId, agentId: `${this.provider}:${event.session.sessionId}` });
      if (event.type === 'closed') this.sessions.delete(event.sessionId);
    }
  }
  poll(instanceId: string): boolean { if (!this.instances.has(instanceId)) return false; this.polled.add(instanceId); return true; }
  owns(instanceId: string, sessionId: string): string | undefined {
    const s = this.sessions.get(sessionId);
    return s?.instanceId === instanceId ? s.agentId : undefined;
  }
  ownerOf(agentId: string): { instanceId: string; sessionId: string } | undefined {
    for (const [sessionId, s] of this.sessions) if (s.agentId === agentId) return { instanceId: s.instanceId, sessionId };
    return undefined;
  }
  reachable(): Set<string> {
    return new Set([...this.sessions.values()].filter((s) => this.polled.has(s.instanceId)).map((s) => s.agentId));
  }
  stopInstance(instanceId: string): void {
    this.instances.delete(instanceId); this.polled.delete(instanceId);
    for (const [id, s] of this.sessions) if (s.instanceId === instanceId) this.sessions.delete(id);
  }
}

const open: NativeBridgeHttpController[] = [];
afterEach(() => { for (const controller of open.splice(0)) controller.stop(); vi.useRealTimers(); });

function fixture() {
  const pi = new SourceFake('pi');
  const dsh = new SourceFake('dsh');
  const pending = new Map<string, { agentId: string; sessionId: string }>();
  let released = 0;
  let viewers = 1;
  let waits = 0;
  let waitResult: Promise<WaitResult> | undefined;
  const permissions = {
    registerNative: (agentId: string, request: { sessionId: string }) => {
      if (viewers === 0) return { skip: 'no-viewers' as const };
      pending.set('p-native', { agentId, sessionId: request.sessionId });
      return { id: 'p-native', expiresAt: Date.now() + 30_000 };
    },
    wait: (id: string) => {
      if (!pending.has(id)) return undefined;
      waits++;
      return { result: waitResult ?? Promise.resolve({ status: 'released' as const, reason: 'terminal' as const }), cancel: () => {} };
    },
    releaseNative: (id: string) => { const had = pending.delete(id); if (had) released++; return had; },
  } as NativeBridgeHttpOptions['permissions'];
  const controller = new NativeBridgeHttpController({ sources: new Map([['pi', pi as unknown as NativeSource], ['dsh', dsh as unknown as NativeSource]]),
    permissions, viewers: () => viewers, messaging: true, token: TOKEN });
  open.push(controller);
  const post = async (path: string, body: unknown, token = TOKEN) => {
    const req = Object.assign(new EventEmitter(), { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${token}`, 'content-length': String(Buffer.byteLength(JSON.stringify(body))) },
      socket: { setTimeout: () => undefined } }) as unknown as IncomingMessage;
    let status = 0;
    let value: Record<string, unknown> = {};
    let ended = false;
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      setHeader: () => undefined,
      writeHead: (code: number) => { status = code; },
      end: (data: string) => { value = JSON.parse(data) as Record<string, unknown>; ended = true; res.emit('close'); },
    }) as unknown as ServerResponse;
    Object.defineProperty(res, 'writableEnded', { get: () => ended });
    await controller.handle(req, res, new URL(`/api/bridge/${path}`, 'http://localhost'), async () => body);
    return { status, body: value };
  };
  const register = async (provider: NativeProvider, instanceId: string, sessionId: string) => post('events', {
    ...identity(provider, instanceId), seq: 1, events: [{ type: 'session', session: {
      sessionId, account: 'primary', cwd: '/workspace', startedAt: Date.now(), status: 'working',
      capabilities: { messages: true, permissions: true },
    } }],
  });
  return { pi, dsh, post, register, controller, pending, setViewers: (n: number) => { viewers = n; }, getReleased: () => released,
    setWaitResult: (result: Promise<WaitResult>) => { waitResult = result; }, getWaits: () => waits };
}

describe('native bridge HTTP controller', () => {
  it('requires bearer auth and strictly bounded event envelopes', async () => {
    const f = await fixture();
    expect((await f.post('events', { ...identity(), seq: 1, events: [{ type: 'heartbeat' }] }, 'wrong')).status).toBe(401);
    expect((await f.post('events', { ...identity(), seq: 1, events: [{ type: 'heartbeat' }] })).status).toBe(200);
    expect((await f.post('events', { ...identity(), seq: 2, events: [{ type: 'unknown' }] })).status).toBe(400);
    expect((await f.post('events', { ...identity(), seq: 2, events: [{ type: 'terminal', sessionId: 's', entries: [
      { kind: 'user', id: 'x', at: Date.now(), text: 'x'.repeat(70_000) },
    ] }] })).status).toBe(400);
    expect((await f.post('poll', { ...identity(), extra: true })).status).toBe(400);
    expect((await f.post('events', { ...identity(), seq: 2, events: [{ type: 'heartbeat' }], padding: 'x'.repeat(5 * 1024 * 1024) })).status).toBe(413);
  });

  it('delivers and acknowledges only to the exact provider, instance and session, with idempotent ACK', async () => {
    const f = await fixture();
    await f.register('pi', 'pi-a', 'session');
    await f.register('dsh', 'pi-a', 'session');
    await f.register('pi', 'pi-b', 'other');
    await f.post('poll', identity('pi', 'pi-a'));
    const result = f.controller.run(agent('pi', 'pi:session'), '原文不改', 'm-one');
    expect((await f.post('poll', identity('dsh', 'pi-a'))).body.messages).toEqual([]);
    expect((await f.post('poll', identity('pi', 'pi-b'))).body.messages).toEqual([]);
    expect((await f.post('poll', identity('pi', 'pi-a'))).body.messages).toEqual([{ id: 'm-one', sessionId: 'session', text: '原文不改', mode: 'queue' }]);
    await f.post('ack', { ...identity('dsh', 'pi-a'), results: [{ id: 'm-one', ok: true }] });
    await f.post('ack', { ...identity('pi', 'pi-b'), results: [{ id: 'm-one', ok: true }] });
    expect((await f.post('poll', identity('pi', 'pi-a'))).body.messages).toHaveLength(1);
    await f.post('ack', { ...identity('pi', 'pi-a'), results: [{ id: 'm-one', ok: true }] });
    expect(await result).toEqual({ ok: true });
    await f.post('ack', { ...identity('pi', 'pi-a'), results: [{ id: 'm-one', ok: false }] });
    expect((await f.post('poll', identity('pi', 'pi-a'))).body.messages).toEqual([]);
    const failed = f.controller.run(agent('pi', 'pi:session'), 'second', 'm-two');
    await f.post('ack', { ...identity('pi', 'pi-a'), results: [{ id: 'm-two', ok: false, error: 'rejected' }] });
    expect(await failed).toEqual({ ok: false, error: 'rejected' });
  });

  it('limits queues and rejects late ACK after instance stop', async () => {
    const f = await fixture();
    await f.register('pi', 'pi-a', 'session');
    await f.post('poll', identity());
    const waiting = Array.from({ length: 5 }, (_, i) => f.controller.run(agent('pi', 'pi:session'), 'text', `m-${i}`));
    expect(await f.controller.run(agent('pi', 'pi:session'), 'extra', 'm-six')).toMatchObject({ ok: false });
    await f.post('stop', identity());
    expect(await Promise.all(waiting)).toEqual(Array(5).fill({ ok: false, error: '原生实例已停止' }));
    await f.post('ack', { ...identity(), results: [{ id: 'm-0', ok: true }] });
    expect(f.controller.reachable().size).toBe(0);
  });

  it('retires an old instance command when the session changes owner', async () => {
    const f = fixture();
    await f.register('pi', 'pi-a', 'session');
    await f.post('poll', identity());
    const pending = f.controller.run(agent('pi', 'pi:session'), 'text', 'm-old');
    await f.register('pi', 'pi-b', 'session');
    await f.post('ack', { ...identity(), results: [{ id: 'm-old', ok: true }] });
    expect(await pending).toMatchObject({ ok: false, error: '原生会话已断开' });
    expect((await f.post('poll', identity('pi', 'pi-b'))).body.messages).toEqual([]);
  });

  it('scopes permission wait/cancel to the registered owner and falls back without viewers', async () => {
    const f = await fixture();
    await f.register('pi', 'pi-a', 'session');
    await f.register('pi', 'pi-b', 'other');
    const request = { sessionId: 'session', tool: 'bash', input: { command: 'echo hi' }, timeoutMs: 30_000 };
    expect((await f.post('permissions', { ...identity('pi', 'pi-b'), request })).body).toEqual({ skip: 'unknown-session' });
    const registered = await f.post('permissions', { ...identity(), request });
    expect(registered).toMatchObject({ status: 201, body: { id: 'p-native' } });
    expect((await f.post('permissions/p-native/wait', identity('pi', 'pi-b'))).status).toBe(404);
    expect((await f.post('permissions/p-native/cancel', identity('dsh', 'pi-a'))).status).toBe(404);
    expect((await f.post('permissions/p-native/wait', identity())).body).toMatchObject({ status: 'released', reason: 'terminal' });
    expect((await f.post('permissions', { ...identity(), request })).status).toBe(201);
    expect((await f.post('permissions/p-native/cancel', identity())).body).toEqual({ ok: true });
    expect(f.getReleased()).toBe(1);
    f.setViewers(0);
    expect((await f.post('permissions', { ...identity(), request })).body).toEqual({ skip: 'no-viewers' });
    const second = await f.post('permissions', { ...identity(), request });
    expect(second.body).toEqual({ skip: 'no-viewers' });
  });

  it.each(['allow', 'deny'] as const)('never returns %s to an instance replaced while its approval wait is pending', async (decision) => {
    const f = fixture();
    await f.register('pi', 'pi-a', 'session');
    const registered = await f.post('permissions', { ...identity('pi', 'pi-a'), request: { sessionId: 'session', tool: 'bash' } });
    expect(registered.status).toBe(201);
    let settle!: (result: WaitResult) => void;
    f.setWaitResult(new Promise<WaitResult>((resolve) => { settle = resolve; }));
    const oldWait = f.post('permissions/p-native/wait', identity('pi', 'pi-a'));
    await vi.waitFor(() => expect(f.getWaits()).toBe(1));
    await f.register('pi', 'pi-b', 'session');
    settle({ status: 'decided', behavior: decision });
    expect(await oldWait).toMatchObject({ status: 200, body: { status: 'released', reason: 'cancelled' } });
    expect(f.getReleased()).toBe(1);
    expect((await f.post('permissions/p-native/wait', identity('pi', 'pi-b'))).status).toBe(404);
  });

  it('fails an unacknowledged message after 60 seconds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.register('pi', 'pi-a', 'session');
    await f.post('poll', identity());
    const pending = f.controller.run(agent('pi', 'pi:session'), 'text', 'm-timeout');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ ok: false, error: '原生会话未在 60 秒内确认消息' });
    expect((await f.post('poll', identity())).body.messages).toEqual([]);
  });

  it('reads at most the configured JSON byte limit', async () => {
    const request = () => Object.assign(new EventEmitter(), { headers: { 'content-type': 'application/json' }, resume: () => undefined }) as unknown as IncomingMessage;
    const valid = request();
    const parsed = readBridgeJson(valid, 32);
    valid.emit('data', Buffer.from('{"ok":true}'));
    valid.emit('end');
    expect(await parsed).toEqual({ ok: true });
    const large = request();
    const rejected = readBridgeJson(large, 8);
    large.emit('data', Buffer.from('{"ok":true}'));
    large.emit('end');
    await expect(rejected).rejects.toMatchObject({ status: 413 });
  });
});
