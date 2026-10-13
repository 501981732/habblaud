import { describe, expect, it, vi } from 'vitest';
import { deliverMessage } from './message';

describe('DSH SessionController prompt admission', () => {
  it('passes queue/steer unchanged and ACKs only native inbox admission', async () => {
    const prompt = vi.fn(async () => ({ accepted: true as const }));
    const abort = new AbortController();
    const command = { id: 'bridge-command-1', sessionId: 's1', text: 'Continue', mode: 'steer' as const };
    await expect(deliverMessage({ prompt }, command, abort.signal)).resolves.toEqual({ id: command.id, ok: true });
    expect(prompt).toHaveBeenCalledWith({ requestId: command.id, sessionId: 's1', mode: 'steer',
      content: [{ type: 'text', text: 'Continue' }] }, abort.signal);
  });

  it('returns a safe failure class without echoing the prompt or SDK error message', async () => {
    const prompt = vi.fn(async () => { throw new Error('secret prompt body'); });
    const result = await deliverMessage({ prompt }, { id: 'm2', sessionId: 'missing', text: 'secret prompt body', mode: 'queue' }, new AbortController().signal);
    expect(result).toEqual({ id: 'm2', ok: false, error: 'Error' });
  });
});
