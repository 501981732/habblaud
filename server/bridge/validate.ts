import { isAbsolute } from 'node:path';
import { BRIDGE_VERSION, type BridgeEnvelope, type BridgeEvent, type BridgePermission, type NativeProvider } from '../../shared/native-bridge';
import type { Activity, AgentStats, MessageRef, TerminalEntry } from '../../shared/types';

export const BRIDGE_MAX_BODY = 5 * 1024 * 1024;
export class BridgeInvalidRequest extends Error {}

type R = Record<string, unknown>;
function fail(what: string): never { throw new BridgeInvalidRequest(`桥接请求无效：${what}`); }
function record(value: unknown, what: string): R {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(what);
  return value as R;
}
function only(value: R, names: readonly string[], what: string): void {
  if (Object.keys(value).some((key) => !names.includes(key))) fail(what);
}
function str(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) fail(what);
  return value;
}
function optional(value: unknown, max: number, what: string): string | undefined {
  return value === undefined ? undefined : str(value, max, what);
}
function num(value: unknown, what: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(what);
  return value;
}
function flag(value: unknown, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(what);
  return value;
}
function status(value: unknown): 'working' | 'waiting' | 'idle' | 'shell' | 'done' | 'offline' {
  if (value !== 'working' && value !== 'waiting' && value !== 'idle' && value !== 'shell' && value !== 'done' && value !== 'offline') fail('status');
  return value;
}
function id(value: unknown, what = 'id'): string {
  const text = str(value, 300, what);
  // Pi's nested tool call ids contain '/', while session ids are hashed before use as paths.
  if (!/^[^\s\0?#]+$/.test(text)) fail(what);
  return text;
}
function text(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail(what);
  return value;
}
function json(value: unknown, maxBytes: number, what: string): unknown {
  let bytes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (depth > 12) fail(what);
    if (v === null || typeof v === 'boolean') { bytes += 5; return; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail(what); bytes += 24; return; }
    if (typeof v === 'string') { bytes += Buffer.byteLength(v) + 2; if (v.length > 65_536) fail(what); return; }
    if (Array.isArray(v)) { if (v.length > 256) fail(what); for (const item of v) visit(item, depth + 1); return; }
    if (v && typeof v === 'object') {
      const fields = Object.entries(v as R);
      if (fields.length > 128) fail(what);
      for (const [key, item] of fields) { bytes += Buffer.byteLength(key) + 2; visit(item, depth + 1); }
      return;
    }
    fail(what);
  };
  visit(value, 0);
  if (bytes > maxBytes) fail(what);
  return value;
}
function stats(raw: unknown): Partial<AgentStats> | undefined {
  if (raw === undefined) return undefined;
  const r = record(raw, 'stats');
  only(r, ['toolCalls', 'tokensIn', 'tokensOut', 'costUSD', 'linesAdded', 'linesRemoved', 'subagents'], 'stats');
  const out: R = {};
  for (const [key, value] of Object.entries(r)) out[key] = num(value, 'stats', 1e12);
  return out as Partial<AgentStats>;
}
function messageRef(raw: unknown): MessageRef | undefined {
  if (raw === undefined) return undefined;
  const r = record(raw, 'i18n');
  only(r, ['key', 'params'], 'i18n');
  const params = r.params === undefined ? undefined : record(r.params, 'i18n.params');
  if (params) {
    if (Object.keys(params).length > 16) fail('i18n.params');
    for (const [key, value] of Object.entries(params)) {
      if (key.length > 64) fail('i18n.params');
      if (typeof value === 'string') text(value, 4096, 'i18n.params');
      else if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) fail('i18n.params');
    }
  }
  return { key: str(r.key, 300, 'i18n.key'), ...(params ? { params: params as Record<string, string | number> } : {}) };
}
function activity(raw: unknown): Activity {
  const r = record(raw, 'activity');
  only(r, ['id', 'kind', 'icon', 'text', 'i18n', 'detail', 'detailI18n', 'tool', 'at', 'durationMs', 'error', 'questions'], 'activity');
  const kinds = new Set(['prompt', 'think', 'respond', 'read', 'search', 'edit', 'write', 'run', 'test', 'git', 'web', 'browser', 'plan', 'delegate', 'communicate', 'ask', 'mcp', 'skill', 'wait', 'error', 'compact', 'done', 'other']);
  if (!kinds.has(r.kind as string)) fail('activity.kind');
  const out: Activity = { id: id(r.id), kind: r.kind as Activity['kind'], icon: str(r.icon, 16, 'activity.icon'), text: text(r.text, 300, 'activity.text'), at: num(r.at, 'activity.at') };
  if (r.detail !== undefined) out.detail = text(r.detail, 4000, 'activity.detail');
  if (r.tool !== undefined) out.tool = str(r.tool, 200, 'activity.tool');
  if (r.durationMs !== undefined) out.durationMs = num(r.durationMs, 'activity.durationMs');
  if (r.error !== undefined) out.error = flag(r.error, 'activity.error');
  if (r.i18n !== undefined) out.i18n = messageRef(r.i18n);
  if (r.detailI18n !== undefined) out.detailI18n = messageRef(r.detailI18n);
  if (r.questions !== undefined) {
    json(r.questions, 16_384, 'activity.questions');
    if (!Array.isArray(r.questions) || r.questions.length > 4) fail('activity.questions');
    out.questions = r.questions as Activity['questions'];
  }
  return out;
}
function terminal(raw: unknown): TerminalEntry {
  const r = record(raw, 'terminal');
  const base = { id: id(r.id), at: num(r.at, 'terminal.at') };
  if (r.kind === 'user' || r.kind === 'assistant') {
    only(r, ['kind', 'id', 'at', 'text'], 'terminal');
    return { ...base, kind: r.kind, text: text(r.text, 65_536, 'terminal.text') };
  }
  if (r.kind === 'thinking') {
    only(r, ['kind', 'id', 'at', 'text'], 'terminal');
    return { ...base, kind: 'thinking', ...(r.text === undefined ? {} : { text: text(r.text, 65_536, 'terminal.text') }) };
  }
  if (r.kind === 'tool') {
    only(r, ['kind', 'id', 'at', 'tool', 'title', 'titleI18n', 'input', 'inputKind'], 'terminal');
    const inputKind = r.inputKind;
    if (inputKind !== undefined && inputKind !== 'command' && inputKind !== 'diff' && inputKind !== 'json' && inputKind !== 'text') fail('terminal.inputKind');
    return { ...base, kind: 'tool', tool: str(r.tool, 200, 'terminal.tool'), title: text(r.title, 512, 'terminal.title'),
      ...(r.titleI18n === undefined ? {} : { titleI18n: messageRef(r.titleI18n) }),
      ...(r.input === undefined ? {} : { input: text(r.input, 65_536, 'terminal.input') }), ...(inputKind ? { inputKind } : {}) };
  }
  if (r.kind === 'result') {
    only(r, ['kind', 'id', 'at', 'toolUseId', 'text', 'resultI18n', 'error', 'truncated'], 'terminal');
    return { ...base, kind: 'result', toolUseId: id(r.toolUseId, 'terminal.toolUseId'), text: text(r.text, 65_536, 'terminal.text'),
      ...(r.resultI18n === undefined ? {} : { resultI18n: messageRef(r.resultI18n) }),
      ...(r.error === undefined ? {} : { error: flag(r.error, 'terminal.error') }), ...(r.truncated === undefined ? {} : { truncated: flag(r.truncated, 'terminal.truncated') }) };
  }
  if (r.kind === 'system') {
    only(r, ['kind', 'id', 'at', 'text', 'i18n', 'detail', 'detailI18n', 'level'], 'terminal');
    if (r.level !== undefined && r.level !== 'info' && r.level !== 'warn' && r.level !== 'error') fail('terminal.level');
    return { ...base, kind: 'system', text: text(r.text, 65_536, 'terminal.text'),
      ...(r.i18n === undefined ? {} : { i18n: messageRef(r.i18n) }),
      ...(r.detailI18n === undefined ? {} : { detailI18n: messageRef(r.detailI18n) }),
      ...(r.detail === undefined ? {} : { detail: text(r.detail, 65_536, 'terminal.detail') }), ...(r.level ? { level: r.level } : {}) };
  }
  return fail('terminal.kind');
}

