import { createHash } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BridgeEnvelope, BridgeEvent, BridgeSession, NativeProvider } from '../../shared/native-bridge';
import type { AgentStats, RecentSession, SourceInfo, TerminalEntry, TerminalInit } from '../../shared/types';
import type { AccountsService } from '../accounts/service';
import type { ConversationSource } from '../http/terminal';
import type { Office } from '../model/office';
import type { AgentSource, HistoryProvider, HistoryResolveResult } from '../sources/source';
import type { TerminalParser } from '../sources/terminal';

export const NATIVE_TIMEOUT_MS = 45_000;
export const NATIVE_ENTRY_LIMIT = 500;
export const NATIVE_BYTES_LIMIT = 4 * 1024 * 1024;
const DAYS_MS = 7 * 24 * 60 * 60_000;
const SESSION_LIMIT = 512;

function readPrivateFile(path: string, maxBytes: number): string | undefined {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw err; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('invalid native cache');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

function writePrivateFile(path: string, body: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('invalid native cache');
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, body, 'utf8');
  } finally { closeSync(fd); }
}

interface SessionRecord {
  session: BridgeSession;
  account: string;
  owner?: string;
  retired: Set<string>;
  live: boolean;
  entries: TerminalEntry[];
  activityIds: Set<string>;
  truncated: boolean;
  generation: number;
  lastAt: number;
  path: string;
}
interface Instance { seq: number; seenAt: number; pollAt?: number; expired?: boolean }

export interface NativeSourceOptions {
  provider: NativeProvider;
  office: Office;
  accounts: Pick<AccountsService, 'setProviderAccounts'>;
  dir: string;
  home: string;
  now?: () => number;
}

function digest(account: string, sessionId: string): string {
  return createHash('sha256').update(account).update('\0').update(sessionId).digest('hex');
}
const emptyStats = (): AgentStats => ({ toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 });

