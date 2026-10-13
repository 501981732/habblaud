// Utilitários de DOM da interface: criação de elementos, atualizações mínimas e listas com chave.

type Child = Node | string | null | undefined | false;
type Props = {
  class?: string;
  text?: string;
  /** Render the value verbatim (transcripts, paths, user input, commands, model/tool output). */
  rawText?: boolean;
  /** Preserve dynamic names, paths, and other non-product titles verbatim. */
  rawTitle?: boolean;
  /** Attribute names that must remain verbatim, including user supplied or computed values. */
  rawAttrs?: string[];
  title?: string;
  style?: string;
  role?: string;
  tabIndex?: number;
  hidden?: boolean;
  type?: string;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
  /** Atributos arbitrários (aria-*, data-*, ...). */
  attrs?: Record<string, string | number | boolean | undefined>;
};

import { t } from '../../../shared/i18n';

const TEXT_SOURCE = '__habblaudI18nSource';
type LocalizableNode = Text & { [TEXT_SOURCE]?: string };

/** Cria um elemento com propriedades e filhos. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) {
    if (props.rawText) el.textContent = props.text;
    else {
      el.dataset.i18nText = props.text;
      el.textContent = t(props.text);
    }
  }
  if (props.title) {
    if (props.rawTitle) el.title = props.title;
    else {
      el.dataset.i18nTitle = props.title;
      el.title = t(props.title);
    }
  }
  if (props.style) el.setAttribute('style', props.style);
  if (props.role) el.setAttribute('role', props.role);
  if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
  if (props.hidden) el.hidden = true;
  if (props.type) el.setAttribute('type', props.type);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) if (v !== undefined && v !== false) {
    const value = v === true ? '' : String(v);
    if (typeof v === 'string' && !props.rawAttrs?.includes(k) && ['aria-label', 'aria-description', 'placeholder', 'alt'].includes(k)) {
      el.dataset[`i18n${k.replace(/(^|-)(.)/g, (_, _dash, c) => c.toUpperCase())}`] = v;
      el.setAttribute(k, t(v));
    } else el.setAttribute(k, value);
  }
  if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) {
    if (typeof c === 'string') {
      const node = document.createTextNode(props.rawText ? c : t(c)) as LocalizableNode;
      if (!props.rawText) node[TEXT_SOURCE] = c;
      el.append(node);
    } else el.append(c);
  }
  return el;
}

/** Botão com ícone e rótulo acessível. */
export function iconButton(icon: string, label: string, onClick: (ev: MouseEvent) => void, extraClass = ''): HTMLButtonElement {
  const b = h('button', { class: `ui-icon-btn ${extraClass}`.trim(), type: 'button', title: label, attrs: { 'aria-label': label }, on: { click: onClick } });
  b.innerHTML = icon;
  return b;
}

/** Atualiza texto de produto e acompanha a origem para trocar o idioma sem reconstruir a tela. */
export function setText(el: Element, text: string): void {
  setProductText(el, text);
}

/** Update generated product copy. */
export function setProductText(el: Element, source: string): void {
  if (el instanceof HTMLElement) el.dataset.i18nText = source;
  const value = t(source);
  if (el.textContent !== value) el.textContent = value;
}

/** Update data from sessions, users, commands and tool output without running it through the product dictionary. */
export function setRawText(el: Element, text: string): void {
  if (el instanceof HTMLElement) delete el.dataset.i18nText;
  if (el.textContent !== text) el.textContent = text;
}

