import { basename } from 'node:path';
import { homedir } from 'node:os';
import { NativeBridgeClient } from '../native/client';
import type { BridgeEvent, BridgeMessageCommand, BridgePermission, BridgePermissionResult, BridgePoll } from '../../shared/native-bridge';
import { ApprovalGate, type ApprovalRequest, type ApprovalOutcome } from './approval';
import { DshProjector, type DshEvent, type DshHeader } from './mapping';
import { deliverMessage, type PromptController } from './message';

/** Host service names and event contracts verified against installed DSH 0.2.0-rc.2. */
export const inject = ['sessionQuery', 'sessionController', 'agents'];
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 150;
const POLL_MS = 2_000;
const VIEWER_STALE_MS = 6_000;

interface DshSession { id: string; header: DshHeader }
interface DshAgent { session: DshSession; status: 'idle' | 'running'; options: { model?: string } }
interface DshContext {
  sessionQuery: {
    listSessions(signal?: AbortSignal): Promise<Array<{ header: DshHeader; live: boolean; persisted: boolean }>>;
    readSession(sessionId: string): Promise<{ session: DshHeader; events: DshEvent[] }>;
  };
  sessionController: PromptController;
  agents: { get(id: string): DshAgent | undefined; list(): DshAgent[] };
  on(name: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean; global?: boolean }): () => boolean;
  effect(execute: () => () => void | Promise<void>, label?: string): unknown;
}
interface NativeClientPort {
  send(events: BridgeEvent[]): Promise<boolean>;
  poll(): Promise<BridgePoll | undefined>;
  acknowledge(results: Array<{ id: string; ok: boolean; error?: string }>): Promise<void>;
  permission(request: BridgePermission, signal?: AbortSignal): Promise<BridgePermissionResult>;
  stop(): Promise<void>;
}

function accountName(): string {
  return `dsh:${basename(process.env.DSH_HOME || `${homedir()}/.dsh`)}`;
}

export class DshBridge {
  private readonly client: NativeClientPort;
  private readonly projector = new DshProjector(accountName());
  private readonly abort = new AbortController();
  private readonly approval: ApprovalGate;
  private readonly pending: BridgeEvent[] = [];
  private readonly liveDuringBoot: Array<{ header: DshHeader; event: DshEvent }> = [];
  private readonly createdDuringBoot = new Map<string, DshHeader>();
  private readonly inFlightMessages = new Set<string>();
  private readonly messageReceipts = new Map<string, { id: string; ok: boolean; error?: string }>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private flushing?: Promise<void>;
  private polling = false;
  private stopped = false;
  private booting = true;
  private viewers = 0;
  private permissions = false;
  private messaging = false;
  private lastPollAt = 0;
  private disconnected = false;
  private resyncing = false;

  constructor(private readonly ctx: DshContext, client?: NativeClientPort) {
    this.client = client ?? new NativeBridgeClient('dsh');
    this.approval = new ApprovalGate(() => this.viewerAvailable(), (request, signal) => this.client.permission(request, signal));
  }

