import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { BridgeEvent, BridgePermission, BridgePermissionResult, BridgePoll, BridgeSession } from '../../shared/native-bridge';
import type { AgentStats, MessageRef, TerminalEntry } from '../../shared/types';
import { productCopy } from '../../shared/copy';
import { piAccountLabel } from '../native/accounts';
import { NativeBridgeClient } from '../native/client';
import { parsePiSessionJsonl } from './history';
import { contentText, object, resultTerminal, safeText, string, timestamp, toolActivity, toolTerminal, usageStats } from './mapping';

type PiEvent = Record<string, unknown>;
interface PiContext {
  cwd: string;
  hasUI: boolean;
  model?: { id?: string };
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getHeader(): unknown;
    getBranch(): unknown[];
    getLeafId(): string | null;
    getSessionName(): string | undefined;
  };
  ui: { confirm(title: string, message: string, options?: { timeout?: number; signal?: AbortSignal }): Promise<boolean> };
}
interface PiApi {
  on(event: string, handler: (event: PiEvent, ctx: PiContext) => unknown): unknown;
  sendUserMessage(text: string, options: { deliverAs: 'steer' | 'followUp'; expandPromptTemplates: false }): void;
}
export interface PiBridge {
  send(events: BridgeEvent[]): Promise<boolean>;
  poll(): Promise<BridgePoll | undefined>;
  acknowledge(results: { id: string; ok: boolean; error?: string }[]): Promise<void>;
  permission(request: BridgePermission, signal?: AbortSignal): Promise<BridgePermissionResult>;
  stop(): Promise<void>;
}
export interface PiExtensionOptions {
  createBridge?: () => PiBridge;
  /** Approval interception is opt-in. The default Pi tool behavior remains unchanged. */
  approvals?: boolean;
  pollMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  account?: string;
}

interface ActiveSession {
  id: string;
  bridge: PiBridge;
  session: BridgeSession;
  startedAt: number;
  title?: string;
  status: 'working' | 'waiting' | 'idle';
  baseStatus: 'working' | 'idle';
  waitingReasons: Array<{ text: string; i18n?: MessageRef }>;
  running: Map<string, { name: string; at: number }>;
  stats: Partial<AgentStats>;
  terminalSeq: number;
  pendingPermissions: Set<AbortController>;
  pollTimer?: ReturnType<typeof setInterval>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  pollBusy: boolean;
  deliveryResults: Map<string, { id: string; ok: boolean; error?: string }>;
  sendChain: Promise<void>;
  closed: boolean;
}

