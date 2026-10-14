import type { DshSetupError, DshSetupStatus } from '../../../shared/dsh-setup';
import { t } from '../../../shared/i18n';
import type { UiComponent, UiContext } from './context';
import { h, setAttr, setHidden, setRawText, setText, setTitle } from './dom';

type ConnectionFailure = 'network' | 'local-access';

const SETUP_HINTS: Record<DshSetupError, string> = {
  'dsh-not-found': 'Instale o DeepSeek Harness neste computador e clique em Verificar conexão.',
  'bridge-not-built': 'Os arquivos da ponte não foram encontrados. Recompile ou reinstale o Habblaud.',
  'profile-not-found': 'O perfil DSH não foi encontrado. Verifique a conexão e selecione um perfil disponível.',
  'different-source': 'Este perfil já usa uma ponte de outra instalação do Habblaud. Remova-a no DSH antes de conectar esta instalação.',
  'install-failed': 'Não foi possível instalar a ponte. Verifique se o DSH está instalado e tente novamente.',
  'enable-failed': 'Não foi possível habilitar a ponte. Verifique as permissões da pasta DSH e tente novamente.',
  'setup-disabled': 'A conexão DSH requer o Habblaud local com a integração e o terminal habilitados.',
};

/** All installation changes require a click; polling only reads setup and bridge status. */
export class DshSetupController implements UiComponent {
  status: DshSetupStatus | undefined;
  busy = false;
  checking = false;
  failure: ConnectionFailure | undefined;
  private selectedProfile: string | undefined;
  private nextCheck = 0;

  constructor(private ctx: UiContext, private openSettings: () => void) {}

  render(): void {
    if (!this.ctx.store.mock && this.ctx.store.connection === 'open' && Date.now() >= this.nextCheck && !this.busy && !this.checking) {
      void this.refresh();
    }
  }

  get connecting(): boolean {
    return this.busy || this.status?.state === 'connecting';
  }

  get label(): string {
    if (this.connecting) return 'Conectando DSH…';
    if (this.status?.state === 'connected' && !this.failure) return 'DSH conectado';
    if (this.status?.state === 'installed' && !this.failure) return 'Aguardando DSH';
    return 'Conectar DSH';
  }

  get topbarLabel(): string {
    return !this.connecting && !this.failure && !this.status?.error && this.status?.connected ? 'DSH conectado' : this.label;
  }

  get buttonLabel(): string {
    return this.status?.state === 'installed' && !this.connecting && !this.failure ? 'Reconectar DSH' : this.label;
  }

  get hint(): string {
    if (this.connecting) return 'Instalando e habilitando a ponte DSH… Isso pode levar alguns minutos.';
    if (this.failure === 'local-access') return 'Abra esta página pelo endereço local do Habblaud para conectar o DSH.';
    if (this.failure) return 'Não foi possível verificar a conexão. Confira se o Habblaud está em execução e tente novamente.';
    if (!this.status) return 'Verificando a conexão DSH…';
    if (this.status.error) return SETUP_HINTS[this.status.error];
    if (!this.status.profile && this.status.profiles.length > 1) return 'Você tem vários perfis DSH. Escolha qual deseja conectar.';
    if (this.status.state === 'connected') return 'A ponte está ativa e recebendo eventos do DSH. A conexão será refeita automaticamente.';
    if (this.status.state === 'installed') return this.status.connected
      ? 'Ponte habilitada neste perfil. O Habblaud já recebe eventos de um DSH; este perfil se conectará quando você o iniciar.'
      : 'Ponte habilitada. Abra o DSH para conectar. Se ele já está aberto, aguarde sua tarefa terminar e reinicie o DSH uma vez.';
    if (this.status.state === 'disabled') return 'A ponte está desativada. Conectar DSH habilita somente esta integração.';
    return 'Instala e habilita a ponte. Depois, o DSH se conecta automaticamente ao iniciar.';
  }

  get canConnect(): boolean {
    return !this.connecting && !this.checking && !this.failure && !!this.status?.canConnect && !!this.status.profile && this.status.state !== 'connected';
  }

  fromTopbar(): void {
    if (this.canConnect && this.status?.state !== 'installed') void this.connect();
    else this.openSettings();
  }