/** Native SDKs own their format; this source owns only the normalized local view. */
export class NativeSource implements AgentSource, HistoryProvider {
  readonly provider: NativeProvider;
  private sessions = new Map<string, SessionRecord>();
  private instances = new Map<string, Instance>();
  private stopped = new Set<string>();
  private accountIds = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly opts: NativeSourceOptions) {
    this.provider = opts.provider;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    this.opts.office.beginBoot();
    try {
      for (const name of readdirSync(this.opts.dir).filter((n) => /^[a-f0-9]{64}\.json$/.test(n)).slice(0, 150)) {
        try {
          const saved = JSON.parse(readPrivateFile(join(this.opts.dir, name), 64 * 1024) ?? 'null') as { session: BridgeSession; lastAt: number; truncated: boolean };
          if (!saved.session?.sessionId || !saved.session.account || !saved.session.cwd || saved.lastAt < this.now() - DAYS_MS) continue;
          const key = digest(saved.session.account, saved.session.sessionId);
          if (name !== `${key}.json`) continue;
          const r = this.newRecord(saved.session);
          r.lastAt = saved.lastAt;
          r.truncated = saved.truncated;
          const body = readPrivateFile(r.path, NATIVE_BYTES_LIMIT);
          if (body !== undefined) {
            for (const line of body.split('\n')) { try { const e = JSON.parse(line) as TerminalEntry; if (e?.id && e.kind) r.entries.push(e); } catch { /* Torn cache line. */ } }
          }
          r.entries = r.entries.slice(-NATIVE_ENTRY_LIMIT);
          this.sessions.set(key, r);
        } catch { /* An invalid private cache must not block other providers. */ }
      }
      this.refreshAccounts();
    } finally { this.opts.office.endBoot(); }
    this.timer = setInterval(() => this.expire(), 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const id of [...this.instances.keys()]) this.stopInstance(id);
  }

  private newRecord(session: BridgeSession): SessionRecord {
    return {
      session: { ...session }, account: `${this.provider}:${session.account}`, retired: new Set(), live: false,
      entries: [], activityIds: new Set(), truncated: false, generation: 0, lastAt: session.startedAt,
      path: join(this.opts.dir, `${digest(session.account, session.sessionId)}.jsonl`),
    };
  }

  private refreshAccounts(): void {
    const labels = [...new Set([...this.sessions.values()].map((r) => r.session.account))].sort().slice(0, 32);
    const entries = this.opts.accounts.setProviderAccounts(this.provider, labels.map((label) => {
      const dir = join(this.opts.home, this.provider === 'dsh' ? '.dsh' : '.pi');
      return { dir, detected: { id: `${this.provider}:${label}`, configDir: dir, short: this.provider === 'dsh' ? 'DS' : 'PI', name: label, color: this.provider === 'dsh' ? '#5086e8' : '#b67bd8' } };
    }));
    labels.forEach((label, i) => this.accountIds.set(label, entries[i]?.id ?? `${this.provider}:${label}`));
    for (const r of this.sessions.values()) r.account = this.accountIds.get(r.session.account) ?? r.account;
  }

  agentId(sessionId: string, account: string): string { return `native:${this.provider}:${digest(account, sessionId)}`; }

  /** Read-only disk discovery is historical data, never evidence of a connected runtime. */
  cacheHistorical(session: BridgeSession, entries: TerminalEntry[], truncated = false): void {
    // Historical projections can share a native session id across accounts.
    // Their terminal events must resolve to the exact projection we just cached.
    const owner = `history:${this.provider}:${digest(session.account, session.sessionId)}`;
    this.event(owner, { type: 'session', session: { ...session, status: 'offline' }, historical: true });
    this.event(owner, { type: 'terminal', sessionId: session.sessionId, entries, reset: true, truncated });
  }

  ingest(envelope: BridgeEnvelope): void {
    if (envelope.provider !== this.provider || this.stopped.has(envelope.instanceId)) return;
    if (!this.instances.has(envelope.instanceId) && this.instances.size >= 128) {
      // Keep seq for reconnecting instances until capacity is needed; then retire
      // the oldest expired id rather than preventing new plugin lifetimes forever.
      const oldest = [...this.instances].filter(([, instance]) => instance.expired)
        .sort((a, b) => a[1].seenAt - b[1].seenAt)[0];
      if (oldest) this.stopInstance(oldest[0]);
      if (this.instances.size >= 128) return;
    }
    const instance = this.instances.get(envelope.instanceId) ?? { seq: 0, seenAt: this.now() };
    this.instances.set(envelope.instanceId, instance);
    if (envelope.seq <= instance.seq) return;
    instance.seq = envelope.seq;
    instance.seenAt = this.now();
    if (instance.expired) {
      // Polling alone cannot restore an agent. Require a fresh live session snapshot,
      // while retaining the old sequence so replayed envelopes cannot revive it.
      const live = envelope.events.some((event) => event.type === 'session' && !event.historical
        && event.session.status !== 'offline' && event.session.status !== 'done'
        && !this.sessions.get(digest(event.session.account, event.session.sessionId))?.retired.has(envelope.instanceId));
      if (!live) return;
      instance.expired = false;
    }
    for (const e of envelope.events) this.event(envelope.instanceId, e);
  }

  private event(instanceId: string, event: BridgeEvent): void {
    if (event.type === 'heartbeat') return;
    if (event.type === 'session') {
      const s = event.session;
      const key = digest(s.account, s.sessionId);
      if (!this.sessions.has(key) && this.sessions.size >= SESSION_LIMIT) {
        const oldest = [...this.sessions.entries()].filter(([, r]) => !r.live).sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
        if (!oldest) return;
        this.sessions.delete(oldest[0]);
      }
      const r = this.sessions.get(key) ?? this.newRecord(s);
      if (r.retired.has(instanceId)) return;
      // Historical discovery cannot take ownership from a currently active runtime.
      if (event.historical && r.live) return;
      if (!event.historical && r.owner && r.owner !== instanceId) {
        r.retired.add(r.owner);
        if (r.retired.size > 16) r.retired.delete(r.retired.values().next().value!);
      }
      r.session = { ...s };
      r.owner = instanceId;
      r.live = !event.historical && s.status !== 'offline' && s.status !== 'done';
      this.sessions.set(key, r);
      this.refreshAccounts();
      this.materializeAll();
      this.persist(r);
      return;
    }
    const r = [...this.sessions.values()].find((s) => s.owner === instanceId && s.session.sessionId === event.sessionId);
    if (!r) return;
    const id = this.agentId(r.session.sessionId, r.session.account);
    if (event.type === 'closed') {
      r.live = false;
      this.close(r);
    } else if (event.type === 'status') {
      r.session.status = event.status;
      r.session.waitingFor = event.waitingFor;
      r.session.waitingForI18n = event.waitingForI18n;
      if (event.model) r.session.model = event.model;
      if (event.stats) r.session.stats = { ...r.session.stats, ...event.stats };
      this.opts.office.setStatus(id, event.status, event.waitingFor, event.waitingForI18n);
      if (event.status === 'done' || event.status === 'offline') { r.live = false; this.close(r); }
      this.summary(r);
    } else if (event.type === 'activity') {
      if (!r.activityIds.has(event.activity.id)) {
        r.activityIds.add(event.activity.id);
        if (r.activityIds.size > 1000) r.activityIds.delete(r.activityIds.values().next().value!);
        r.lastAt = Math.max(r.lastAt, event.activity.at);
        if (r.live) this.opts.office.addActivity(id, event.activity, !event.historical, { feed: !event.historical });
      }
    } else if (event.type === 'terminal') {
      if (event.reset) { r.entries = []; r.generation++; r.truncated = !!event.truncated; }
      const ids = new Set(r.entries.map((e) => e.id));
      for (const e of event.entries) if (!ids.has(e.id)) { r.entries.push(e); ids.add(e.id); r.lastAt = Math.max(r.lastAt, e.at); }
      if (event.truncated) r.truncated = true;
      let bytes = r.entries.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)) + 1, 0);
      while (r.entries.length && (r.entries.length > NATIVE_ENTRY_LIMIT || bytes > NATIVE_BYTES_LIMIT)) {
        bytes -= Buffer.byteLength(JSON.stringify(r.entries.shift()!)) + 1;
        r.truncated = true;
        r.generation++;
      }
      try { writePrivateFile(r.path, r.entries.map((e) => JSON.stringify(e)).join('\n') + '\n'); }
      catch { /* Live conversations remain available from memory if private storage fails. */ }
    }
    this.persist(r);
  }

  private materializeAll(): void {
    const live = [...this.sessions.values()].filter((r) => r.live);
    for (const r of live) if (!r.session.parentSessionId) this.materialize(r);
    let remaining = live.filter((r) => r.session.parentSessionId);
    while (remaining.length) {
      const next: SessionRecord[] = [];
      for (const r of remaining) {
        if (this.opts.office.has(this.agentId(r.session.parentSessionId!, r.session.account))) this.materialize(r);
        else next.push(r);
      }
      if (next.length === remaining.length) break;
      remaining = next;
    }
  }

  private materialize(r: SessionRecord): void {
    const s = r.session;
    const id = this.agentId(s.sessionId, s.account);
    if (s.parentSessionId) {
      const parent = this.agentId(s.parentSessionId, s.account);
      if (!this.opts.office.has(parent)) return;
      if (!this.opts.office.has(id)) this.opts.office.addSub({ id, parentId: parent, sessionId: s.sessionId, role: s.role ?? 'subagent', title: s.title, background: false, startedAt: s.startedAt });
      this.opts.office.setStatus(id, s.status, s.waitingFor, s.waitingForI18n);
    } else {
      this.opts.office.addMain({ id, provider: this.provider, account: r.account, sessionId: s.sessionId, cwd: s.cwd, role: s.role ?? 'Agente principal', startedAt: s.startedAt, status: s.status, waitingFor: s.waitingFor });
      this.opts.office.setStatus(id, s.status, s.waitingFor, s.waitingForI18n);
    }
    this.summary(r);
    const info = this.opts.office.get(id);
    if (info) info.capabilities = { terminal: true, history: true, ...s.capabilities };
    this.opts.office.markDirty();
  }

  private summary(r: SessionRecord): void {
    const id = this.agentId(r.session.sessionId, r.session.account);
    const a = this.opts.office.get(id);
    this.opts.office.applyTranscript(id, { title: r.session.title, model: r.session.model, tasks: a?.tasks ?? [], stats: { ...(a?.stats ?? emptyStats()), ...r.session.stats }, lastAt: r.lastAt });
  }

  private close(r: SessionRecord): void {
    const id = this.agentId(r.session.sessionId, r.session.account);
    if (r.session.parentSessionId) this.opts.office.completeSub(id);
    else this.opts.office.closeMain(id);
    r.session.status = r.session.parentSessionId ? 'done' : 'offline';
  }

  private persist(r: SessionRecord): void {
    try {
      mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
      writePrivateFile(r.path.replace(/\.jsonl$/, '.json'), JSON.stringify({ session: r.session, lastAt: r.lastAt, truncated: r.truncated }));
    } catch { /* An unwritable cache does not interrupt the native runtime. */ }
  }

  stopInstance(instanceId: string): void {
    this.instances.delete(instanceId);
    this.stopped.add(instanceId);
    if (this.stopped.size > 256) this.stopped.delete(this.stopped.values().next().value!);
    this.disconnectInstance(instanceId);
  }

  private disconnectInstance(instanceId: string): void {
    for (const r of this.sessions.values()) if (r.owner === instanceId && r.live) { r.live = false; this.close(r); this.persist(r); }
    this.opts.office.markDirty();
  }

  expire(): void {
    for (const [id, i] of this.instances) if (!i.expired && this.now() - i.seenAt >= NATIVE_TIMEOUT_MS) {
      i.expired = true;
      i.pollAt = undefined;
      this.disconnectInstance(id);
    }
  }

  poll(instanceId: string): boolean {
    const i = this.instances.get(instanceId);
    if (!i) return false;
    i.seenAt = i.pollAt = this.now();
    return true;
  }

  owns(instanceId: string, sessionId: string): string | undefined {
    const r = [...this.sessions.values()].find((s) => s.live && s.owner === instanceId && s.session.sessionId === sessionId);
    return r ? this.agentId(sessionId, r.session.account) : undefined;
  }

  reachable(): Set<string> {
    const out = new Set<string>();
    for (const r of this.sessions.values()) {
      const i = r.owner ? this.instances.get(r.owner) : undefined;
      if (r.live && !r.session.parentSessionId && r.session.capabilities?.messages && i && !i.expired && i.pollAt && this.now() - i.pollAt < 10_000) out.add(this.agentId(r.session.sessionId, r.session.account));
    }
    return out;
  }

  ownerOf(agentId: string): { instanceId: string; sessionId: string } | undefined {
    const r = this.byAgent(agentId);
    return r?.live && r.owner ? { instanceId: r.owner, sessionId: r.session.sessionId } : undefined;
  }

  sources(): SourceInfo[] {
    const live = [...this.sessions.values()].filter((r) => r.live);
    const connected = [...this.instances.values()].some((i) => !i.expired);
    return [{ provider: this.provider, label: this.provider === 'dsh' ? 'DeepSeek Harness' : 'Pi', path: this.opts.dir, sessions: live.length, ok: connected, ...(connected ? {} : { error: '原生桥接尚未连接' }) }];
  }

  private byAgent(id: string): SessionRecord | undefined {
    return [...this.sessions.values()].find((r) => this.agentId(r.session.sessionId, r.session.account) === id);
  }

  transcriptPathOf(id: string): string | undefined { return this.byAgent(id)?.path; }
  terminalParser(id: string): TerminalParser | undefined { return this.byAgent(id) ? normalizedParser() : undefined; }
  conversation(id: string): ConversationSource | undefined { const r = this.byAgent(id); return r ? this.reader(r, id) : undefined; }

  private reader(r: SessionRecord, agentId: string): ConversationSource {
    let generation = r.generation;
    let ids = new Set<string>();
    const load = (): TerminalInit => {
      generation = r.generation;
      ids = new Set(r.entries.map((e) => e.id));
      return { agentId, entries: r.entries.map((e) => ({ ...e })), truncated: r.truncated };
    };
    return { intervalMs: 400, load, poll: () => {
      if (generation !== r.generation) return { init: load() };
      const append = r.entries.filter((e) => !ids.has(e.id));
      append.forEach((e) => ids.add(e.id));
      return { append };
    } };
  }

  hasAccount(account: string): boolean { return [...this.accountIds.values()].includes(account); }
  async list(): Promise<RecentSession[]> {
    return [...this.sessions.values()].filter((r) => r.lastAt >= this.now() - DAYS_MS).sort((a, b) => b.lastAt - a.lastAt).slice(0, 150).map((r) => ({
      provider: this.provider, account: r.account, sessionId: r.session.sessionId, project: r.session.cwd, projectDir: r.session.cwd,
      title: r.session.title, firstAt: r.session.startedAt, lastAt: r.lastAt,
      size: r.entries.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0), open: r.live,
      ...(r.live ? { agentId: this.agentId(r.session.sessionId, r.session.account) } : {}),
    }));
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    const r = [...this.sessions.values()].find((r) => r.account === account && r.session.sessionId === sessionId);
    if (!r) return { status: 404, error: '会话不存在或桥接尚未提供历史' };
    return { path: r.path, createParser: normalizedParser, createConversation: (id) => this.reader(r, id) };
  }
}

export function normalizedParser(): TerminalParser {
  return { push: (line) => { try { const e = JSON.parse(line) as TerminalEntry; return e?.id && e.kind ? [e] : []; } catch { return []; } } };
}
