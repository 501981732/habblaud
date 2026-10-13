// GitHub no escritório: PR aberto ou mergeado, push, CI e release viram avisos e efeitos na sala do
// projeto (festa ou alarme). Código puro, usado pelo servidor (eventos detectados nos transcripts, ver
// server/sources/github.ts) e pelo simulador de demonstração.
import { maskSecrets, truncate, type MarkedDescription } from './activity';
import { productCopy, type ProductCopy } from './copy';
import type { MessageRef, NoticeLevel, RoomEffect } from './types';

export type GitHubEventKind = 'pr_opened' | 'pr_merged' | 'push' | 'ci_failed' | 'ci_passed' | 'release';

/** Um evento do GitHub visto num transcript (ou inventado pelo demo). */
export interface GitHubEvent {
  kind: GitHubEventKind;
  /** Número do PR (aberto, mergeado ou cujas checagens rodaram). */
  number?: number;
  /** "dono/repo", quando aparece na URL ou nos argumentos. */
  repo?: string;
  /** Branch do push ou do CI. */
  branch?: string;
  /** Tag da release. */
  tag?: string;
  /** Workflow ou checagem do CI (ex.: "CI", "build-test"). */
  workflow?: string;
  url?: string;
}

/** Marcador (Activity.tool) das atividades sintetizadas a partir de eventos do GitHub. */
export const GITHUB_TOOL = 'GitHub';
/** Duração da festa (PR, merge, release). */
export const PARTY_MS = 12_000;
/** O alarme de CI vermelho acaba com um CI verde na sala ou depois disto. */
export const ALARM_MS = 600_000;

const MAX_TEXT = 46;
const MAX_BANNER = 30;

function clean(s: string, max: number): string {
  return truncate(maskSecrets(s.slice(0, max * 4)), max);
}

/** Onde o CI rodou, para os textos: branch, PR ou workflow. */
function ciWhere(ev: GitHubEvent): string | undefined {
  if (ev.branch) return clean(ev.branch, 28);
  if (ev.number !== undefined) return `PR #${ev.number}`;
  return ev.workflow ? clean(ev.workflow, 28) : undefined;
}

/** O que rodou, para a atividade: o workflow (se não for só "CI"), senão onde. */
function ciWhat(ev: GitHubEvent): string | undefined {
  return ev.workflow && !/^ci$/i.test(ev.workflow.trim()) ? ev.workflow : ciWhere(ev);
}

/** Faixa curta da festa/alarme na sala (undefined = o evento não mexe na sala, ex.: push). */
function bannerCopyOf(ev: GitHubEvent): ProductCopy | undefined {
  const pr = ev.number !== undefined ? `PR #${ev.number}` : 'PR';
  switch (ev.kind) {
    case 'pr_opened':
      return productCopy('{pr} aberto!', { pr });
    case 'pr_merged':
      return productCopy('{pr} mergeado!', { pr });
    case 'release':
      return ev.tag ? productCopy('Release {tag} no ar!', { tag: clean(ev.tag, 22) }) : productCopy('Release no ar!');
    case 'ci_failed': {
      const where = ciWhere(ev);
      return where ? productCopy('CI falhou ({onde})', { onde: where }) : productCopy('CI falhou');
    }
    case 'ci_passed':
      return productCopy('CI verde de novo!');
    default:
      return undefined;
  }
}

export function bannerOf(ev: GitHubEvent): string | undefined {
  const pr = ev.number !== undefined ? `PR #${ev.number}` : 'PR';
  switch (ev.kind) {
    case 'pr_opened':
      return `${pr} aberto!`;
    case 'pr_merged':
      return `${pr} mergeado!`;
    case 'release':
      return ev.tag ? clean(`Release ${ev.tag} no ar!`, MAX_BANNER) : 'Release no ar!';
    case 'ci_failed': {
      const where = ciWhere(ev);
      return clean(where ? `CI falhou (${where})` : 'CI falhou', MAX_BANNER);
    }
    case 'ci_passed':
      return 'CI verde de novo!';
    default:
      return undefined;
  }
}