  async start(): Promise<void> {
    const common = { global: true };
    this.ctx.on('session/event', (session: DshSession, event: DshEvent) => {
      if (this.booting) this.liveDuringBoot.push({ header: session.header, event });
      else this.enqueue(this.projector.live(session.header, event));
    }, common);
    this.ctx.on('session/created', (session: DshSession) => {
      if (this.booting) this.createdDuringBoot.set(session.id, session.header);
      else this.enqueue([this.projector.session(session.header, 'idle')]);
    }, common);
    this.ctx.on('session/disposed', (session: DshSession) => {
      if (this.booting) this.createdDuringBoot.delete(session.id);
      else this.enqueue([{ type: 'closed', sessionId: session.id }]);
    }, common);
    this.ctx.on('agent/created', ({ agent }: { agent: DshAgent }) => this.agentStatus(agent), common);
    this.ctx.on('agent/status', ({ agent }: { agent: DshAgent }) => this.agentStatus(agent), common);
    this.ctx.on('agent/disposed', ({ agent }: { agent: DshAgent }) => {
      const status = this.projector.status(agent.session.id, 'offline');
      if (status) this.enqueue([status]);
    }, common);
    this.ctx.on('subagent/start', (info: { id: string; provider: string }) => {
      const child = this.ctx.agents.get(info.id);
      if (child?.session.header.origin === 'subagent') {
        const events: BridgeEvent[] = [this.projector.session(child.session.header, 'working', child.options.model)];
        const parentId = child.session.header.parentSession;
        if (parentId) {
          const parent = this.ctx.agents.get(parentId);
          const status = this.projector.status(parentId, parent?.status === 'running' ? 'working' : 'idle');
          if (status) events.push(status);
        }
        this.enqueue(events);
      }
    }, common);
    this.ctx.on('subagent/end', (info: { id: string }) => {
      const status = this.projector.status(info.id, 'done');
      if (status) this.enqueue([status]);
    }, common);
    this.ctx.on('approval/request', async (request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
      const id = request.agent.session.id;
      const waiting = this.projector.status(id, 'waiting', undefined, 'aprovar uma permissão');
      if (waiting) this.enqueue([waiting]);
      try { return await this.approval.handle(request, next); }
      finally {
        const agent = this.ctx.agents.get(id);
        const status = this.projector.status(id, agent?.status === 'running' ? 'working' : 'idle');
        if (status) this.enqueue([status]);
      }
    },
      { prepend: true, global: true });

    this.pollTimer = setInterval(() => { void this.poll(); }, POLL_MS);
    try {
      await this.scanRecent();
    } catch { // An unavailable corpus does not prevent live observation and prompt/approval handling.
    } finally {
      this.booting = false;
      for (const header of this.createdDuringBoot.values()) {
        if (!this.projector.get(header.id)) this.enqueue([this.projector.session(header, 'idle')]);
      }
      this.createdDuringBoot.clear();
      for (const { header, event } of this.liveDuringBoot.splice(0)) this.enqueue(this.projector.live(header, event));
      for (const agent of this.ctx.agents.list()) this.agentStatus(agent);
      void this.flush();
      void this.poll();
    }
  }

  private async scanRecent(): Promise<void> {
    const records = await this.ctx.sessionQuery.listSessions(this.abort.signal);
    const cutoff = Date.now() - RECENT_MS;
    const recent = records.filter((r) => r.live || r.header.createdAt >= cutoff)
      .sort((a, b) => Number(b.live) - Number(a.live) || b.header.createdAt - a.header.createdAt)
      .slice(0, HISTORY_LIMIT);
    for (const record of recent) {
      if (this.stopped) break;
      try {
        const snapshot = await this.ctx.sessionQuery.readSession(record.header.id);
        const agent = this.ctx.agents.get(record.header.id);
        this.enqueue(this.projector.bootstrap(snapshot.session, snapshot.events, record.live,
          agent?.status === 'running' ? 'working' : 'idle', agent?.options.model));
      } catch { // A concurrently deleted or unreadable session does not block the remaining corpus.
        if (record.live) this.enqueue([this.projector.session(record.header, 'idle')]);
      }
    }
  }

  private agentStatus(agent: DshAgent): void {
    if (this.booting) return;
    if (!this.projector.get(agent.session.id)) this.enqueue([this.projector.session(agent.session.header,
      agent.status === 'running' ? 'working' : 'idle', agent.options.model)]);
    const status = this.projector.status(agent.session.id, agent.status === 'running' ? 'working' : 'idle', agent.options.model);
    if (status) this.enqueue([status]);
  }

