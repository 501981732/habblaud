import { maskSecrets, truncate } from '../../shared/activity';
import { productCopy } from '../../shared/copy';
import type { BridgeEvent, BridgeSession } from '../../shared/native-bridge';
import type { Activity, ActivityKind, AgentStatus, TerminalEntry } from '../../shared/types';

/** Structural copies of the public 0.2.0-rc.2 SessionHeader and SessionEvent fields used here. */
export interface DshHeader {
  id: string;
  createdAt: number;
  cwd?: string;
  parentSession?: string;
  origin?: 'subagent';
}
export interface DshEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const safe = (value: string, max: number): string => truncate(maskSecrets(value.slice(0, max * 4)), max);
const safeBody = (value: string, max: number): string => {
  const masked = maskSecrets(value);
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
};
const MAX_TERMINAL = 500;
const MAX_TERMINAL_BYTES = 4 * 1024 * 1024;

function contentText(value: unknown, kind = 'text'): string {
  return (Array.isArray(value) ? value : [])
    .filter((part) => object(part).type === kind)
    .map((part) => string(object(part).text))
    .filter(Boolean).join('\n');
}

function toolKind(name: string): { kind: ActivityKind; icon: string; template: string } {
  const lower = name.toLowerCase();
  if (/subagent|spawn|delegate/.test(lower)) return { kind: 'delegate', icon: '👥', template: 'Delegando {ferramenta}' };
  if (/test/.test(lower)) return { kind: 'test', icon: '🧪', template: 'Testando {ferramenta}' };
  if (/git/.test(lower)) return { kind: 'git', icon: '🌿', template: 'Usando Git: {ferramenta}' };
  if (/write|edit|patch/.test(lower)) return { kind: 'edit', icon: '✏️', template: 'Editando {ferramenta}' };
  if (/read|file/.test(lower)) return { kind: 'read', icon: '📄', template: 'Lendo {ferramenta}' };
  if (/search|grep|glob/.test(lower)) return { kind: 'search', icon: '🔎', template: 'Pesquisando com {ferramenta}' };
  if (/browser|playwright/.test(lower)) return { kind: 'browser', icon: '🌐', template: 'Navegando com {ferramenta}' };
  if (/web|fetch/.test(lower)) return { kind: 'web', icon: '🌍', template: 'Consultando Web com {ferramenta}' };
  if (/bash|shell|exec|terminal|command/.test(lower)) return { kind: 'run', icon: '⌨️', template: 'Executando {ferramenta}' };
  if (/mcp/.test(lower)) return { kind: 'mcp', icon: '🔌', template: 'Usando MCP: {ferramenta}' };
  return { kind: 'other', icon: '🔧', template: 'Usando {ferramenta}' };
}

interface SessionState {
  header: DshHeader;
  lastSeq: number;
  terminal: TerminalEntry[];
  terminalBytes: number;
  truncated: boolean;
  calls: Map<string, { name: string; startedAt: number }>;
  recentActivities: Activity[];
  stats: { toolCalls: number; tokensIn: number; tokensOut: number; subagents: number };
  model?: string;
  title?: string;
  status: AgentStatus;
}

/** Stateful projection shared by cold replay and the live append feed. */
export class DshProjector {
  private readonly sessions = new Map<string, SessionState>();
  private readonly children = new Map<string, Set<string>>();
  constructor(private readonly account: string) {}

  get(sessionId: string): SessionState | undefined { return this.sessions.get(sessionId); }

  private ensure(header: DshHeader): SessionState {
    let state = this.sessions.get(header.id);
    if (!state) {
      state = { header, lastSeq: -1, terminal: [], terminalBytes: 0, truncated: false,
        calls: new Map(), recentActivities: [],
        stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, status: 'idle' };
      this.sessions.set(header.id, state);
    } else state.header = header;
    state.stats.subagents = this.children.get(header.id)?.size ?? 0;
    if (header.origin === 'subagent' && header.parentSession) {
      let siblings = this.children.get(header.parentSession);
      if (!siblings) this.children.set(header.parentSession, siblings = new Set());
      siblings.add(header.id);
      const parent = this.sessions.get(header.parentSession);
      if (parent) parent.stats.subagents = siblings.size;
    }
    return state;
  }

  session(header: DshHeader, status: AgentStatus = 'idle', model?: string, historical = false): BridgeEvent {
    const state = this.ensure(header);
    state.status = status;
    if (model) state.model = model;
    const session: BridgeSession = {
      sessionId: header.id, account: this.account, cwd: header.cwd || '', startedAt: header.createdAt,
      status, model: state.model, title: state.title,
      ...(header.origin === 'subagent' && header.parentSession ? { parentSessionId: header.parentSession, role: 'Subagent' } : {}),
      stats: { ...state.stats },
      capabilities: { history: true, terminal: true, messages: !historical && header.origin !== 'subagent', permissions: !historical },
    };
    return { type: 'session', session, historical };
  }

  /** Cold logs are replayed in order, then one bounded terminal snapshot is sent. */
  bootstrap(header: DshHeader, events: readonly DshEvent[], live: boolean, status: AgentStatus = 'idle', model?: string): BridgeEvent[] {
    const state = this.ensure(header);
    const output: BridgeEvent[] = [];
    for (const event of events) output.push(...this.accept(state, event, true, false));
    output.length = 0;
    output.push(...state.recentActivities.map((activity): BridgeEvent => ({
      type: 'activity', sessionId: header.id, activity, historical: true,
    })));
    output.unshift(this.session(header, live ? status : 'offline', model, !live));
    if (state.terminal.length) output.push({ type: 'terminal', sessionId: header.id,
      entries: state.terminal.slice(), reset: true, truncated: state.truncated });
    return output;
  }