/** Chave de deduplicação dos avisos (o mesmo PR/branch visto por dois comandos seguidos). */
export function githubEventKey(ev: GitHubEvent): string {
  return `${ev.kind}:${ev.number ?? ''}:${ev.branch ?? ''}:${ev.tag ?? ''}`;
}

export interface GitHubEventText {
  /** Aviso (toast). Ex.: "🎉 Danilo abriu o PR #12 em habblaud". */
  notice: string;
  noticeI18n: MessageRef;
  level: NoticeLevel;
  /** Atividade do agente (feed e linha do tempo), com o marcador GITHUB_TOOL. */
  activity: MarkedDescription;
}

/** Textos em PT-BR de um evento: aviso e atividade. */
export function describeGitHubEvent(ev: GitHubEvent, agentName: string, roomName: string): GitHubEventText {
  const pr = ev.number !== undefined ? `o PR #${ev.number}` : 'um PR';
  const act = (icon: string, copy: ProductCopy, detail?: string, error = false): MarkedDescription => {
    const d: MarkedDescription = { kind: 'git', icon, text: clean(copy.text, MAX_TEXT), i18n: copy.i18n, tool: GITHUB_TOOL };
    const det = detail ?? ev.url ?? ev.repo;
    if (det) d.detail = clean(det, 300);
    if (error) d.error = true;
    return d;
  };
  switch (ev.kind) {
    case 'pr_opened':
      return { notice: `🎉 ${agentName} abriu ${pr} em ${roomName}`, noticeI18n: ev.number !== undefined ? productCopy('🎉 {agente} abriu o PR #{numero} em {sala}', { agente: agentName, numero: ev.number, sala: roomName }).i18n : productCopy('🎉 {agente} abriu um PR em {sala}', { agente: agentName, sala: roomName }).i18n, level: 'success', activity: act('🎉', ev.number !== undefined ? productCopy('Abriu o PR #{numero}', { numero: ev.number }) : productCopy('Abriu um PR')) };
    case 'pr_merged':
      return { notice: `🎉 ${agentName} mergeou ${pr} em ${roomName}`, noticeI18n: ev.number !== undefined ? productCopy('🎉 {agente} mergeou o PR #{numero} em {sala}', { agente: agentName, numero: ev.number, sala: roomName }).i18n : productCopy('🎉 {agente} mergeou um PR em {sala}', { agente: agentName, sala: roomName }).i18n, level: 'success', activity: act('🎉', ev.number !== undefined ? productCopy('Mergeou o PR #{numero}', { numero: ev.number }) : productCopy('Mergeou um PR')) };
    case 'release': {
      const tag = ev.tag ? clean(ev.tag, 24) : undefined;
      return {
        notice: `🎉 ${agentName} publicou ${tag ? `a release ${tag}` : 'uma release'} em ${roomName}`,
        noticeI18n: tag ? productCopy('🎉 {agente} publicou a release {tag} em {sala}', { agente: agentName, tag, sala: roomName }).i18n : productCopy('🎉 {agente} publicou uma release em {sala}', { agente: agentName, sala: roomName }).i18n,
        level: 'success',
        activity: act('🎉', tag ? productCopy('Publicou a release {tag}', { tag }) : productCopy('Publicou uma release')),
      };
    }
    case 'push': {
      const branch = ev.branch ? clean(ev.branch, 28) : undefined;
      return {
        notice: `🚀 ${agentName} enviou commits ${branch ? `para ${branch} ` : ''}em ${roomName}`,
        noticeI18n: branch ? productCopy('🚀 {agente} enviou commits para {branch} em {sala}', { agente: agentName, branch, sala: roomName }).i18n : productCopy('🚀 {agente} enviou commits em {sala}', { agente: agentName, sala: roomName }).i18n,
        level: 'info',
        activity: act('🚀', branch ? productCopy('Enviou commits para {branch}', { branch }) : productCopy('Enviou commits ao GitHub')),
      };
    }
    case 'ci_failed': {
      const where = ciWhere(ev);
      const what = ciWhat(ev);
      return {
        notice: `🚨 CI falhou em ${roomName}${where ? ` (${where})` : ''}`,
        noticeI18n: where ? productCopy('🚨 CI falhou em {sala} ({onde})', { sala: roomName, onde: where }).i18n : productCopy('🚨 CI falhou em {sala}', { sala: roomName }).i18n,
        level: 'warn',
        activity: act('🚨', what ? productCopy('CI falhou: {etapa}', { etapa: clean(what, 28) }) : productCopy('CI falhou'), [ev.workflow, ev.branch, ev.url].filter(Boolean).join(' — ') || undefined, true),
      };
    }
    case 'ci_passed': {
      const where = ciWhere(ev);
      const what = ciWhat(ev);
      return {
        notice: `✅ CI passou em ${roomName}${where ? ` (${where})` : ''}`,
        noticeI18n: where ? productCopy('✅ CI passou em {sala} ({onde})', { sala: roomName, onde: where }).i18n : productCopy('✅ CI passou em {sala}', { sala: roomName }).i18n,
        level: 'success',
        activity: act('✅', what ? productCopy('CI passou: {etapa}', { etapa: clean(what, 28) }) : productCopy('CI passou'), [ev.workflow, ev.branch, ev.url].filter(Boolean).join(' — ') || undefined),
      };
    }
  }
}