export function parseIdentity(raw: unknown): { version: 1; provider: NativeProvider; instanceId: string } {
  const r = record(raw, 'identity');
  if (r.version !== BRIDGE_VERSION) fail('version');
  if (r.provider !== 'dsh' && r.provider !== 'pi') fail('provider');
  return { version: BRIDGE_VERSION, provider: r.provider, instanceId: id(r.instanceId, 'instanceId') };
}

export function parseIdentityBody(raw: unknown): ReturnType<typeof parseIdentity> {
  const r = record(raw, 'identity');
  only(r, ['version', 'provider', 'instanceId'], 'identity');
  return parseIdentity(r);
}

export function parseEnvelope(raw: unknown): BridgeEnvelope {
  const r = record(raw, 'envelope');
  only(r, ['version', 'provider', 'instanceId', 'seq', 'events'], 'envelope');
  const identity = parseIdentity(r);
  if (!Number.isSafeInteger(r.seq) || (r.seq as number) < 1) fail('seq');
  if (!Array.isArray(r.events) || r.events.length < 1 || r.events.length > 128) fail('events');
  const events: BridgeEvent[] = r.events.map((raw) => {
    const e = record(raw, 'event');
    if (e.type === 'heartbeat') { only(e, ['type'], 'heartbeat'); return { type: 'heartbeat' }; }
    if (e.type === 'session') {
      only(e, ['type', 'session', 'historical'], 'session');
      const s = record(e.session, 'session');
      only(s, ['sessionId', 'account', 'cwd', 'sessionFile', 'startedAt', 'status', 'model', 'title', 'parentSessionId', 'role', 'waitingFor', 'waitingForI18n', 'stats', 'capabilities'], 'session');
      const cap = s.capabilities === undefined ? undefined : record(s.capabilities, 'capabilities');
      if (cap) only(cap, ['messages', 'permissions', 'history', 'terminal'], 'capabilities');
      const session: BridgeEvent & { type: 'session' } = { type: 'session', session: {
        sessionId: id(s.sessionId, 'sessionId'), account: str(s.account, 128, 'account'), cwd: text(s.cwd, 4096, 'cwd'),
        startedAt: num(s.startedAt, 'startedAt'), status: status(s.status),
        ...(optional(s.sessionFile, 4096, 'sessionFile') ? { sessionFile: s.sessionFile as string } : {}),
        ...(optional(s.model, 200, 'model') ? { model: s.model as string } : {}),
        ...(optional(s.title, 512, 'title') ? { title: s.title as string } : {}),
        ...(optional(s.parentSessionId, 300, 'parentSessionId') ? { parentSessionId: id(s.parentSessionId, 'parentSessionId') } : {}),
        ...(optional(s.role, 128, 'role') ? { role: s.role as string } : {}),
        ...(optional(s.waitingFor, 300, 'waitingFor') ? { waitingFor: s.waitingFor as string } : {}),
        ...(s.waitingForI18n === undefined ? {} : { waitingForI18n: messageRef(s.waitingForI18n) }),
        ...(s.stats === undefined ? {} : { stats: stats(s.stats) }),
        ...(cap ? { capabilities: Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, flag(v, 'capabilities')])) } : {}),
      }, ...(e.historical === undefined ? {} : { historical: flag(e.historical, 'historical') }) };
      if (session.session.sessionFile && !isAbsolute(session.session.sessionFile)) fail('sessionFile');
      return session;
    }
    if (e.type === 'status') {
      only(e, ['type', 'sessionId', 'status', 'waitingFor', 'waitingForI18n', 'model', 'stats'], 'status');
      return { type: 'status', sessionId: id(e.sessionId, 'sessionId'), status: status(e.status),
        ...(e.waitingFor === undefined ? {} : { waitingFor: str(e.waitingFor, 300, 'waitingFor') }),
        ...(e.waitingForI18n === undefined ? {} : { waitingForI18n: messageRef(e.waitingForI18n) }),
        ...(e.model === undefined ? {} : { model: str(e.model, 200, 'model') }), ...(e.stats === undefined ? {} : { stats: stats(e.stats) }) };
    }
    if (e.type === 'activity') {
      only(e, ['type', 'sessionId', 'activity', 'historical'], 'activity');
      return { type: 'activity', sessionId: id(e.sessionId, 'sessionId'), activity: activity(e.activity),
        ...(e.historical === undefined ? {} : { historical: flag(e.historical, 'historical') }) };
    }
    if (e.type === 'terminal') {
      only(e, ['type', 'sessionId', 'entries', 'reset', 'truncated'], 'terminal');
      if (!Array.isArray(e.entries) || e.entries.length > 500) fail('terminal.entries');
      return { type: 'terminal', sessionId: id(e.sessionId, 'sessionId'), entries: e.entries.map(terminal),
        ...(e.reset === undefined ? {} : { reset: flag(e.reset, 'terminal.reset') }),
        ...(e.truncated === undefined ? {} : { truncated: flag(e.truncated, 'terminal.truncated') }) };
    }
    if (e.type === 'closed') { only(e, ['type', 'sessionId'], 'closed'); return { type: 'closed', sessionId: id(e.sessionId, 'sessionId') }; }
    return fail('event.type');
  });
  return { ...identity, seq: r.seq as number, events };
}