const enabled = (value: string | undefined): boolean => value === '1' || value === 'true' || value === 'on';
const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';
async function within(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise.catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Pi-native event bridge. No file watching, model calls, or global configuration changes. */
export class PiBridgeExtension {
  private active?: ActiveSession;
  private readonly now: () => number;
  private readonly approvals: boolean;

  constructor(private readonly pi: PiApi, private readonly options: PiExtensionOptions = {}) {
    this.now = options.now ?? Date.now;
    this.approvals = options.approvals ?? enabled(process.env.HABBLAUD_PI_APPROVALS);
  }

  install(): void {
    const bind = (name: string, fn: (event: PiEvent, ctx: PiContext) => unknown) => this.pi.on(name, fn);
    bind('session_start', (_e, ctx) => this.start(ctx));
    bind('session_shutdown', (_e, _ctx) => this.shutdown());
    bind('session_info_changed', (_e, ctx) => this.metadata(ctx));
    bind('session_tree', (_e, ctx) => this.bootstrap(ctx));
    bind('model_select', (_e, ctx) => this.metadata(ctx));
    bind('before_agent_start', (_e, ctx) => this.setStatus(ctx, 'working'));
    bind('agent_start', (_e, ctx) => this.setStatus(ctx, 'working'));
    // agent_end is deliberately ignored: Pi can retry, compact or run queued follow-ups.
    bind('agent_settled', (e, ctx) => this.setStatus(ctx, 'idle', e.aborted === true));
    bind('ui_prompt_start', (e, ctx) => this.uiWaiting(ctx, true, string(e.title)));
    bind('ui_prompt_end', (_e, ctx) => this.uiWaiting(ctx, false));
    bind('message_end', (e, ctx) => this.message(e, ctx));
    bind('tool_execution_start', (e, ctx) => this.toolStart(e, ctx));
    bind('tool_execution_end', (e, ctx) => this.toolEnd(e, ctx));
    if (this.approvals) bind('tool_call', (e, ctx) => this.approve(e, ctx));
  }

  private current(ctx: PiContext): ActiveSession | undefined {
    const active = this.active;
    return active && !active.closed && active.id === ctx.sessionManager.getSessionId() ? active : undefined;
  }

  private emit(active: ActiveSession, events: BridgeEvent[]): Promise<void> {
    if (active.closed) return Promise.resolve();
    active.sendChain = active.sendChain.then(async () => {
      await active.bridge.send(events);
    }).catch(() => undefined);
    return active.sendChain;
  }

  private statusEvent(active: ActiveSession, extras: { stats?: Partial<AgentStats>; model?: string } = {}): BridgeEvent {
    return { type: 'status', sessionId: active.id, status: active.status, ...extras,
      ...(active.session.waitingFor ? { waitingFor: active.session.waitingFor, waitingForI18n: active.session.waitingForI18n } : {}) };
  }

  private refreshStatus(active: ActiveSession): void {
    const reason = active.waitingReasons.at(-1) ?? (active.pendingPermissions.size ? productCopy('aprovar uma permissão') : undefined);
    active.status = reason ? 'waiting' : active.baseStatus;
    active.session.status = active.status;
    active.session.waitingFor = reason?.text;
    active.session.waitingForI18n = reason?.i18n;
    void this.emit(active, [this.statusEvent(active)]);
  }

  private async start(ctx: PiContext): Promise<void> {
    await this.shutdown();
    const id = ctx.sessionManager.getSessionId();
    if (!id) return;
    const bridge = this.options.createBridge?.() ?? new NativeBridgeClient('pi');
    const header = object(ctx.sessionManager.getHeader());
    const session: BridgeSession = {
      sessionId: id, account: this.options.account ?? piAccountLabel(process.env.PI_CODING_AGENT_DIR), cwd: ctx.cwd,
      sessionFile: ctx.sessionManager.getSessionFile(), startedAt: timestamp(header?.timestamp, this.now()),
      status: 'idle', title: ctx.sessionManager.getSessionName(), model: ctx.model?.id,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0 },
      capabilities: { messages: true, permissions: this.approvals, history: true, terminal: true },
    };
    const active: ActiveSession = {
      id, bridge, session, startedAt: session.startedAt, status: 'idle', baseStatus: 'idle', waitingReasons: [],
      running: new Map(), stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0 }, terminalSeq: 0, pendingPermissions: new Set(),
      pollBusy: false, deliveryResults: new Map(), sendChain: Promise.resolve(), closed: false,
    };
    this.active = active;
    await this.bootstrap(ctx);
    // Re-register the complete current state on heartbeat. A local bridge restarted during a
    // long Pi session must not depend on an old session event that may have left the queue.
    active.heartbeatTimer = setInterval(() => { void this.emit(active, [{ type: 'session', session: { ...active.session } }, { type: 'heartbeat' }]); }, this.options.heartbeatMs ?? 3000);
    active.pollTimer = setInterval(() => { void this.poll(active); }, this.options.pollMs ?? 1000);
    active.heartbeatTimer.unref?.();
    active.pollTimer.unref?.();
  }

  private async metadata(ctx: PiContext): Promise<void> {
    const active = this.current(ctx);
    if (!active) return;
    active.session = { ...active.session, cwd: ctx.cwd, sessionFile: ctx.sessionManager.getSessionFile(),
      title: ctx.sessionManager.getSessionName() ?? active.title, model: ctx.model?.id,
      stats: { ...active.stats }, status: active.status };
    await this.emit(active, [{ type: 'session', session: { ...active.session } }]);
  }

  /** Only the currently loaded Pi session is replayed; cold history belongs to the server. */
  private async bootstrap(ctx: PiContext): Promise<void> {
    const active = this.current(ctx);
    if (!active) return;
    const header = object(ctx.sessionManager.getHeader()) ?? { type: 'session', id: active.id, timestamp: new Date(active.startedAt).toISOString(), cwd: ctx.cwd };
    const branch = ctx.sessionManager.getBranch();
    const parsed = parsePiSessionJsonl([JSON.stringify(header), ...branch.map((entry) => JSON.stringify(entry))].join('\n'), { leafId: ctx.sessionManager.getLeafId() ?? undefined });
    if (!parsed) return;
    active.stats = parsed.stats;
    active.title = parsed.title;
    active.session = { ...active.session, startedAt: parsed.startedAt, title: ctx.sessionManager.getSessionName() ?? parsed.title,
      sessionFile: ctx.sessionManager.getSessionFile(), model: ctx.model?.id ?? parsed.model, stats: { ...active.stats } };
    await this.emit(active, [
      { type: 'session', session: { ...active.session } },
      { type: 'terminal', sessionId: active.id, entries: parsed.entries, reset: true, truncated: parsed.truncated },
      this.statusEvent(active, { stats: { ...active.stats } }),
    ]);
  }

  private setStatus(ctx: PiContext, status: 'working' | 'idle', aborted = false): void {
    const active = this.current(ctx);
    if (!active) return;
    active.baseStatus = status;
    this.refreshStatus(active);
    if (aborted) {
      const copy = productCopy('Execução interrompida');
      void this.emit(active, [{ type: 'activity', sessionId: active.id, activity: {
        id: `${active.id}:aborted:${this.now()}`, kind: 'error', icon: '⏹️', ...copy, at: this.now(),
      } }]);
    }
  }

  private uiWaiting(ctx: PiContext, entering: boolean, reason?: string): void {
    const active = this.current(ctx);
    if (!active) return;
    if (entering) {
      const fallback = !reason ? productCopy('Aguardando você') : undefined;
      active.waitingReasons.push({ text: safeText(reason ?? fallback!.text, 100), i18n: fallback?.i18n });
    } else active.waitingReasons.pop();
    this.refreshStatus(active);
  }

  private message(event: PiEvent, ctx: PiContext): void {
    const active = this.current(ctx);
    const message = object(event.message);
    if (!active || !message) return;
    const at = timestamp(message.timestamp, this.now());
    const entries: TerminalEntry[] = [];
    const seq = ++active.terminalSeq;
    if (message.role === 'user') entries.push({ kind: 'user', id: `live:user:${seq}`, at, text: safeText(contentText(message.content)) });
    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content) ? message.content : [];
      blocks.forEach((raw, index) => {
        const block = object(raw);
        if (!block) return;
        if (block.type === 'text') entries.push({ kind: 'assistant', id: `live:text:${seq}:${index}`, at, text: safeText(block.text) });
        if (block.type === 'thinking') entries.push({ kind: 'thinking', id: `live:thinking:${seq}:${index}`, at, text: safeText(block.thinking ?? block.text) });
      });
      const usage = usageStats(message);
      if (usage) {
        active.stats.tokensIn = (active.stats.tokensIn ?? 0) + (usage.tokensIn ?? 0);
        active.stats.tokensOut = (active.stats.tokensOut ?? 0) + (usage.tokensOut ?? 0);
        if (usage.costUSD !== undefined) active.stats.costUSD = (active.stats.costUSD ?? 0) + usage.costUSD;
        active.session.stats = { ...active.stats };
        active.session.model = string(message.model) ?? active.session.model;
        void this.emit(active, [this.statusEvent(active, { stats: { ...active.stats }, model: string(message.model) })]);
      }
    }
    if (entries.length) void this.emit(active, [{ type: 'terminal', sessionId: active.id, entries }]);
  }

  private toolStart(event: PiEvent, ctx: PiContext): void {
    const active = this.current(ctx);
    const callId = string(event.toolCallId);
    const name = string(event.toolName);
    if (!active || !callId || !name || active.running.has(callId)) return;
    const at = this.now();
    active.running.set(callId, { name, at });
    active.stats.toolCalls = (active.stats.toolCalls ?? 0) + 1;
    active.session.stats = { ...active.stats };
    void this.emit(active, [
      { type: 'activity', sessionId: active.id, activity: toolActivity(active.id, callId, name, event.args, at) },
      { type: 'terminal', sessionId: active.id, entries: [toolTerminal(callId, name, event.args, at)] },
      this.statusEvent(active, { stats: { ...active.stats } }),
    ]);
  }

  private toolEnd(event: PiEvent, ctx: PiContext): void {
    const active = this.current(ctx);
    const callId = string(event.toolCallId);
    if (!active || !callId) return;
    const running = active.running.get(callId);
    active.running.delete(callId);
    if (!running) return;
    void this.emit(active, [{ type: 'terminal', sessionId: active.id, entries: [resultTerminal(callId, event.result, event.isError === true, this.now())] }]);
  }

  private async poll(active: ActiveSession): Promise<void> {
    if (active.closed || active.pollBusy || this.active !== active) return;
    active.pollBusy = true;
    try {
      const data = await active.bridge.poll();
      if (!data || active.closed || this.active !== active) return;
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const message of data.messages) {
        if (message.sessionId !== active.id) continue;
        const previous = active.deliveryResults.get(message.id);
        if (previous) { results.push(previous); continue; }
        try {
          this.pi.sendUserMessage(message.text, { deliverAs: message.mode === 'steer' ? 'steer' : 'followUp', expandPromptTemplates: false });
          const result = { id: message.id, ok: true };
          active.deliveryResults.set(message.id, result);
          results.push(result);
        } catch (error) {
          const result = { id: message.id, ok: false, error: safeText(error instanceof Error ? error.message : error, 200) };
          active.deliveryResults.set(message.id, result);
          results.push(result);
        }
      }
      if (results.length) {
        await active.bridge.acknowledge(results);
        // acknowledge() intentionally returns void even when the transport failed. Keep ids so a
        // repeated poll retries the acknowledgement without injecting the user message twice.
        while (active.deliveryResults.size > 1024) active.deliveryResults.delete(active.deliveryResults.keys().next().value!);
      }
    } catch { /* An unavailable local bridge must not interrupt Pi. */ }
    finally { active.pollBusy = false; }
  }

  private async approve(event: PiEvent, ctx: PiContext): Promise<{ block: true; reason: string } | undefined> {
    const active = this.current(ctx);
    const tool = string(event.toolName);
    if (!active || !tool) return { block: true, reason: 'Habblaud 无法确认此工具调用' };
    const controller = new AbortController();
    active.pendingPermissions.add(controller);
    this.refreshStatus(active);
    // The bridge may wait for its full 30-second decision window before falling back to
    // Pi's own 30-second dialog. Leave time for both stages, then fail closed.
    const timeout = setTimeout(() => controller.abort(), 70_000);
    const request: BridgePermission = { sessionId: active.id, tool, input: event.input, callId: string(event.toolCallId), timeoutMs: 30_000 };
    try {
      let decision: BridgePermissionResult | undefined;
      try { decision = await active.bridge.permission(request, controller.signal); }
      catch (error) { if (!isAbort(error)) decision = { behavior: 'terminal' }; }
      if (active.closed || controller.signal.aborted || this.active !== active) return { block: true, reason: '会话已结束' };
      if (decision?.behavior === 'allow') return undefined;
      if (decision?.behavior === 'deny') return { block: true, reason: safeText(decision.message ?? '用户拒绝了工具调用', 300) };
      if (decision?.behavior === 'cancelled') return { block: true, reason: '审批已取消' };
      // "terminal" means ask the user in Pi; in print/JSON mode there is no UI, so fail closed.
      if (ctx.hasUI) {
        try {
          const yes = await ctx.ui.confirm('允许工具调用？', safeText(`${tool}(${JSON.stringify(event.input ?? {})})`, 300), { timeout: 30_000, signal: controller.signal });
          if (yes && !active.closed && !controller.signal.aborted) return undefined;
        } catch { /* Cancellation and UI failure both deny. */ }
      }
      return { block: true, reason: '工具调用未获批准' };
    } finally {
      clearTimeout(timeout);
      active.pendingPermissions.delete(controller);
      if (!active.closed && this.active === active) this.refreshStatus(active);
    }
  }

  async shutdown(): Promise<void> {
    const active = this.active;
    if (!active || active.closed) return;
    active.closed = true;
    this.active = undefined;
    if (active.pollTimer) clearInterval(active.pollTimer);
    if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
    for (const controller of active.pendingPermissions) controller.abort();
    active.pendingPermissions.clear();
    active.running.clear();
    active.deliveryResults.clear();
    try {
      await within(active.sendChain, 1500);
      await within(active.bridge.send([{ type: 'closed', sessionId: active.id }]), 1500);
    } catch { /* Heartbeat expiry handles an unreachable bridge. */ }
    await active.bridge.stop().catch(() => undefined);
  }
}

export default function habblaudPiExtension(pi: ExtensionAPI): void {
  new PiBridgeExtension(pi as unknown as PiApi).install();
}
