import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridgeClient } from './client';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function config(url = 'http://127.0.0.1:4747'): string {
  const dir = mkdtempSync(join(tmpdir(), 'habblaud-native-client-'));
  dirs.push(dir);
  const file = join(dir, 'bridge.json');
  writeFileSync(file, JSON.stringify({ version: 1, url, token: 'local-test-token-1234567890' }));
  return file;
}

describe('native bridge client', () => {
  it('never transmits the local token to a non-loopback URL or credentials in a URL', async () => {
    const fetcher = vi.fn();
    for (const url of ['https://example.com', 'http://user:pass@127.0.0.1:4747', 'http://127.0.0.1.example.com']) {
      const c = new NativeBridgeClient('dsh', { configFile: config(url), fetch: fetcher });
      expect(await c.send([{ type: 'heartbeat' }])).toBe(false);
      expect(await c.permission({ sessionId: 's', tool: 'bash' })).toEqual({ behavior: 'terminal' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retries a lost response with the same sequence before the next event', async () => {
    const received: { seq: number; events: unknown[] }[] = [];
    let failed = false;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      received.push(body);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-test-token-1234567890');
      if (!failed) { failed = true; throw new Error('response lost'); }
      return Response.json({ ok: true });
    });
    const c = new NativeBridgeClient('pi', { configFile: config(), instanceId: 'instance', fetch: fetcher });
    expect(await c.send([{ type: 'heartbeat' }])).toBe(false);
    expect(await c.send([{ type: 'closed', sessionId: 's' }])).toBe(true);
    expect(received.map((x) => x.seq)).toEqual([1, 1, 2]);
  });

  it('falls back when a live permission is released and cleans cancellation exactly once', async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const p = new URL(String(url)).pathname;
      paths.push(p);
      if (p === '/api/bridge/permissions') return Response.json({ id: 'p1', expiresAt: Date.now() + 1000 });
      return Response.json({ status: 'released', reason: 'terminal' });
    });
    const c = new NativeBridgeClient('dsh', { configFile: config(), fetch: fetcher });
    expect(await c.permission({ sessionId: 's', tool: 'bash' })).toEqual({ behavior: 'terminal' });
    const abort = new AbortController(); abort.abort();
    expect(await c.permission({ sessionId: 's', tool: 'bash' }, abort.signal)).toEqual({ behavior: 'cancelled' });
    expect(paths).toEqual(['/api/bridge/permissions', '/api/bridge/permissions/p1/wait']);
  });
});
