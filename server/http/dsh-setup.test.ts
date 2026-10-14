import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DshSetupStatus } from '../../shared/dsh-setup';
import { createApiHandler, type ApiDeps } from './app';
import { createRequestGuard } from './guard';

const ready: DshSetupStatus = {
  state: 'ready', profile: 'web', profiles: [{ name: 'web', installed: false, enabled: false }],
  canConnect: true, connected: false, autostart: false,
};

describe('DSH setup HTTP boundary', () => {
  let server: http.Server;
  let base: string;
  let deps: ApiDeps;
  const status = vi.fn(() => ready);
  const connect = vi.fn(async (_profile?: string) => ready);

  beforeEach(async () => {
    status.mockReset().mockReturnValue(ready);
    connect.mockReset().mockResolvedValue(ready);
    deps = { terminal: true, inDocker: false, dshSetup: { status, connect } } as unknown as ApiDeps;
    const api = createApiHandler(deps);
    const guard = createRequestGuard();
    server = http.createServer((req, res) => {
      if (!guard(req, res)) api(req, res, new URL(req.url ?? '/', 'http://localhost'));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (base: string, body: unknown = {}, origin = base) => fetch(`${base}/api/integrations/dsh/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });

  it('polling reads status without installing; POST passes only a profile', async () => {
    const read = await fetch(`${base}/api/integrations/dsh?profile=web`);
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toEqual(ready);
    expect(status).toHaveBeenCalledWith('web');
    expect(connect).not.toHaveBeenCalled();
    expect((await post(base, { profile: 'web' })).status).toBe(200);
    expect(connect).toHaveBeenCalledExactlyOnceWith('web');
  });

  it('keeps status reads responsive while an installation is pending', async () => {
    let finish!: (status: DshSetupStatus) => void;
    connect.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = post(base, { profile: 'web' });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    const read = await fetch(`${base}/api/integrations/dsh`);
    expect(read.status).toBe(200);
    finish({ ...ready, state: 'installed', autostart: true });
    expect(await (await pending).json()).toMatchObject({ state: 'installed', connected: false });
  });

  it('rejects other origins, including another local port', async () => {
    for (const origin of ['https://example.com', 'http://127.0.0.1:1', 'http://localhost', 'null']) {
      expect((await post(base, {}, origin)).status).toBe(403);
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('requires JSON and rejects commands, paths, invalid profiles, or duplicate query values', async () => {
    expect((await fetch(`${base}/api/integrations/dsh/connect`, { method: 'POST', body: '{}' })).status).toBe(415);
    for (const body of [null, [], { command: 'anything' }, { dshHome: '/tmp/other' }, { profile: '../web' }, { profile: 'desktop' }, { profile: 'node_modules' }, { profile: 3 }]) {
      expect((await post(base, body)).status).toBe(400);
    }
    expect((await fetch(`${base}/api/integrations/dsh?profile=web&profile=other`)).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('reports disabled setup and never installs in Docker or with a disabled terminal', async () => {
    for (const mode of ['docker', 'terminal', 'missing'] as const) {
      deps.inDocker = mode === 'docker';
      deps.terminal = mode !== 'terminal';
      deps.dshSetup = mode === 'missing' ? undefined : { status, connect };
      expect(await (await fetch(`${base}/api/integrations/dsh`)).json()).toMatchObject({ state: 'unavailable', canConnect: false, error: 'setup-disabled' });
      expect((await post(base)).status).toBe(403);
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('enforces method and local socket/Host checks independently of proxy configuration', async () => {
    expect((await fetch(`${base}/api/integrations/dsh/connect`)).status).toBe(405);
    expect((await fetch(`${base}/api/integrations/dsh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
    const handler = createApiHandler(deps);
    for (const [host, remoteAddress] of [['192.168.1.2', '127.0.0.1'], ['127.0.0.1:4848', '192.168.1.2']]) {
      const writeHead = vi.fn();
      const req = { method: 'GET', headers: { host }, socket: { remoteAddress }, resume: vi.fn() } as unknown as http.IncomingMessage;
      const res = { writeHead, end: vi.fn() } as unknown as http.ServerResponse;
      expect(handler(req, res, new URL(`${base}/api/integrations/dsh`))).toBe(true);
      expect(writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not expose installer errors or private paths', async () => {
    connect.mockRejectedValue(new Error('secret-token private-config /Users/private/.dsh'));
    const res = await post(base);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'erro interno' });
  });
});