export function parsePermission(raw: unknown): BridgePermission {
  const r = record(raw, 'permission');
  only(r, ['sessionId', 'tool', 'input', 'callId', 'reason', 'timeoutMs'], 'permission');
  const timeoutMs = r.timeoutMs === undefined ? 30_000 : num(r.timeoutMs, 'permission.timeoutMs', 60_000);
  if (timeoutMs < 1_000) fail('permission.timeoutMs');
  if (r.input !== undefined) json(r.input, 128 * 1024, 'permission.input');
  return { sessionId: id(r.sessionId, 'sessionId'), tool: str(r.tool, 200, 'permission.tool'),
    ...(r.input === undefined ? {} : { input: r.input }), ...(r.callId === undefined ? {} : { callId: id(r.callId, 'permission.callId') }),
    ...(r.reason === undefined ? {} : { reason: text(r.reason, 300, 'permission.reason') }), timeoutMs };
}

export function parseAcks(raw: unknown): Array<{ id: string; ok: boolean; error?: string }> {
  const r = record(raw, 'ack');
  only(r, ['version', 'provider', 'instanceId', 'results'], 'ack');
  if (!Array.isArray(r.results) || r.results.length > 50) fail('ack.results');
  return r.results.map((item) => {
    const a = record(item, 'ack.result');
    only(a, ['id', 'ok', 'error'], 'ack.result');
    if (typeof a.ok !== 'boolean') fail('ack.result.ok');
    return { id: id(a.id, 'ack.result.id'), ok: a.ok, ...(a.error === undefined ? {} : { error: text(a.error, 300, 'ack.result.error') }) };
  });
}