  live(header: DshHeader, event: DshEvent): BridgeEvent[] {
    const existed = this.sessions.has(header.id);
    const state = this.ensure(header);
    const output = existed ? [] : [this.session(header, 'idle')];
    return output.concat(this.accept(state, event, false, true));
  }

  status(sessionId: string, status: AgentStatus, model?: string, waitingFor?: string): BridgeEvent | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    state.status = status;
    if (model) state.model = model;
    return { type: 'status', sessionId, status, ...(model ? { model } : {}),
      ...(waitingFor ? { waitingFor, waitingForI18n: productCopy(waitingFor).i18n } : {}), stats: { ...state.stats } };
  }

  private appendTerminal(state: SessionState, entry: TerminalEntry): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    if (bytes > MAX_TERMINAL_BYTES) { state.truncated = true; return false; }
    state.terminal.push(entry);
    state.terminalBytes += bytes;
    while (state.terminal.length > MAX_TERMINAL || state.terminalBytes > MAX_TERMINAL_BYTES) {
      state.terminalBytes -= Buffer.byteLength(JSON.stringify(state.terminal.shift()), 'utf8');
      state.truncated = true;
    }
    return true;
  }

  private accept(state: SessionState, event: DshEvent, historical: boolean, emitTerminal: boolean): BridgeEvent[] {
    if (!Number.isSafeInteger(event.seq) || event.seq <= state.lastSeq) return [];
    state.lastSeq = event.seq;
    const data = object(event.data);
    const id = `${state.header.id}:${event.seq}`;
    const out: BridgeEvent[] = [];
    const entry = (item: TerminalEntry) => {
      if (this.appendTerminal(state, item) && emitTerminal) out.push({ type: 'terminal', sessionId: state.header.id, entries: [item] });
    };
    const activity = (kind: ActivityKind, icon: string, template: string, params?: Record<string, string | number>, tool?: string, detail?: string, error?: boolean) => {
      const copy = productCopy(template, params);
      const value: Activity = { id, kind, icon, text: safe(copy.text, 46), i18n: copy.i18n, at: event.time,
        ...(tool ? { tool } : {}), ...(detail ? { detail: safe(detail, 300) } : {}), ...(error ? { error: true } : {}) };
      state.recentActivities.push(value);
      if (state.recentActivities.length > 30) state.recentActivities.shift();
      out.push({ type: 'activity', sessionId: state.header.id, activity: value, historical });
    };
    switch (event.type) {
      case 'turn/start':
        state.status = 'working';
        if (!historical) out.push({ type: 'status', sessionId: state.header.id, status: 'working' });
        break;
      case 'turn/end':
        activity('done', '✅', 'Turno concluído');
        break;
      case 'user/message': {
        // Synthetic context and inter-agent relay are not human prompts.
        if (object(data.source).kind !== 'user') break;
        const text = contentText(data.content);
        if (text) entry({ kind: 'user', id, at: event.time, text: safeBody(text, 20_000) });
        activity('prompt', '💬', 'Nova instrução');
        break;
      }
      case 'assistant/message': {
        const message = object(data.message);
        const text = contentText(message.content);
        const reasoning = contentText(message.content, 'reasoning');
        if (reasoning) entry({ kind: 'thinking', id: `${id}:reasoning`, at: event.time, text: safeBody(reasoning, 20_000) });
        if (text) entry({ kind: 'assistant', id, at: event.time, text: safeBody(text, 20_000) });
        const model = string(object(message.source).model);
        if (model) state.model = model;
        const usage = object(data.usage);
        state.stats.tokensIn += number(usage.inputTokens) + number(usage.cacheReadTokens) + number(usage.cacheWriteTokens);
        state.stats.tokensOut += number(usage.outputTokens);
        activity('respond', '💬', 'Respondendo');
        if (!historical) out.push({ type: 'status', sessionId: state.header.id, status: state.status,
          ...(state.model ? { model: state.model } : {}), stats: { ...state.stats } });
        break;
      }
      case 'tool/call': {
        const callId = string(data.callId);
        const name = string(data.name) || 'tool';
        if (callId) state.calls.set(callId, { name, startedAt: event.time });
        state.stats.toolCalls++;
        const view = toolKind(name);
        activity(view.kind, view.icon, view.template, { ferramenta: safe(name, 80) }, name);
        entry({ kind: 'tool', id: callId || id, at: event.time, tool: name,
          title: safe(name, 120), ...(string(data.arguments) ? { input: safeBody(string(data.arguments), 4000), inputKind: 'json' } : {}) });
        break;
      }
      case 'tool/result': {
        const message = object(data.message);
        const callId = string(message.toolCallId) || string(object(message.source).callId);
        const call = state.calls.get(callId);
        if (callId) state.calls.delete(callId);
        const isError = message.isError === true;
        const rawResult = contentText(message.content);
        const fallback = !rawResult ? productCopy(isError ? 'Falha na ferramenta' : 'Concluído') : undefined;
        const resultText = rawResult || fallback!.text;
        entry({ kind: 'result', id, at: event.time, toolUseId: callId || id,
          text: safeBody(resultText, 20_000), ...(fallback ? { resultI18n: fallback.i18n } : {}),
          ...(isError ? { error: true } : {}), ...(resultText.length > 20_000 ? { truncated: true } : {}) });
        if (isError) activity('error', '⚠️', call?.name ? 'Falha em {ferramenta}' : 'Falha na ferramenta',
          call?.name ? { ferramenta: safe(call.name, 80) } : undefined, call?.name, undefined, true);
        break;
      }
      case 'session/title': {
        const title = string(data.title);
        if (title) {
          state.title = safe(title, 160);
          if (!historical) out.push(this.session(state.header, state.status, state.model));
        }
        break;
      }
      default:
        break;
    }
    return out;
  }
}
