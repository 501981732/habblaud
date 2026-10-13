import { basename, maskSecrets, truncate } from '../../shared/activity';
import { productCopy } from '../../shared/copy';
import type { Activity, AgentStats, TerminalEntry } from '../../shared/types';

type RecordLike = Record<string, unknown>;
export function object(value: unknown): RecordLike | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : undefined;
}
export function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
export function timestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Content shown outside Pi is redacted before truncation; raw session text stays with Pi. */
export function safeText(value: unknown, max = 4000): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return truncate(maskSecrets(raw.slice(0, Math.max(max * 8, 8192))), max);
}

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    const block = object(item);
    if (!block) return '';
    if (block.type === 'image') return '📷';
    return string(block.text) ?? '';
  }).filter(Boolean).join('\n');
}

export function usageStats(message: unknown): Partial<AgentStats> | undefined {
  const usage = object(object(message)?.usage);
  if (!usage) return undefined;
  const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const cost = object(usage.cost);
  const result: Partial<AgentStats> = {
    tokensIn: finite(usage.input) + finite(usage.cacheRead) + finite(usage.cacheWrite),
    tokensOut: finite(usage.output),
  };
  if (typeof cost?.total === 'number' && Number.isFinite(cost.total)) result.costUSD = cost.total;
  return result;
}

export function toolActivity(sessionId: string, callId: string, toolName: string, args: unknown, at: number): Activity {
  const input = object(args);
  const path = string(input?.path) ?? string(input?.file_path) ?? string(input?.filePath);
  const command = string(input?.command);
  const name = toolName.toLowerCase();
  let kind: Activity['kind'] = 'other';
  let icon = '🔧';
  let copy = productCopy('Usando {ferramenta}', { ferramenta: safeText(toolName, 80) });
  if (name === 'read' || name === 'ls') { kind = 'read'; icon = '📖'; copy = path ? productCopy('Lendo {arquivo}', { arquivo: safeText(basename(path), 80) }) : productCopy('Lendo arquivo'); }
  else if (name === 'edit') { kind = 'edit'; icon = '✏️'; copy = path ? productCopy('Editando {arquivo}', { arquivo: safeText(basename(path), 80) }) : productCopy('Editando arquivo'); }
  else if (name === 'write') { kind = 'write'; icon = '📝'; copy = path ? productCopy('Escrevendo {arquivo}', { arquivo: safeText(basename(path), 80) }) : productCopy('Escrevendo arquivo'); }
  else if (name === 'grep' || name === 'find') { kind = 'search'; icon = '🔎'; copy = productCopy('Procurando arquivos'); }
  else if (name === 'bash' || name === 'powershell') { kind = 'run'; icon = '💻'; copy = command ? productCopy('Executando {comando}', { comando: safeText(truncate(command, 32), 40) }) : productCopy('Executando um comando'); }
  else if (name.startsWith('mcp__')) { kind = 'mcp'; icon = '🔌'; copy = productCopy('Usando MCP: {ferramenta}', { ferramenta: safeText(toolName, 80) }); }
  return { id: `${sessionId}:tool:${callId}`, kind, icon, text: safeText(copy.text, 46), i18n: copy.i18n,
    detail: safeText(command ?? path ?? args, 300), tool: toolName, at };
}

export function toolTerminal(callId: string, toolName: string, args: unknown, at: number): TerminalEntry {
  const input = object(args);
  const command = string(input?.command);
  const path = string(input?.path) ?? string(input?.file_path) ?? string(input?.filePath);
  return {
    kind: 'tool', id: `tool:${callId}`, at, tool: toolName,
    title: safeText(`${toolName}(${command ?? path ?? ''})`, 100),
    input: safeText(command ?? path ?? args, 3000),
    inputKind: command ? 'command' : path ? 'text' : 'json',
  };
}

export function resultTerminal(callId: string, result: unknown, error: boolean, at: number): TerminalEntry {
  const r = object(result);
  const raw = r ? contentText(r.content) || string(r.structuredContent) || JSON.stringify(r.structuredContent ?? '') : contentText(result);
  return { kind: 'result', id: `result:${callId}`, at, toolUseId: `tool:${callId}`, text: safeText(raw, 4000), error, truncated: raw.length > 4000 };
}
