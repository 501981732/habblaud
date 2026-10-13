// Pedidos de permissão (e perguntas) fictícios do modo demonstração (responder pelo escritório sem sessões reais),
// do Claude Code e do Codex (só aprovação, sem "sempre permitir").
// Puro: usado pelo simulador no servidor (HABBLAUD_DEMO=1) e no navegador (?mock=1).
import type { PermissionRequestInfo } from '../types';
import { describeTool } from '../activity';
import { productCopy } from '../copy';

export interface DemoPermissionSource {
  /** Arquivos do projeto fictício (relativos à raiz). */
  files: readonly string[];
  /** Comandos de terminal do projeto fictício. */
  commands: readonly string[];
}

/** Quanto tempo o "hook" fictício espera antes de devolver o pedido ao terminal. */
export const DEMO_PERMISSION_MS = 5 * 60_000;

/** Linhas de um diff fictício, no formato do terminal ("- antiga" / "+ nova"). */
const DEMO_DIFFS: readonly string[][] = [
  ['- const total = items.reduce((s, i) => s + i.price, 0);', '+ const total = items.reduce((s, i) => s + i.price * i.qty, 0);', '+ if (total < 0) throw new Error("total inválido");'],
  ['- export const TIMEOUT = 5_000;', '+ export const TIMEOUT = 15_000;'],
  ['- <button onClick={save}>Salvar</button>', '+ <button onClick={save} disabled={saving}>', '+   {saving ? "Salvando…" : "Salvar"}', '+ </button>'],
];

