import type { BridgePermission, BridgePermissionResult } from '../../shared/native-bridge';

/** Native dsh-user-approval outcome vocabulary (0.2.0-rc.2). */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface ApprovalRequest {
  agent: { session: { id: string } };
  toolName: string;
  callId?: string;
  reason?: string;
  signal?: AbortSignal;
}

/** Owns only live waterfall promises; durable approval/asked IDs are audit IDs, not answer handles. */
export class ApprovalGate {
  private readonly pending = new Set<() => void>();
  constructor(
    private readonly available: () => boolean,
    private readonly ask: (request: BridgePermission, signal: AbortSignal) => Promise<BridgePermissionResult>,
    private readonly timeoutMs = 60_000,
  ) {}

  handle(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    if (request.signal?.aborted) return Promise.resolve('cancelled');
    if (!this.available()) return next();
    const controller = new AbortController();
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        this.pending.delete(onDisconnect);
        controller.abort();
      };
      const finish = (result: ApprovalOutcome | 'fallback') => {
        if (settled) return;
        settled = true;
        cleanup();
        if (result === 'fallback') Promise.resolve().then(next).then(resolve, reject);
        else resolve(result);
      };
      const onAbort = () => finish('cancelled');
      const onDisconnect = () => finish('fallback');
      const timer = setTimeout(() => finish('fallback'), this.timeoutMs);
      this.pending.add(onDisconnect);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      if (request.signal?.aborted) { finish('cancelled'); return; }
      // Never forward arbitrary tool arguments through the approval boundary.
      const payload: BridgePermission = {
        sessionId: request.agent.session.id, tool: request.toolName,
        ...(request.callId ? { callId: request.callId } : {}),
        ...(request.reason ? { reason: request.reason } : {}), timeoutMs: this.timeoutMs,
      };
      Promise.resolve().then(() => this.ask(payload, controller.signal)).then(
        (result) => {
          if (result.behavior === 'allow') finish('allowed-once');
          else if (result.behavior === 'deny') finish('rejected');
          else if (result.behavior === 'cancelled' && request.signal?.aborted) finish('cancelled');
          else finish('fallback');
        },
        () => finish(request.signal?.aborted ? 'cancelled' : 'fallback'),
      );
    });
  }

  /** A viewer loss or plugin disposal delegates each pending request once to the next DSH answerer. */
  disconnect(): void {
    for (const fallback of [...this.pending]) fallback();
  }
}
