import { describe, expect, it } from 'vitest';
import { parsePiSessionJsonl, pickActivePiBranch } from './history';

const header = { type: 'session', version: 3, id: 'pi-s1', timestamp: '2026-10-13T01:00:00Z', cwd: '/repo' };
const entry = (id: string, parentId: string | null, type: string, rest: object = {}) => ({ type, id, parentId, timestamp: '2026-10-13T01:01:00Z', ...rest });
const lines = (...entries: object[]) => [JSON.stringify(header), ...entries.map((x) => JSON.stringify(x))].join('\n');

describe('Pi tree history', () => {
  it('uses only the active branch and supports an explicit leaf', () => {
    const base = entry('a', null, 'message', { message: { role: 'user', content: '开始', timestamp: 1 } });
    const abandoned = entry('b', 'a', 'message', { message: { role: 'assistant', content: [{ type: 'text', text: '旧分支' }], timestamp: 2 } });
    const current = entry('c', 'a', 'message', { message: { role: 'assistant', content: [{ type: 'text', text: '新分支' }], timestamp: 3 } });
    const text = lines(base, abandoned, current);
    expect(pickActivePiBranch([base, abandoned, current]).map((x) => x.id)).toEqual(['a', 'c']);
    expect(parsePiSessionJsonl(text)?.entries.map((x) => x.kind === 'assistant' ? x.text : '')).toContain('新分支');
    expect(parsePiSessionJsonl(text)?.entries.map((x) => x.kind === 'assistant' ? x.text : '')).not.toContain('旧分支');
    expect(parsePiSessionJsonl(text, { leafId: 'b' })?.entries.map((x) => x.kind === 'assistant' ? x.text : '')).toContain('旧分支');
    expect(parsePiSessionJsonl(text, { leafId: 'missing' })).toBeUndefined();
  });

  it('projects tool calls/results, usage and titles and bounds terminal output', () => {
    const text = lines(
      entry('a', null, 'message', { message: { role: 'user', content: '运行测试', timestamp: 1 } }),
      entry('b', 'a', 'message', { message: { role: 'assistant', model: 'x', content: [
        { type: 'text', text: '正在检查' }, { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'npm test' } },
      ], usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: { total: 0.01 } }, timestamp: 2 } }),
      entry('c', 'b', 'message', { message: { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: '通过' }], isError: false, timestamp: 3 } }),
      entry('d', 'c', 'session_info', { name: '测试任务' }),
    );
    const parsed = parsePiSessionJsonl(text)!;
    expect(parsed).toMatchObject({ sessionId: 'pi-s1', cwd: '/repo', model: 'x', title: '测试任务', historical: true });
    expect(parsed.stats).toMatchObject({ toolCalls: 1, tokensIn: 11, tokensOut: 3, costUSD: 0.01 });
    expect(parsed.entries.map((x) => x.kind)).toEqual(['user', 'assistant', 'tool', 'result']);
    expect(parsed.entries[3]).toMatchObject({ toolUseId: 'tool:t1', text: '通过' });
    const limited = parsePiSessionJsonl(text, { maxEntries: 2 })!;
    expect(limited.entries).toHaveLength(2);
    expect(limited.truncated).toBe(true);
  });

  it('ignores a partial final JSONL line', () => {
    expect(parsePiSessionJsonl(lines(entry('a', null, 'message', { message: { role: 'user', content: '保留', timestamp: 1 } })) + '\n{"type":')?.entries).toHaveLength(1);
  });

  it('includes branch-local usage and compaction cost without counting abandoned branches', () => {
    const usage = { input: 2, output: 3, cacheRead: 1, cacheWrite: 0, cost: { total: 0.02 } };
    const parsed = parsePiSessionJsonl(lines(
      entry('a', null, 'message', { message: { role: 'user', content: '开始' } }),
      entry('old', 'a', 'usage', { usage: { ...usage, input: 100 } }),
      entry('b', 'a', 'usage', { usage }),
      entry('c', 'b', 'compaction', { usage, summary: '摘要' }),
    ));
    expect(parsed?.stats).toMatchObject({ tokensIn: 6, tokensOut: 6, costUSD: 0.04 });
    expect(parsed?.entries.at(-1)).toMatchObject({ kind: 'system', text: 'Conversa compactada', i18n: { key: 'Conversa compactada' } });
  });

  it('uses the latest session name, including a cleared name', () => {
    const parsed = parsePiSessionJsonl(lines(
      entry('a', null, 'message', { message: { role: 'user', content: '原始问题' } }),
      entry('b', 'a', 'session_info', { name: '旧标题' }),
      entry('c', 'b', 'session_info'),
    ));
    expect(parsed?.title).toBe('原始问题');
  });
});
