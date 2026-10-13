import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeMessageCommand, BridgePermission, NativeProvider } from '../../shared/native-bridge';
import type { AgentInfo } from '../../shared/types';
import type { PermissionRegistry, RegisterResult } from '../permissions/registry';
import type { NativeSource } from './source';
import { BRIDGE_MAX_BODY, BridgeInvalidRequest, parseAcks, parseEnvelope, parseIdentity, parseIdentityBody, parsePermission } from './validate';

const PREFIX = '/api/bridge/';
const PERMISSION_ITEM = /^\/api\/bridge\/permissions\/([A-Za-z0-9._:-]{1,300})\/(wait|cancel)$/;
const MESSAGE_TIMEOUT_MS = 60_000;
const MAX_PENDING = 256;
const MAX_PER_AGENT = 5;

type Identity = ReturnType<typeof parseIdentity>;
type NativePermissionRegistry = Pick<PermissionRegistry, 'wait' | 'releaseNative'> & {
  registerNative(agentId: string, request: BridgePermission): RegisterResult;
};
interface Queued {
  command: BridgeMessageCommand;
  provider: NativeProvider;
  instanceId: string;
  agentId: string;
  timer: ReturnType<typeof setTimeout>;
  resolve(result: { ok: boolean; error?: string }): void;
  promise: Promise<{ ok: boolean; error?: string }>;
}
interface PermissionOwner { provider: NativeProvider; instanceId: string; sessionId: string; agentId: string; expiresAt: number }

export interface NativeBridgeHttpOptions {
  sources: Map<NativeProvider, NativeSource>;
  permissions: NativePermissionRegistry;
  viewers(): number;
  messaging: boolean;
  token: string;
  now?: () => number;
}

function send(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
  res.end(data);
}
function sameToken(expected: string, header: string | string[] | undefined): boolean {
  const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{16,256})$/.exec(header) : null;
  const actualHash = createHash('sha256').update(match?.[1] ?? '').digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return !!match && timingSafeEqual(actualHash, expectedHash);
}
function bodySize(raw: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(raw)); } catch { throw new BridgeInvalidRequest('请求必须是有限 JSON'); }
}

