import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BRIDGE_VERSION,
  type BridgeConnectionConfig,
  type BridgeEnvelope,
  type BridgeEvent,
  type BridgePermission,
  type BridgePermissionResult,
  type BridgePoll,
  type NativeProvider,
} from '../../shared/native-bridge';

const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

export interface NativeClientOptions {
  configFile?: string;
  instanceId?: string;
  fetch?: typeof fetch;
}

/** An adapter's local transport. It carries no model credentials or provider SDK dependencies. */
export class NativeBridgeClient {
  readonly instanceId: string;
  private seq = 0;
  private queued: Array<{ body: BridgeEnvelope; bytes: number }> = [];
  private queuedBytes = 0;
  private chain: Promise<boolean> = Promise.resolve(true);
  private readonly abort = new AbortController();
  private readonly fetcher: typeof fetch;
  private readonly configFile: string;

  constructor(readonly provider: NativeProvider, options: NativeClientOptions = {}) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.configFile = options.configFile ?? process.env.HABBLAUD_BRIDGE_CONFIG ?? join(homedir(), '.habblaud', 'bridge.json');
    this.fetcher = options.fetch ?? fetch;
  }

  private config(): BridgeConnectionConfig | undefined {
    try {
      const file = readFileSync(this.configFile, 'utf8');
      if (file.length > 8192) return undefined;
      const c = JSON.parse(file) as BridgeConnectionConfig;
      if (c.version !== BRIDGE_VERSION || typeof c.token !== 'string' || c.token.length < 16 || c.token.length > 256) return undefined;
      const u = new URL(c.url);
      const h = u.hostname.replace(/^\[|\]$/g, '');
      if (u.protocol !== 'http:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return undefined;
      if (h !== 'localhost' && h !== '::1' && !/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(h)) return undefined;
      return { version: BRIDGE_VERSION, url: u.origin, token: c.token };
    } catch { return undefined; }
  }

  private identity(): { version: 1; provider: NativeProvider; instanceId: string } {
    return { version: BRIDGE_VERSION, provider: this.provider, instanceId: this.instanceId };
  }

  private async request(path: string, body: unknown, signal?: AbortSignal, timeout = 5000): Promise<unknown> {
    const c = this.config();
    if (!c || this.abort.signal.aborted) throw new Error('Local bridge unavailable');
    const signals = [this.abort.signal, AbortSignal.timeout(timeout)];
    if (signal) signals.push(signal);
    const r = await this.fetcher(`${c.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
    if (!r.ok) throw new Error('Local bridge rejected the request');
    return r.json();
  }

  async send(events: BridgeEvent[]): Promise<boolean> {
    if (this.abort.signal.aborted) return false;
    const body: BridgeEnvelope = { ...this.identity(), seq: ++this.seq, events };
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes > MAX_REQUEST_BYTES) return false;
    // Memory remains bounded while Habblaud is stopped. Native adapters re-register their current state on reconnect.
    while (this.queued.length && this.queuedBytes + bytes > MAX_QUEUE_BYTES) {
      this.queuedBytes -= this.queued.shift()!.bytes;
    }
    this.queued.push({ body, bytes });
    this.queuedBytes += bytes;
    return this.flush();
  }

  private flush(): Promise<boolean> {
    this.chain = this.chain.catch(() => false).then(async () => {
      while (this.queued.length && !this.abort.signal.aborted) {
        const item = this.queued[0];
        try {
          const r = await this.request('/api/bridge/events', item.body) as { ok?: boolean };
          if (r?.ok !== true) return false;
        } catch { return false; }
        this.queued.shift();
        this.queuedBytes -= item.bytes;
      }
      return !this.abort.signal.aborted;
    });
    return this.chain;
  }

  async poll(): Promise<BridgePoll | undefined> {
    if (!await this.flush()) return undefined;
    try {
      const r = await this.request('/api/bridge/poll', this.identity()) as BridgePoll;
      if (!r || !Array.isArray(r.messages) || typeof r.viewers !== 'number' || typeof r.permissions !== 'boolean' || typeof r.messaging !== 'boolean') return undefined;
      return r;
    } catch { return undefined; }
  }

  async acknowledge(results: Array<{ id: string; ok: boolean; error?: string }>): Promise<void> {
    if (!results.length) return;
    try { await this.request('/api/bridge/ack', { ...this.identity(), results }); } catch { /* Repeated polls deliver unacknowledged requests. */ }
  }

  async permission(request: BridgePermission, signal?: AbortSignal): Promise<BridgePermissionResult> {
    if (signal?.aborted || this.abort.signal.aborted) return { behavior: 'cancelled' };
    let id: string | undefined;
    try {
      const r = await this.request('/api/bridge/permissions', { ...this.identity(), request }, signal) as { id?: string; expiresAt?: number; skip?: string };
      if (!r?.id || r.skip || typeof r.expiresAt !== 'number') return { behavior: 'terminal' };
      id = r.id;
      const deadline = Math.min(r.expiresAt, Date.now() + (request.timeoutMs ?? 300_000) + 5000);
      while (Date.now() < deadline) {
        const d = await this.request(`/api/bridge/permissions/${encodeURIComponent(id)}/wait`, this.identity(), signal, 28_000) as {
          status?: string; behavior?: string; message?: string;
        };
        if (d.status === 'decided' && (d.behavior === 'allow' || d.behavior === 'deny')) return { behavior: d.behavior, ...(d.message ? { message: d.message } : {}) };
        if (d.status !== 'pending') return { behavior: 'terminal' };
      }
    } catch { /* Disconnection and timeouts release the native approval chain. */ }
    if (id) {
      try { await this.request(`/api/bridge/permissions/${encodeURIComponent(id)}/cancel`, this.identity()); } catch { /* Server expiry is the final cleanup. */ }
    }
    return { behavior: signal?.aborted || this.abort.signal.aborted ? 'cancelled' : 'terminal' };
  }

  async stop(): Promise<void> {
    if (this.abort.signal.aborted) return;
    try { await this.request('/api/bridge/stop', this.identity(), undefined, 1500); } catch { /* Heartbeat expiry covers an unavailable server. */ }
    this.abort.abort();
    this.queued = [];
    this.queuedBytes = 0;
  }
}
