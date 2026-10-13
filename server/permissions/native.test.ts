import { describe, expect, it } from 'vitest';
import type { PermissionDecision } from '../../shared/types';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { parseHookInput, PermissionRegistry } from './registry';

const NATIVE = 'pi:session-1';
const CLAUDE = 'claude:1';
const SESSION = 'session-1';

function setup() {
  let now = 1_000_000;
  let viewers = 1;
  let scans = 0;
  let registry: PermissionRegistry;
  const office = new Office({
    names: new NameStore(null), version: 't', startedAt: 0, accounts: () => [], sources: () => [],
    accountName: () => undefined, permissions: () => registry?.snapshot() ?? new Map(), now: () => now,
  });
  office.addMain({ id: NATIVE, provider: 'pi', account: 'pi', sessionId: SESSION, cwd: '/p/a', role: 'Agent', startedAt: 1, status: 'working' });
  office.get(NATIVE)!.capabilities = { permissions: true };
  office.addMain({ id: CLAUDE, account: 'claude', sessionId: SESSION, cwd: '/p/a', role: 'Agent', startedAt: 1, status: 'working' });
  registry = new PermissionRegistry({ office, viewers: () => viewers, now: () => now, transcriptPathOf: () => { scans++; return undefined; } });
  return { office, registry, setViewers: (n: number) => { viewers = n; }, advance: (ms: number) => { now += ms; }, get scans() { return scans; } };
}

const nativeRequest = { sessionId: SESSION, tool: 'Bash', input: { command: 'npm test' }, timeoutMs: 30_000 };
const idOf = (r: ReturnType<PermissionRegistry['registerNative']>) => {
  if ('skip' in r) throw new Error(`skipped: ${r.skip}`);
  return r.id;
};

describe('PermissionRegistry native approvals', () => {
  it('settles a disconnected waiter while keeping the request available for a new wait', async () => {
    const { registry } = setup();
    const id = idOf(registry.registerNative(NATIVE, nativeRequest));
    const first = registry.wait(id, 25_000)!;
    first.cancel();
    await expect(first.result).resolves.toEqual({ status: 'pending' });
    const next = registry.wait(id, 25_000)!;
    expect(registry.decide(id, { behavior: 'allow' })).toBe('ok');
    await expect(next.result).resolves.toEqual({ status: 'decided', behavior: 'allow' });
  });

  it('requires an exact live native agent and capability; public hook rejects forged native provider', () => {
    const { office, registry, setViewers } = setup();
    expect(() => parseHookInput({ provider: 'pi', session_id: SESSION, tool_name: 'Bash' })).toThrow(/provider/);
    expect(() => registry.register({ provider: 'dsh', session_id: SESSION, tool_name: 'Bash' })).toThrow(/provider/);
    expect(registry.registerNative(CLAUDE, nativeRequest)).toEqual({ skip: 'unknown-session' });
    expect(registry.registerNative(NATIVE, { ...nativeRequest, sessionId: 'wrong' })).toEqual({ skip: 'unknown-session' });
    office.get(NATIVE)!.capabilities = {};
    expect(registry.registerNative(NATIVE, nativeRequest)).toEqual({ skip: 'unknown-session' });
    office.get(NATIVE)!.capabilities = { permissions: true };
    setViewers(0);
    expect(registry.registerNative(NATIVE, nativeRequest)).toEqual({ skip: 'no-viewers' });
  });

  it('registers native approval only on native agent, allows one-shot allow/deny/terminal but no persistent or answer decision', async () => {
    const { office, registry } = setup();
    const id = idOf(registry.registerNative(NATIVE, nativeRequest));
    const info = registry.detail(id)!;
    expect(info).toMatchObject({ id, provider: 'pi', tool: 'Bash', title: 'Bash(npm test)', input: 'npm test' });
    expect(office.commit().snapshot.agents.find((a) => a.id === NATIVE)?.permission?.id).toBe(id);
    expect(office.get(CLAUDE)?.permission).toBeUndefined();
    const invalidDecisions: PermissionDecision[] = [
      { behavior: 'allow', suggestion: 0 },
      { behavior: 'deny', interrupt: true },
      { behavior: 'answer', answers: [] },
    ];
    for (const decision of invalidDecisions) expect(registry.decide(id, decision)).toBe('unsupported');
    const waiting = registry.wait(id, 25_000)!;
    expect(registry.decide(id, { behavior: 'deny', message: 'no' })).toBe('ok');
    await expect(waiting.result).resolves.toEqual({ status: 'decided', behavior: 'deny', message: 'no' });
    expect(registry.wait(id, 10)).toBeUndefined();

    const terminalId = idOf(registry.registerNative(NATIVE, nativeRequest));
    const terminalWait = registry.wait(terminalId, 25_000)!;
    expect(registry.decide(terminalId, { behavior: 'terminal' })).toBe('ok');
    await expect(terminalWait.result).resolves.toEqual({ status: 'released', reason: 'terminal' });
  });

  it('releases on viewer disconnect or bridge cancellation without scanning Claude transcript', async () => {
    const ctx = setup();
    const id = idOf(ctx.registry.registerNative(NATIVE, nativeRequest));
    const waiting = ctx.registry.wait(id, 25_000)!;
    ctx.setViewers(0);
    ctx.registry.tick();
    await expect(waiting.result).resolves.toEqual({ status: 'released', reason: 'no-viewers' });
    expect(ctx.scans).toBe(0);
    expect(ctx.registry.decide(id, { behavior: 'allow' })).toBe('not-found');

    ctx.setViewers(1);
    const next = idOf(ctx.registry.registerNative(NATIVE, nativeRequest));
    const nextWait = ctx.registry.wait(next, 25_000)!;
    expect(ctx.registry.releaseNative(next)).toBe(true);
    expect(ctx.registry.releaseNative(next)).toBe(false);
    await expect(nextWait.result).resolves.toEqual({ status: 'released', reason: 'cancelled' });
    ctx.advance(2_000);
    ctx.registry.tick();
    expect(ctx.scans).toBe(0);
  });

  it('Claude hook resolves only Claude when a native agent has the same session', () => {
    const { office, registry } = setup();
    const result = registry.register({ session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'npm test' } });
    expect('id' in result).toBe(true);
    expect(office.commit().snapshot.agents.find((a) => a.id === CLAUDE)?.permission).toBeDefined();
    expect(office.commit().snapshot.agents.find((a) => a.id === NATIVE)?.permission).toBeUndefined();
  });
});