/** A separate bounded reader because the browser API's ordinary JSON limit is 256 KiB. */
export function readBridgeJson(req: IncomingMessage, maxBytes = BRIDGE_MAX_BODY): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] ?? ''))) {
    req.resume();
    return Promise.reject(Object.assign(new Error('JSON 必须使用 application/json'), { status: 415 }));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        if (!failed) { failed = true; reject(Object.assign(new Error('请求过大'), { status: 413 })); }
      } else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new BridgeInvalidRequest('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

/** Authenticated native-adapter HTTP endpoint; the outer app still enforces loopback and Host guards. */
export class NativeBridgeHttpController {
  private messages = new Map<string, Queued>();
  private permissionOwners = new Map<string, PermissionOwner>();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval>;

  constructor(private readonly opts: NativeBridgeHttpOptions) {
    this.now = opts.now ?? Date.now;
    this.timer = setInterval(() => this.prune(), 1000);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    for (const item of [...this.messages.values()]) this.complete(item, { ok: false, error: '桥接服务已停止' });
    for (const id of this.permissionOwners.keys()) this.opts.permissions.releaseNative(id);
    this.permissionOwners.clear();
  }

  reachable(): Set<string> {
    if (!this.opts.messaging) return new Set();
    const out = new Set<string>();
    for (const source of this.opts.sources.values()) for (const id of source.reachable()) out.add(id);
    return out;
  }

  /** MessageRegistry resolves this promise only after the owning adapter acknowledges Pi/DSH acceptance. */
  run(agent: AgentInfo, text: string, id: string): Promise<{ ok: boolean; error?: string }> {
    this.prune();
    if (!this.opts.messaging || (agent.provider !== 'dsh' && agent.provider !== 'pi')) return Promise.resolve({ ok: false, error: '原生消息不可用' });
    const source = this.opts.sources.get(agent.provider);
    const owner = source?.ownerOf(agent.id);
    if (!source || !owner || !source.reachable().has(agent.id)) return Promise.resolve({ ok: false, error: '原生会话未连接' });
    if (!id || id.length > 300 || !text || text.length > 20_000) return Promise.resolve({ ok: false, error: '消息无效' });
    const existing = this.messages.get(id);
    if (existing) return existing.agentId === agent.id ? existing.promise : Promise.resolve({ ok: false, error: '消息 ID 已被使用' });
    if (this.messages.size >= MAX_PENDING || [...this.messages.values()].filter((item) => item.agentId === agent.id).length >= MAX_PER_AGENT) {
      return Promise.resolve({ ok: false, error: '消息队列已满' });
    }
    let resolve!: Queued['resolve'];
    const promise = new Promise<{ ok: boolean; error?: string }>((done) => { resolve = done; });
    const command: BridgeMessageCommand = { id, sessionId: owner.sessionId, text, mode: 'queue' };
    const queued: Queued = { command, provider: agent.provider, instanceId: owner.instanceId, agentId: agent.id,
      timer: setTimeout(() => this.complete(queued, { ok: false, error: '原生会话未在 60 秒内确认消息' }), MESSAGE_TIMEOUT_MS), resolve, promise };
    queued.timer.unref?.();
    this.messages.set(id, queued);
    return promise;
  }

  private complete(item: Queued, result: { ok: boolean; error?: string }): void {
    if (this.messages.get(item.command.id) !== item) return;
    clearTimeout(item.timer);
    this.messages.delete(item.command.id);
    item.resolve(result);
  }

  private stillOwns(owner: PermissionOwner): boolean {
    return this.opts.sources.get(owner.provider)?.owns(owner.instanceId, owner.sessionId) === owner.agentId;
  }

  private prune(): void {
    for (const item of [...this.messages.values()]) {
      const owner = this.opts.sources.get(item.provider)?.ownerOf(item.agentId);
      if (!owner || owner.instanceId !== item.instanceId || owner.sessionId !== item.command.sessionId ||
          !this.opts.sources.get(item.provider)?.reachable().has(item.agentId)) {
        this.complete(item, { ok: false, error: '原生会话已断开' });
      }
    }
    for (const [id, owner] of this.permissionOwners) {
      if (this.now() > owner.expiresAt + 5000 || !this.stillOwns(owner)) {
        this.opts.permissions.releaseNative(id);
        this.permissionOwners.delete(id);
      }
    }
  }

  private ownedPermission(id: string, identity: Identity): PermissionOwner | undefined {
    const owner = this.permissionOwners.get(id);
    return owner && owner.provider === identity.provider && owner.instanceId === identity.instanceId && this.stillOwns(owner) ? owner : undefined;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL, readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith(PREFIX)) return false;
    if (!sameToken(this.opts.token, req.headers.authorization)) { send(res, 401, { error: '桥接认证失败' }); return true; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(res, 405, { error: '仅支持 POST' }); return true; }
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > BRIDGE_MAX_BODY) { send(res, 413, { error: '请求过大' }); return true; }
    try {
      const raw = await readBody(req, BRIDGE_MAX_BODY);
      if (bodySize(raw) > BRIDGE_MAX_BODY) { send(res, 413, { error: '请求过大' }); return true; }
      const identity = parseIdentity(raw);
      const source = this.opts.sources.get(identity.provider);
      if (!source) { send(res, 404, { error: '来源不可用' }); return true; }
      this.prune();

      if (path === `${PREFIX}events`) {
        source.ingest(parseEnvelope(raw));
        send(res, 200, { ok: true });
      } else if (path === `${PREFIX}poll`) {
        parseIdentityBody(raw);
        if (!source.poll(identity.instanceId)) { send(res, 404, { error: '实例未注册' }); return true; }
        const messages = this.opts.messaging ? [...this.messages.values()].filter((item) => item.provider === identity.provider &&
          item.instanceId === identity.instanceId && source.owns(identity.instanceId, item.command.sessionId) === item.agentId)
          .slice(0, 20).map((item) => item.command) : [];
        send(res, 200, { messages, viewers: Math.max(0, this.opts.viewers()), permissions: true, messaging: this.opts.messaging });
      } else if (path === `${PREFIX}ack`) {
        for (const result of parseAcks(raw)) {
          const item = this.messages.get(result.id);
          if (!item || item.provider !== identity.provider || item.instanceId !== identity.instanceId ||
              source.owns(identity.instanceId, item.command.sessionId) !== item.agentId) continue;
          this.complete(item, result.ok ? { ok: true } : { ok: false, error: result.error ?? '原生会话拒绝了消息' });
        }
        send(res, 200, { ok: true });
      } else if (path === `${PREFIX}stop`) {
        parseIdentityBody(raw);
        for (const item of [...this.messages.values()]) if (item.provider === identity.provider && item.instanceId === identity.instanceId) {
          this.complete(item, { ok: false, error: '原生实例已停止' });
        }
        for (const [id, owner] of this.permissionOwners) if (owner.provider === identity.provider && owner.instanceId === identity.instanceId) {
          this.opts.permissions.releaseNative(id);
          this.permissionOwners.delete(id);
        }
        source.stopInstance(identity.instanceId);
        send(res, 200, { ok: true });
      } else if (path === `${PREFIX}permissions`) {
        const r = raw as Record<string, unknown>;
        if (Object.keys(r).some((key) => !['version', 'provider', 'instanceId', 'request'].includes(key))) throw new BridgeInvalidRequest('permission');
        const request = parsePermission(r.request);
        const agentId = source.owns(identity.instanceId, request.sessionId);
        if (!agentId) { send(res, 200, { skip: 'unknown-session' }); return true; }
        const result = this.opts.permissions.registerNative(agentId, request);
        if ('skip' in result) send(res, 200, result);
        else {
          this.permissionOwners.set(result.id, { provider: identity.provider, instanceId: identity.instanceId,
            sessionId: request.sessionId, agentId, expiresAt: result.expiresAt });
          send(res, 201, result);
        }
      } else {
        parseIdentityBody(raw);
        const match = PERMISSION_ITEM.exec(path);
        if (!match) { send(res, 404, { error: '桥接路由不存在' }); return true; }
        const owner = this.ownedPermission(match[1], identity);
        if (!owner) { send(res, 404, { error: '审批不存在' }); return true; }
        if (match[2] === 'cancel') {
          this.opts.permissions.releaseNative(match[1]);
          this.permissionOwners.delete(match[1]);
          send(res, 200, { ok: true });
        } else {
          const pending = this.opts.permissions.wait(match[1], 25_000);
          if (!pending) { this.permissionOwners.delete(match[1]); send(res, 404, { error: '审批不存在' }); return true; }
          req.socket?.setTimeout?.(0);
          const close = () => pending.cancel();
          res.once('close', close);
          const result = await pending.result;
          res.off('close', close);
          // A session may be taken over while this request awaits a page decision.
          // Never authorize a tool in a runtime that no longer owns that session.
          if (!this.stillOwns(owner)) {
            this.opts.permissions.releaseNative(match[1]);
            this.permissionOwners.delete(match[1]);
            send(res, 200, { status: 'released', reason: 'cancelled' });
            return true;
          }
          if (result.status !== 'pending') this.permissionOwners.delete(match[1]);
          send(res, 200, result);
        }
      }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return true;
      if (error instanceof BridgeInvalidRequest) send(res, 400, { error: error.message });
      else if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
        send(res, error.status, { error: error.status === 413 ? '请求过大' : '请求无效' });
      } else send(res, 500, { error: '桥接服务错误' });
    }
    return true;
  }
}