/** Re-render tracked product copy after a language change. Raw text is never registered here. */
export function refreshLocalizableDom(root: ParentNode): void {
  const elements = root.querySelectorAll<HTMLElement>('[data-i18n-text], [data-i18n-title], [data-i18n-aria-label], [data-i18n-aria-description], [data-i18n-placeholder], [data-i18n-alt]');
  for (const el of elements) {
    if (el.dataset.i18nText !== undefined) el.textContent = t(el.dataset.i18nText);
    if (el.dataset.i18nTitle !== undefined) el.title = t(el.dataset.i18nTitle);
    for (const [dataKey, attr] of [['i18nAriaLabel', 'aria-label'], ['i18nAriaDescription', 'aria-description'], ['i18nPlaceholder', 'placeholder'], ['i18nAlt', 'alt']]) {
      const source = el.dataset[dataKey];
      if (source !== undefined) el.setAttribute(attr, t(source));
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as LocalizableNode | null; node; node = walker.nextNode() as LocalizableNode | null) {
    if (node[TEXT_SOURCE] !== undefined) node.textContent = t(node[TEXT_SOURCE]);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-rich]')) renderRichText(el, el.dataset.i18nRich!);
}

/** Product help with inline commands, retaining its source for language switching. */
export function richProductText(source: string): HTMLElement {
  const el = document.createElement('span');
  el.dataset.i18nRich = source;
  renderRichText(el, source);
  return el;
}

function renderRichText(el: HTMLElement, source: string): void {
  el.replaceChildren(...t(source).split('`').map((part, i) => {
    if (i % 2 === 0) return document.createTextNode(part);
    const code = document.createElement('code');
    code.className = 'ui-usage-setup__inline';
    code.textContent = part;
    return code;
  }));
}

export function setAttr(el: Element, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function setTitle(el: HTMLElement, title: string): void {
  el.dataset.i18nTitle = title;
  const value = t(title);
  if (el.title !== value) el.title = value;
}

/** Update a dynamic title verbatim (names, paths, transcript or tool output). */
export function setRawTitle(el: HTMLElement, title: string): void {
  delete el.dataset.i18nTitle;
  if (el.title !== title) el.title = title;
}

export function setStyleVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** Ajusta a classe de um "grupo" (ex.: status-*) trocando a anterior pela nova. */
export function setVariant(el: HTMLElement, prefix: string, value: string): void {
  const key = `__variant_${prefix}`;
  const rec = el as unknown as Record<string, string | undefined>;
  const prev = rec[key];
  if (prev === value) return;
  if (prev) el.classList.remove(`${prefix}${prev}`);
  el.classList.add(`${prefix}${value}`);
  rec[key] = value;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Anima a saída (fade + colapso de altura) e remove o elemento. */
export function animateOut(el: HTMLElement, done: () => void, ms = 260): void {
  if (prefersReducedMotion() || typeof el.animate !== 'function' || !el.isConnected) {
    done();
    return;
  }
  const height = el.offsetHeight;
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  const anim = el.animate(
    [
      { opacity: 1, height: `${height}px`, transform: 'translateX(0)' },
      { opacity: 0, height: `${height}px`, transform: 'translateX(-10px)', offset: 0.55 },
      { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'translateX(-10px)' },
    ],
    { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
  );
  anim.onfinish = done;
  anim.oncancel = done;
}

/** Marca um elemento recém-criado para a animação de entrada (classe removida ao terminar). */
export function markEntering(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  el.classList.add('is-entering');
  el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
}

export interface KeyedListOptions<T, E extends HTMLElement> {
  key(item: T): string;
  create(item: T): E;
  update(el: E, item: T): void;
  /** Anima entradas/saídas (padrão: true). */
  animate?: boolean;
}

/**
 * Lista reconciliada por chave: cria, atualiza, reordena e remove (com animação) só o que mudou.
 * Elementos que estão saindo permanecem no lugar até a animação terminar.
 */
export class KeyedList<T, E extends HTMLElement = HTMLElement> {
  private nodes = new Map<string, E>();
  private leaving = new Map<string, E>();
  private initialized = false;

  constructor(
    readonly container: HTMLElement,
    private opts: KeyedListOptions<T, E>,
  ) {}

  get size(): number {
    return this.nodes.size;
  }

  get(key: string): E | undefined {
    return this.nodes.get(key);
  }

  keys(): IterableIterator<string> {
    return this.nodes.keys();
  }

  sync(items: readonly T[]): void {
    const animate = this.opts.animate !== false && this.initialized;
    const seen = new Set<string>();
    const next = new Set(items.map((item) => this.opts.key(item)));
    let cursor: ChildNode | null = this.container.firstChild;
    // Pula nós que estão saindo ou que vão sair: eles ficam onde estão e não "empurram" os demais.
    const skipStale = () => {
      while (cursor && (this.isLeaving(cursor) || !next.has((cursor as HTMLElement).dataset?.key ?? ''))) cursor = cursor.nextSibling;
    };
    for (const item of items) {
      const k = this.opts.key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      let el = this.nodes.get(k);
      if (!el) {
        const old = this.leaving.get(k);
        if (old) {
          // Voltou antes de terminar de sair: descarta o antigo e recria.
          old.getAnimations?.().forEach((a) => a.cancel());
          old.remove();
          this.leaving.delete(k);
        }
        el = this.opts.create(item);
        el.dataset.key = k;
        this.nodes.set(k, el);
        if (animate) markEntering(el);
      }
      this.opts.update(el, item);
      skipStale();
      if (cursor === el) cursor = el.nextSibling;
      else this.container.insertBefore(el, cursor);
    }
    for (const [k, el] of this.nodes) {
      if (seen.has(k)) continue;
      this.nodes.delete(k);
      if (!animate) {
        el.remove();
        continue;
      }
      this.leaving.set(k, el);
      el.classList.add('is-leaving');
      animateOut(el, () => {
        if (this.leaving.get(k) === el) this.leaving.delete(k);
        el.remove();
      });
    }
    this.initialized = true;
  }

  clear(): void {
    for (const el of this.nodes.values()) el.remove();
    for (const el of this.leaving.values()) el.remove();
    this.nodes.clear();
    this.leaving.clear();
    // O próximo preenchimento é "do zero": sem animação de entrada item a item.
    this.initialized = false;
  }

  private isLeaving(node: ChildNode): boolean {
    return node instanceof HTMLElement && node.classList.contains('is-leaving');
  }
}

/** Copia texto para a área de transferência, com alternativa para contextos sem Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;pointer-events:none' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