// ------------------------------------------------------------------ efeitos das salas

interface RoomSlots {
  party?: RoomEffect;
  alarm?: RoomEffect;
}

/**
 * Ciclo de vida dos efeitos das salas: festa (PR aberto/mergeado, release; e CI verde que apaga um
 * alarme) por PARTY_MS; alarme (CI vermelho) até um CI verde na sala ou ALARM_MS. Uma festa passa na
 * frente do alarme enquanto dura (o alarme continua valendo por baixo); um CI vermelho novo encerra
 * a festa. Uma sala que sai e volta antes de o alarme vencer volta com ele (o CI continua vermelho).
 */
export class RoomEffects {
  private rooms = new Map<string, RoomSlots>();

  /** Aplica um evento à sala; true se o efeito visível mudou. */
  apply(roomId: string, ev: GitHubEvent, now: number, agentId?: string): boolean {
    const slots = this.rooms.get(roomId) ?? {};
    const make = (kind: RoomEffect['kind'], ev: GitHubEvent, ms: number): RoomEffect => {
      const copy = bannerCopyOf(ev)!;
      const fx: RoomEffect = { kind, text: bannerOf(ev)!, i18n: copy.i18n, at: now, until: now + ms };
      if (agentId) fx.agentId = agentId;
      return fx;
    };
    switch (ev.kind) {
      case 'pr_opened':
      case 'pr_merged':
      case 'release':
        slots.party = make('party', ev, PARTY_MS);
        break;
      case 'ci_failed':
        // o vermelho mais novo vale na hora (encerra uma festa em andamento)
        slots.alarm = make('alarm', ev, ALARM_MS);
        delete slots.party;
        break;
      case 'ci_passed':
        // CI verde só muda a sala se apagar um alarme (aí vira festa).
        if (!slots.alarm || slots.alarm.until <= now) return false;
        delete slots.alarm;
        slots.party = make('party', ev, PARTY_MS);
        break;
      default:
        return false;
    }
    this.rooms.set(roomId, slots);
    return true;
  }

  /** Efeito visível da sala agora (a festa na frente do alarme), ou undefined. */
  get(roomId: string, now: number): RoomEffect | undefined {
    const slots = this.rooms.get(roomId);
    if (!slots) return undefined;
    if (slots.party && slots.party.until > now) return slots.party;
    if (slots.alarm && slots.alarm.until > now) return slots.alarm;
    return undefined;
  }

  /** Esquece os efeitos vencidos; true se algum saiu (o snapshot precisa ser refeito). */
  prune(now: number): boolean {
    let changed = false;
    for (const [id, slots] of this.rooms) {
      if (slots.party && slots.party.until <= now) {
        delete slots.party;
        changed = true;
      }
      if (slots.alarm && slots.alarm.until <= now) {
        delete slots.alarm;
        changed = true;
      }
      if (!slots.party && !slots.alarm) this.rooms.delete(id);
    }
    return changed;
  }
}