interface DemoQuestion {
  header: string;
  question: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

/** Perguntas fictícias do AskUserQuestion: uma de escolha única e uma em que dá para marcar várias. */
const DEMO_QUESTIONS: readonly DemoQuestion[][] = [
  [
    {
      header: 'Cache',
      question: '登录会话缓存应该存在哪里？',
      options: [
        { label: 'Redis', description: '速度快，项目的 Docker Compose 已经包含它' },
        { label: 'PostgreSQL', description: '在现有数据库中增加一张表' },
        { label: '内存', description: '最简单，但服务重启后会丢失' },
      ],
    },
    {
      header: '测试',
      question: '提交前需要运行哪些测试？',
      multiSelect: true,
      options: [
        { label: '单元测试', description: '运行 npm test，约 40 秒' },
        { label: '集成测试', description: '在 Docker 中启动测试数据库' },
        { label: 'E2E', description: '在浏览器运行 Playwright，约 5 分钟' },
      ],
    },
  ],
  [
    {
      header: '网络错误',
      question: '结算时网络失败要如何处理？',
      options: [
        { label: '重试', description: '最多重试 3 次，逐步增加等待时间' },
        { label: '提示用户', description: '显示消息和重试按钮' },
        { label: '暂存后发送', description: '先放入本地队列，恢复网络后发送' },
      ],
    },
    {
      header: '页面',
      question: '这次修改应应用在哪些页面？',
      multiSelect: true,
      options: [{ label: '购物车' }, { label: '付款' }, { label: '订单确认' }],
    },
  ],
];

/** As perguntas em texto, como o terminal mostra os argumentos do AskUserQuestion. */
function questionsText(qs: readonly DemoQuestion[]): string {
  return qs.map((q) => [q.question, ...q.options.map((o) => `  - ${o.label}${o.description ? `: ${o.description}` : ''}`)].join('\n')).join('\n\n');
}

/** Tipo de pedido fictício: permissão (comando, edição, página) ou pergunta do AskUserQuestion. */
export type DemoPermissionKind = 'permission' | 'question';

/**
 * Um pedido fictício (comando no terminal, edição de arquivo, leitura de página ou pergunta do AskUserQuestion),
 * com a sugestão de "sempre permitir" que o Claude Code costuma oferecer para comandos. `kind` força o tipo
 * (testes e capturas de tela); sem ele, é sorteado.
 */
export function demoPermission(id: string, src: DemoPermissionSource, rng: () => number, now: number, kind?: DemoPermissionKind): PermissionRequestInfo {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const roll = kind === 'question' ? 1 : kind === 'permission' ? rng() * 0.9 : rng();
  const base = { id, createdAt: now, expiresAt: now + DEMO_PERMISSION_MS };
  if (roll >= 0.9) {
    const qs = pick(DEMO_QUESTIONS);
    const d = describeTool('AskUserQuestion', { questions: qs });
    return { ...base, tool: 'AskUserQuestion', title: `AskUserQuestion(${qs[0].question})`, text: d.text, i18n: d.i18n, icon: d.icon, input: questionsText(qs), inputKind: 'text', questions: d.questions };
  }
  if (roll < 0.55 && src.commands.length) {
    const command = pick(src.commands);
    const d = describeTool('Bash', { command });
    const prefix = command.split(/\s+/).slice(0, 2).join(' ');
    return {
      ...base,
      tool: 'Bash',
      title: `Bash(${command})`,
      text: d.text,
      i18n: d.i18n,
      icon: d.icon,
      input: command,
      inputKind: 'command',
      suggestions: [{ index: 0, rules: [`Bash(${prefix}:*)`], destination: 'localSettings' }],
    };
  }
  if (roll < 0.8 && src.files.length) {
    const file = pick(src.files);
    const d = describeTool('Edit', { file_path: file });
    return { ...base, tool: 'Edit', title: `Edit(${file})`, text: d.text, i18n: d.i18n, icon: d.icon, input: pick(DEMO_DIFFS).join('\n'), inputKind: 'diff' };
  }
  const url = 'https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API';
  const d = describeTool('WebFetch', { url });
  return {
    ...base,
    tool: 'WebFetch',
    title: `WebFetch(${url})`,
    text: d.text,
    i18n: d.i18n,
    icon: d.icon,
    input: '总结如何使用 fetch 处理网络错误',
    inputKind: 'text',
    suggestions: [{ index: 0, rules: ['WebFetch(domain:developer.mozilla.org)'], destination: 'localSettings' }],
  };
}

/**
 * Quanto o "hook" do Codex espera pela decisão do escritório (HABBLAUD_CODEX_PERMISSION_TIMEOUT, padrão 25 s). Depois
 * disso o Codex segue o fluxo normal e a aprovação aparece no terminal.
 */
export const DEMO_CODEX_PERMISSION_MS = 25_000;

/** Destinos de rede fictícios (o Codex pede acesso à rede como um Bash com a descrição "network-access <alvo>"). */
const DEMO_NETWORK: ReadonlyArray<[host: string, command: string]> = [
  ['registry.npmjs.org', 'npm install'],
  ['pypi.org', 'pip install -r requirements.txt'],
  ['api.github.com', 'gh pr view --json title'],
];

/** O diff de um apply_patch no formato do Codex (Begin/End Patch, linhas "-antiga" e "+nova"). */
export function demoPatchText(file: string, lines: readonly string[], add = false): string {
  const body = lines.map((l) => (l.startsWith('- ') ? `-${l.slice(2)}` : l.startsWith('+ ') ? `+${l.slice(2)}` : add ? `+${l}` : ` ${l}`));
  return ['*** Begin Patch', `*** ${add ? 'Add' : 'Update'} File: ${file}`, ...(add ? [] : ['@@']), ...body, '*** End Patch'].join('\n');
}

/**
 * Um pedido de aprovação fictício do Codex (hook PermissionRequest): comando no terminal, apply_patch ou acesso à
 * rede. Sem sugestões de "sempre permitir" (o Codex não as aceita pelo hook) e nunca uma pergunta; o prazo é curto.
 */
export function demoCodexPermission(id: string, src: DemoPermissionSource, rng: () => number, now: number): PermissionRequestInfo {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const roll = rng();
  const base = { id, provider: 'codex' as const, createdAt: now, expiresAt: now + DEMO_CODEX_PERMISSION_MS };
  if (roll < 0.3 && src.files.length) {
    const file = pick(src.files);
    const d = describeTool('Edit', { file_path: file });
    return { ...base, tool: 'apply_patch', title: `apply_patch(${file})`, text: d.text, i18n: d.i18n, icon: d.icon, input: demoPatchText(file, pick(DEMO_DIFFS)), inputKind: 'diff' };
  }
  if (roll < 0.45) {
    const [host, command] = pick(DEMO_NETWORK);
    return { ...base, tool: 'Bash', title: `Bash(${command})`, ...productCopy('Acesso à rede: {dominio}', { dominio: host }), icon: '🌐', input: command, inputKind: 'command' };
  }
  const command = src.commands.length ? pick(src.commands) : 'npm test';
  const d = describeTool('Bash', { command });
  return { ...base, tool: 'Bash', title: `Bash(${command})`, text: d.text, i18n: d.i18n, icon: d.icon, input: command, inputKind: 'command' };
}