  private enqueue(events: BridgeEvent[]): void {
    if (this.stopped || !events.length) return;
    this.pending.push(...events);
    // Keep bounded memory on prolonged server outage; next cold read will reconcile after reconnect.
    if (this.pending.length > 20_000) this.pending.splice(0, this.pending.length - 20_000);
    void this.flush();
  }

  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.stopped || this.disconnected) return Promise.resolve();
    this.flushing = this.drain().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.pending.length && !this.stopped) {
      // The transport queues failed deliveries under their original envelope seq.
      // Every event fits its 5 MiB request bound (terminal snapshots are capped at 4 MiB).
      const batch: BridgeEvent[] = [];
      let bytes = 0;
      while (this.pending.length && batch.length < 80) {
        const size = Buffer.byteLength(JSON.stringify(this.pending[0]), 'utf8');
        if (batch.length && bytes + size > 4_500_000) break;
        batch.push(this.pending.shift()!);
        bytes += size;
      }
      try {
        if (!await this.client.send(batch)) { this.disconnected = true; break; }
      } catch {
        this.pending.unshift(...batch);
        this.disconnected = true;
        break;
      }
    }
  }

  private viewerAvailable(): boolean {
    return !this.stopped && !this.disconnected && !this.resyncing && this.viewers > 0 && this.permissions && Date.now() - this.lastPollAt < VIEWER_STALE_MS;
  }

  private async reconnect(): Promise<boolean> {
    await this.flushing;
    // A restarted server has forgotten this instance, so polling alone returns 404 forever.
    // Probe through events first, then send fresh sessions before enabling interactions.
    if (this.stopped || !await this.client.send([{ type: 'heartbeat' }])) return false;
    this.resyncing = true;
    try {
      try { await this.scanRecent(); } catch { /* Live agents remain available without the corpus. */ }
      for (const agent of this.ctx.agents.list()) {
        this.enqueue([this.projector.session(agent.session.header,
          agent.status === 'running' ? 'working' : 'idle', agent.options.model)]);
      }
      this.disconnected = false;
      await this.flush();
      return !this.stopped && !this.disconnected;
    } finally { this.resyncing = false; }
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      if (this.disconnected && !this.booting && !await this.reconnect()) { this.disconnect(); return; }
      const poll = await this.client.poll();
      if (!poll) { this.disconnect(); return; }
      this.disconnected = false;
      this.receivePoll(poll);
      await this.flush();
    } catch { this.disconnect(); }
    finally { this.polling = false; }
  }

  private receivePoll(poll: BridgePoll): void {
    this.viewers = poll.viewers;
    this.permissions = poll.permissions;
    this.messaging = poll.messaging;
    this.lastPollAt = Date.now();
    if (!this.viewerAvailable()) this.approval.disconnect();
    for (const command of poll.messages) {
      const receipt = this.messageReceipts.get(command.id);
      if (receipt) { void this.client.acknowledge([receipt]).catch(() => {}); continue; }
      if (this.inFlightMessages.has(command.id)) continue;
      this.inFlightMessages.add(command.id);
      void this.reply(command);
    }
  }

  private async reply(command: BridgeMessageCommand): Promise<void> {
    const result = this.messaging
      ? await deliverMessage(this.ctx.sessionController, command, this.abort.signal)
      : { id: command.id, ok: false, error: 'MessagingUnavailable' };
    this.inFlightMessages.delete(command.id);
    this.messageReceipts.set(command.id, result);
    if (this.messageReceipts.size > 2000) this.messageReceipts.delete(this.messageReceipts.keys().next().value!);
    try { await this.client.acknowledge([result]); } catch { /* Redelivery retries the cached receipt. */ }
  }

  private disconnect(): void {
    this.disconnected = true;
    this.viewers = 0;
    this.permissions = false;
    this.messaging = false;
    this.approval.disconnect();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.approval.disconnect();
    this.pending.length = 0;
    await this.client.stop();
  }
}

/** Cordis plugin entry; listener disposers belong to its fiber, timers to this effect. */
export function apply(ctx: DshContext): void {
  const bridge = new DshBridge(ctx);
  ctx.effect(() => () => bridge.stop(), 'habblaud-dsh: bridge lifecycle');
  void bridge.start();
}
