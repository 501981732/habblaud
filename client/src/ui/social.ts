// Seção "Vida social" da gaveta do agente: o que está fazendo numa roda, carteira de moedinhas,
// placar, personalidade, amizades/rivalidades com quem está no escritório e o extrato.
import type { AgentSocial } from '../world/api';
import { getLocale, t } from '../../../shared/i18n';
import type { UiContext } from './context';
import { h, setHidden, setRawText, setText, setTitle } from './dom';
import { plural, relativeTime } from './format';

/** "+🪙10" / "−🪙10" (sinal tipográfico de menos). */
export function coinDelta(delta: number): string {
  return `${delta >= 0 ? '+' : '−'}🪙${Math.abs(delta)}`;
}

/** "3 vitórias · 1 derrota" (ou "Sem partidas ainda"). */
export function recordText(wins: number, losses: number): string {
  if (!wins && !losses) return t('Sem partidas ainda');
  return `${plural(wins, 'vitória', 'vitórias')} · ${plural(losses, 'derrota', 'derrotas')}`;
}

/** Translate generated activity labels while keeping character names verbatim. */
function localizeSocialDoing(source: string): string {
  if (getLocale() === 'pt-BR') return source;
  let text = source;
  for (const label of ['Vendo futebol na TV', 'Vendo novela na TV', 'Vendo desenho na TV', 'Jogando videogame', 'Duelo no fliperama', 'Jogando pingue-pongue', 'Papo na copa', 'Conversando', 'Jokenpô', 'Se arrumando no espelho']) {
    text = text.replace(label, t(label));
  }
  text = text.replace(/ com ([^·(]+)(?= · valendo| \(a caminho\)|$)/, (_all, names: string) => t('，和 {names}', { names: names.trim().replace(/ e /g, '、') }));
  text = text.replace(/ · valendo 🪙(\d+)/, (_all, amount: string) => t(' · valendo 🪙{amount}', { amount }));
  text = text.replace(' (a caminho)', t(' (a caminho)'));
  return text;
}

function localizeLedgerText(source: string): string {
  if (getLocale() === 'pt-BR') return source;
  let match = /^(\d+) tarefas já concluídas$/.exec(source);
  if (match) return t('{n} tarefas já concluídas', { n: match[1] });
  match = /^Tarefa concluída: (.*)$/.exec(source);
  if (match) return t('Tarefa concluída: {title}', { title: match[1] });
  match = /^Entregou: (.*)$/.exec(source);
  if (match) return t('Entregou: {result}', { result: match[1] });
  match = /^Perdeu (.*) para (.*)$/.exec(source);
  if (match) return t('Perdeu {what} para {name}', { what: match[1], name: match[2] });
  match = /^Ganhou (.*) de (.*)$/.exec(source);
  if (match) return t('Ganhou {what} de {name}', { what: match[1], name: match[2] });
  return t(source);
}

const LEDGER_SHOWN = 6;

export class SocialSection {
  readonly el: HTMLElement;
  private extra: HTMLElement;
  private doing: HTMLElement;
  private coins: HTMLElement;
  private earned: HTMLElement;
  private record: HTMLElement;
  private traits: HTMLElement;
  private phrase: HTMLElement;
  private friends: HTMLElement;
  private rivals: HTMLElement;
  private friendsRow: HTMLElement;
  private rivalsRow: HTMLElement;
  private ledger: HTMLElement;
  private ledgerBox: HTMLDetailsElement;
  /** Assinaturas do que já está no DOM (só refaz as listas quando mudam). */
  private keys = { traits: '', bonds: '', ledger: '' };

  constructor(private ctx: UiContext) {
    const title = h('h3', { class: 'ui-sec__title', text: 'Vida social' });
    this.extra = h('span', { class: 'ui-sec__extra ui-social__balance' });
    this.doing = h('p', { class: 'ui-social__doing' });
    this.coins = h('strong', { class: 'ui-social__coins' });
    this.earned = h('span', { class: 'ui-social__earned' });
    this.record = h('span', { class: 'ui-social__record' });
    this.traits = h('div', { class: 'ui-social__traits' });
    this.phrase = h('p', { class: 'ui-social__phrase' });
    this.friends = h('span', { class: 'ui-social__names' });
    this.rivals = h('span', { class: 'ui-social__names' });
    this.friendsRow = h('p', { class: 'ui-social__bond' }, h('span', { class: 'ui-social__bond-label', text: '💛 Amizades' }), this.friends);
    this.rivalsRow = h('p', { class: 'ui-social__bond' }, h('span', { class: 'ui-social__bond-label', text: '⚔️ Rivalidades' }), this.rivals);
    this.ledger = h('ol', { class: 'ui-social__ledger' });
    this.ledgerBox = h('details', { class: 'ui-social__extract' }, h('summary', { text: 'Extrato' }), this.ledger);
    const wallet = h(
      'div',
      { class: 'ui-social__wallet' },
      h('span', { class: 'ui-social__purse', attrs: { 'aria-hidden': 'true' }, text: '🪙' }),
      h('div', { class: 'ui-social__wallet-body' }, h('div', { class: 'ui-social__wallet-line' }, this.coins, this.record), this.earned),
    );
    setTitle(wallet, 'Moedinhas fictícias: entra no escritório com um saldo, ganha 🪙10 por tarefa concluída e 🪙5 por pedido atendido, e aposta com os colegas. Ficam salvas neste navegador.');
    this.el = h(
      'section',
      { class: 'ui-sec ui-social' },
      h('div', { class: 'ui-sec__head' }, title, this.extra),
      this.doing,
      wallet,
      this.traits,
      this.phrase,
      this.friendsRow,
      this.rivalsRow,
      this.ledgerBox,
    );
  }

  /** Atualiza com o agente `id`; some quando o mundo não sabe dele (já saiu, ou mundo antigo). */
  render(id: string, now: number): void {
    const s: AgentSocial | null = this.ctx.world.social?.(id) ?? null;
    setHidden(this.el, !s);
    if (!s) return;
    setText(this.extra, `🪙 ${s.coins}`);
    setRawText(this.doing, s.doing ? localizeSocialDoing(s.doing) : '');
    setHidden(this.doing, !s.doing);
    setText(this.coins, `${s.coins} ${t('moedinhas')}`);
    setText(this.record, recordText(s.wins, s.losses));
    setText(this.earned, `${coinDelta(s.earned)} ${t('ganhos trabalhando')}`);
    setText(this.phrase, `${t('Bordão:')} “${t(s.catchphrase)}”`);

    const tk = `${getLocale()}|${s.traits.map((t) => t.label).join('|')}`;
    if (tk !== this.keys.traits) {
      this.keys.traits = tk;
      this.traits.replaceChildren(...s.traits.map((trait) => h('span', { class: 'ui-trait', title: t(trait.desc), text: `${trait.emoji} ${t(trait.label)}` })));
    }

    const bk = `${getLocale()}|${s.bonds.map((b) => `${b.id}:${b.kind}:${b.name}:${b.record?.join('-') ?? ''}`).join('|')}`;
    if (bk !== this.keys.bonds) {
      this.keys.bonds = bk;
      const link = (b: AgentSocial['bonds'][number]) => {
        const label = b.record ? `${b.name} (${b.record[0]}×${b.record[1]})` : b.name;
        return h('button', {
          class: 'ui-social__name',
          type: 'button',
          text: label,
          title: b.record ? t('Retrospecto contra {name}: {record}', { name: b.name, record: recordText(b.record[0], b.record[1]) }) : t('Ver {name}', { name: b.name }),
          rawText: true,
          rawTitle: true,
          on: { click: () => this.ctx.select({ type: 'agent', id: b.id }, { focus: true }) },
        });
      };
      const friends = s.bonds.filter((b) => b.kind === 'amizade');
      const rivals = s.bonds.filter((b) => b.kind === 'rivalidade');
      this.friends.replaceChildren(...friends.map(link));
      this.rivals.replaceChildren(...rivals.map(link));
      setHidden(this.friendsRow, !friends.length);
      setHidden(this.rivalsRow, !rivals.length);
    }

    const items = s.ledger.slice(0, LEDGER_SHOWN);
    const lk = `${getLocale()}|${items.map((e) => `${e.at}:${e.delta}:${e.text}`).join('|')}@${Math.floor(now / 30_000)}`;
    if (lk !== this.keys.ledger) {
      this.keys.ledger = lk;
      this.ledger.replaceChildren(
        ...items.map((e) =>
          h(
            'li',
            { class: `ui-social__entry ${e.delta >= 0 ? 'is-plus' : 'is-minus'}` },
            h('span', { class: 'ui-social__delta', text: coinDelta(e.delta) }),
            h('span', { class: 'ui-social__what', text: `${e.icon} ${localizeLedgerText(e.text)}`, rawText: true }),
            h('time', { class: 'ui-social__when', text: relativeTime(e.at, now) }),
          ),
        ),
      );
    }
    setHidden(this.ledgerBox, !items.length);
  }
}
