import type { AgentStats, TerminalEntry } from '../../shared/types';
import { productCopy } from '../../shared/copy';
import { contentText, object, resultTerminal, safeText, string, timestamp, toolTerminal, usageStats } from './mapping';

export const PI_HISTORY_DAYS = 7;
export const PI_HISTORY_LIMIT = 150;
export const PI_TERMINAL_LIMIT = 500;
export const PI_TERMINAL_BYTES = 4 * 1024 * 1024;

type Entry = Record<string, unknown> & { id: string; parentId: string | null; type: string };

export interface PiParsedSession {
  sessionId: string;
  cwd: string;
  startedAt: number;
  lastAt: number;
  title?: string;
  model?: string;
  stats: Partial<AgentStats>;
  entries: TerminalEntry[];
  truncated: boolean;
  /** Cold disk history is never proof that the Pi process is still running. */
  historical: true;
}

/** Pi's append-only file has alternate branches; only the newest leaf's ancestry is the active conversation. */
export function pickActivePiBranch(entries: readonly Entry[], leafId?: string): Entry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const leaf = leafId ? byId.get(leafId) : entries.at(-1);
  const branch: Entry[] = [];
  const seen = new Set<string>();
  let current = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    branch.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return branch.reverse();
}

function limitedEntries(entries: TerminalEntry[], maxEntries: number, maxBytes: number): { entries: TerminalEntry[]; truncated: boolean } {
  const kept: TerminalEntry[] = [];
  let bytes = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(JSON.stringify(entries[i]), 'utf8');
    if (kept.length >= maxEntries || bytes + size > maxBytes) break;
    kept.push(entries[i]);
    bytes += size;
  }
  return { entries: kept.reverse(), truncated: kept.length < entries.length };
}

export function parsePiSessionJsonl(text: string, options: { maxEntries?: number; maxBytes?: number; leafId?: string } = {}): PiParsedSession | undefined {
  const lines = text.split('\n');
  let header: Record<string, unknown> | undefined;
  try { header = object(JSON.parse(lines[0] || 'null')); } catch { return undefined; }
  const sessionId = string(header?.id);
  if (header?.type !== 'session' || !sessionId) return undefined;
  const cwd = string(header.cwd) ?? '';
  const startedAt = timestamp(header.timestamp, 0);
  const all: Entry[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    try {
      const entry = object(JSON.parse(line));
      if (!entry || !string(entry.id) || typeof entry.type !== 'string') continue;
      if (entry.parentId !== null && typeof entry.parentId !== 'string') continue;
      all.push(entry as Entry);
    } catch { /* Last line can be partial while Pi writes it. */ }
  }
  if (options.leafId && !all.some((entry) => entry.id === options.leafId)) return undefined;
  const branch = pickActivePiBranch(all, options.leafId);
  const out: TerminalEntry[] = [];
  const stats: Partial<AgentStats> = { toolCalls: 0, tokensIn: 0, tokensOut: 0 };
  let title: string | undefined;
  let model: string | undefined;
  let firstPrompt: string | undefined;
  let lastAt = startedAt;
  const addUsage = (value: unknown): void => {
    const usage = usageStats({ usage: value });
    if (!usage) return;
    stats.tokensIn = (stats.tokensIn ?? 0) + (usage.tokensIn ?? 0);
    stats.tokensOut = (stats.tokensOut ?? 0) + (usage.tokensOut ?? 0);
    if (usage.costUSD !== undefined) stats.costUSD = (stats.costUSD ?? 0) + usage.costUSD;
  };
  for (const entry of branch) {
    const at = timestamp(entry.timestamp, lastAt);
    lastAt = Math.max(lastAt, at);
    if (entry.type === 'session_info') { title = string(entry.name); continue; }
    if (entry.type === 'model_change') { model = string(entry.modelId) ?? model; continue; }
    if (entry.type === 'usage') { addUsage(entry.usage); continue; }
    if (entry.type === 'compaction') {
      addUsage(entry.usage);
      out.push({ kind: 'system', id: `compaction:${entry.id}`, at, ...productCopy('Conversa compactada') });
      continue;
    }
    if (entry.type === 'branch_summary') { addUsage(entry.usage); continue; }
    if (entry.type !== 'message') continue;
    const message = object(entry.message);
    if (!message) continue;
    const messageAt = timestamp(message.timestamp, at);
    if (message.role === 'user') {
      const raw = contentText(message.content);
      if (!firstPrompt && raw.trim()) firstPrompt = raw.trim().split('\n')[0];
      out.push({ kind: 'user', id: `user:${entry.id}`, at: messageAt, text: safeText(raw) });
    } else if (message.role === 'assistant') {
      model = string(message.model) ?? model;
      const blocks = Array.isArray(message.content) ? message.content : [];
      blocks.forEach((raw, index) => {
        const block = object(raw);
        if (!block) return;
        if (block.type === 'text') out.push({ kind: 'assistant', id: `text:${entry.id}:${index}`, at: messageAt, text: safeText(block.text) });
        else if (block.type === 'thinking') out.push({ kind: 'thinking', id: `thinking:${entry.id}:${index}`, at: messageAt, text: safeText(block.thinking ?? block.text) });
        else if (block.type === 'toolCall') {
          const callId = string(block.id);
          const toolName = string(block.name);
          if (callId && toolName) { out.push(toolTerminal(callId, toolName, block.arguments, messageAt)); stats.toolCalls = (stats.toolCalls ?? 0) + 1; }
        }
      });
      addUsage(message.usage);
    } else if (message.role === 'toolResult') {
      const callId = string(message.toolCallId);
      if (callId) out.push(resultTerminal(callId, message, message.isError === true, messageAt));
    }
  }
  const bounded = limitedEntries(out, options.maxEntries ?? PI_TERMINAL_LIMIT, options.maxBytes ?? PI_TERMINAL_BYTES);
  return { sessionId, cwd, startedAt, lastAt, title: title ?? (firstPrompt ? safeText(firstPrompt, 120) : undefined), model, stats, ...bounded, historical: true };
}