  async selectProfile(profile: string): Promise<void> {
    this.selectedProfile = profile || undefined;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.busy || this.checking || this.ctx.store.mock) return;
    this.checking = true;
    this.nextCheck = Date.now() + 5_000;
    try {
      const query = this.selectedProfile ? `?profile=${encodeURIComponent(this.selectedProfile)}` : '';
      const res = await fetch(`/api/integrations/dsh${query}`, { cache: 'no-store' });
      if (!res.ok) {
        this.failure = res.status === 403 ? 'local-access' : 'network';
        return;
      }
      this.status = await res.json() as DshSetupStatus;
      this.failure = undefined;
    } catch {
      this.failure = 'network';
    } finally {
      this.checking = false;
      this.ctx.invalidate();
    }
  }

  async connect(): Promise<void> {
    if (!this.canConnect) return;
    this.busy = true;
    this.ctx.invalidate();
    try {
      const res = await fetch('/api/integrations/dsh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: this.status!.profile }),
      });
      if (!res.ok) {
        this.failure = res.status === 403 ? 'local-access' : 'network';
      } else {
        this.status = await res.json() as DshSetupStatus;
        this.failure = undefined;
      }
    } catch {
      this.failure = 'network';
    } finally {
      this.busy = false;
      this.nextCheck = Date.now() + 1_000;
      this.ctx.announce(t(this.hint));
      this.openSettings();
      this.ctx.invalidate();
    }
  }
}

export class DshConnectButton implements UiComponent {
  readonly el: HTMLButtonElement;
  private label: HTMLElement;

  constructor(private ctx: UiContext, private setup: DshSetupController) {
    this.label = h('span', { text: 'Conectar DSH' });
    this.el = h('button', {
      class: 'ui-btn ui-dsh-connect', type: 'button', title: setup.hint,
      on: { click: () => setup.fromTopbar() },
    }, h('span', { class: 'ui-dsh-connect__dot', attrs: { 'aria-hidden': 'true' } }), this.label);
  }

  render(): void {
    setHidden(this.el, this.ctx.store.mock);
    setText(this.label, this.setup.topbarLabel);
    setTitle(this.el, this.setup.hint);
    setAttr(this.el, 'aria-label', t(this.setup.topbarLabel));
    setAttr(this.el, 'aria-busy', String(this.setup.connecting));
    this.el.classList.toggle('is-connected', !!this.setup.status?.connected && !this.setup.status.error && !this.setup.failure);
    this.el.disabled = this.setup.connecting;
  }
}

export class DshSettingsGroup implements UiComponent {
  readonly el: HTMLElement;
  private status: HTMLElement;
  private select: HTMLSelectElement;
  private profileRow: HTMLElement;
  private button: HTMLButtonElement;
  private refreshButton: HTMLButtonElement;
  private profileKey = '';

  constructor(private ctx: UiContext, private setup: DshSetupController) {
    this.status = h('p', { class: 'ui-set__hint ui-dsh-setup__status', role: 'status', attrs: { 'aria-live': 'polite' } });
    this.select = h('select', { class: 'ui-dsh-setup__profile', attrs: { 'aria-label': 'Perfil DSH' },
      on: { change: () => void setup.selectProfile(this.select.value) } });
    this.profileRow = h('label', { class: 'ui-set ui-set--stack' }, h('span', { class: 'ui-set__label', text: 'Perfil DSH' }), this.select);
    this.button = h('button', { class: 'ui-btn', type: 'button', text: 'Conectar DSH', on: { click: () => void setup.connect() } });
    this.refreshButton = h('button', { class: 'ui-link-btn', type: 'button', text: 'Verificar conexão', on: { click: () => void setup.refresh() } });
    this.el = h('div', { class: 'ui-set-group ui-dsh-setup' },
      h('h3', { text: 'Integrações' }), h('span', { class: 'ui-set__label', text: 'DeepSeek Harness' }),
      this.status, this.profileRow, h('div', { class: 'ui-dsh-setup__actions' }, this.button, this.refreshButton));
  }

  highlight(): void {
    this.el.scrollIntoView({ block: 'nearest' });
  }

  render(): void {
    setHidden(this.el, this.ctx.store.mock);
    setText(this.status, this.setup.hint);
    setText(this.button, this.setup.buttonLabel);
    this.button.disabled = !this.setup.canConnect;
    this.refreshButton.disabled = this.setup.connecting || this.setup.checking;
    this.select.disabled = this.setup.connecting || this.setup.checking;
    setAttr(this.button, 'aria-busy', String(this.setup.connecting));
    this.el.classList.toggle('is-error', !!this.setup.failure || !!this.setup.status?.error);
    const profiles = this.setup.status?.profiles ?? [];
    setHidden(this.profileRow, profiles.length < 2);
    const key = profiles.map((p) => p.name).join('\0');
    if (key !== this.profileKey || !this.select.options.length) {
      this.profileKey = key;
      this.select.replaceChildren(h('option', { text: 'Selecione um perfil', attrs: { value: '' } }));
      for (const p of profiles) {
        const option = h('option', { attrs: { value: p.name } });
        setRawText(option, p.name);
        this.select.append(option);
      }
    }
    this.select.value = this.setup.status?.profile ?? '';
  }
}
