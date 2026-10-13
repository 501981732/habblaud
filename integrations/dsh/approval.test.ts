import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from './approval';

const request = () => ({ agent: { session: { id: 's1' } }, toolName: 'Bash', callId: 'c1' });

describe('DSH approval waterfall', () => {
  it('delegates immediately without a viewer', async () => {
    const next = vi.fn(async () => 'rejected' as const);
    const ask = vi.fn(async () => ({ behavior: 'allow' as const }));
    const gate = new ApprovalGate(() => false, ask);
    await expect(gate.handle(request(), next)).resolves.toBe('rejected');
    expect(next).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it('claims one reply and ignores late disconnect', async () => {
    const next = vi.fn(async () => 'rejected' as const);
    const gate = new ApprovalGate(() => true, async () => ({ behavior: 'allow' }));
    await expect(gate.handle(request(), next)).resolves.toBe('allowed-once');
    gate.disconnect();
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through on disconnect and ignores a late browser answer', async () => {
    let answer!: (value: { behavior: 'allow' }) => void;
    const ask = () => new Promise<{ behavior: 'allow' }>((resolve) => { answer = resolve; });
    const next = vi.fn(async () => 'rejected' as const);
    const gate = new ApprovalGate(() => true, ask);
    const pending = gate.handle(request(), next);
    await Promise.resolve();
    gate.disconnect();
    await expect(pending).resolves.toBe('rejected');
    answer({ behavior: 'allow' });
    await Promise.resolve();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled on upstream abort without invoking Web fallback', async () => {
    const abort = new AbortController();
    const next = vi.fn(async () => 'allowed-once' as const);
    const gate = new ApprovalGate(() => true, () => new Promise(() => {}));
    const pending = gate.handle({ ...request(), signal: abort.signal }, next);
    abort.abort();
    await expect(pending).resolves.toBe('cancelled');
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through after timeout', async () => {
    vi.useFakeTimers();
    try {
      const gate = new ApprovalGate(() => true, () => new Promise(() => {}), 10);
      const next = vi.fn(async () => 'unavailable' as const);
      const pending = gate.handle(request(), next);
      await vi.advanceTimersByTimeAsync(10);
      await expect(pending).resolves.toBe('unavailable');
      expect(next).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
