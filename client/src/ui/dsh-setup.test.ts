import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DshSetupStatus } from '../../../shared/dsh-setup';
import { setLocale, t } from '../../../shared/i18n';
import type { UiContext } from './context';
import { DshSetupController } from './dsh-setup';

const ready: DshSetupStatus = {
  state: 'ready', profile: 'web', profiles: [{ name: 'web', installed: false, enabled: false }],
  canConnect: true, connected: false, autostart: false,
};

function setup() {
  const open = vi.fn();
  const ctx = { store: { mock: false, connection: 'open' }, invalidate: vi.fn(), announce: vi.fn() } as unknown as UiContext;
  return { controller: new DshSetupController(ctx, open), open, ctx };
}

const response = (status: DshSetupStatus) => Promise.resolve(new Response(JSON.stringify(status), { status: 200 }));

describe('DSH connection controls', () => {
  afterEach(() => { vi.unstubAllGlobals(); setLocale('zh-CN'); });

  it('status polling never installs or enables anything', async () => {
    const fetcher = vi.fn(() => response(ready));
    vi.stubGlobal('fetch', fetcher);
    const { controller } = setup();
    await controller.refresh();
    controller.render();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/integrations/dsh', { cache: 'no-store' });
    expect(t(controller.label)).toBe('连接 DSH');
  });

  it('prevents repeat clicks while installing and keeps installation separate from live connection', async () => {
    let finish!: (res: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => response(ready))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const { controller, open } = setup();
    await controller.refresh();
    const pending = controller.connect();
    await controller.connect();
    controller.render();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(t(controller.label)).toBe('正在连接 DSH…');
    expect(fetcher.mock.calls[1]).toEqual(['/api/integrations/dsh/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"profile":"web"}',
    }]);
    finish(new Response(JSON.stringify({ ...ready, state: 'installed', autostart: true })));
    await pending;
    expect(t(controller.label)).toBe('等待 DSH 连接');
    expect(t(controller.hint)).toContain('桥接已启用');
    expect(t(controller.hint)).toContain('当前任务结束');
    expect(open).toHaveBeenCalledOnce();
    fetcher.mockImplementation(() => response({ ...ready, state: 'connected', connected: true, autostart: true }));
    await controller.refresh();
    expect(t(controller.label)).toBe('DSH 已连接');
  });

  it('requires an explicit profile choice when several are installed', async () => {
    const multiple = { ...ready, profile: '', canConnect: false, profiles: [ready.profiles[0], { name: 'terminal', installed: false, enabled: false }] };
    const fetcher = vi.fn().mockImplementationOnce(() => response(multiple))
      .mockImplementationOnce(() => response({ ...ready, profile: 'terminal', profiles: multiple.profiles }));
    vi.stubGlobal('fetch', fetcher);
    const { controller, open } = setup();
    await controller.refresh();
    controller.fromTopbar();
    expect(open).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await controller.selectProfile('terminal');
    expect(fetcher.mock.calls[1][0]).toBe('/api/integrations/dsh?profile=terminal');
    expect(controller.canConnect).toBe(true);
  });

  it('shows a safe error and permits a retry after recovering the server connection', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('private installer error', { status: 403 }))
      .mockImplementationOnce(() => response(ready));
    vi.stubGlobal('fetch', fetcher);
    const { controller } = setup();
    await controller.refresh();
    expect(controller.canConnect).toBe(false);
    expect(t(controller.hint)).toBe('请通过 Habblaud 的本机地址打开页面，再连接 DSH。');
    await controller.refresh();
    expect(controller.canConnect).toBe(true);
    expect(controller.failure).toBeUndefined();
  });
});
