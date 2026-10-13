import { describe, expect, it } from 'vitest';
import { serverMessages } from '../../shared/i18n/server';
import { DshProjector, type DshEvent, type DshHeader } from './mapping';

const header: DshHeader = { id: 's1', createdAt: 1, cwd: '/tmp/work' };
const event = (seq: number, type: string, data: unknown): DshEvent => ({ seq, type, time: seq * 100, data });

describe('DSH native projection', () => {
  it('replays once, bounds recent history, and does not put an offline session in the office', () => {
    const projector = new DshProjector('dsh:test');
    const history = Array.from({ length: 40 }, (_, seq) => event(seq, 'turn/end', { turn: seq, reason: 'completed' }));
    const out = projector.bootstrap(header, history, false);
    expect(out[0]).toMatchObject({ type: 'session', historical: true, session: { status: 'offline' } });
    expect(out.filter((item) => item.type === 'activity')).toHaveLength(30);
    expect(projector.live(header, history[39])).toEqual([]);
    expect(projector.live(header, event(40, 'turn/start', { turn: 41 }))).toMatchObject([
      { type: 'status', status: 'working' },
    ]);
  });

  it('keeps concurrent tool calls paired by callId and accumulates authoritative usage only', () => {
    const projector = new DshProjector('dsh:test');
    const call = (seq: number, callId: string, name: string) => event(seq, 'tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' });
    const result = (seq: number, callId: string, isError = false) => event(seq, 'tool/result', {
      turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, isError,
        content: [{ type: 'text', text: isError ? 'failed' : 'ok' }] },
    });
    projector.live(header, call(0, 'a', 'Bash'));
    projector.live(header, call(1, 'b', 'Read'));
    const b = projector.live(header, result(2, 'b'));
    const a = projector.live(header, result(3, 'a', true));
    expect(b.find((item) => item.type === 'terminal')).toMatchObject({ entries: [{ kind: 'result', toolUseId: 'b' }] });
    expect(a.find((item) => item.type === 'terminal')).toMatchObject({ entries: [{ kind: 'result', toolUseId: 'a', error: true }] });
    projector.live(header, event(4, 'assistant/message', { message: { source: { kind: 'model', model: 'glm' },
      content: [{ type: 'text', text: 'done' }] }, usage: { inputTokens: 4, cacheReadTokens: 2, outputTokens: 3 } }));
    expect(projector.get('s1')?.stats).toMatchObject({ toolCalls: 2, tokensIn: 6, tokensOut: 3 });
    expect(projector.get('s1')?.model).toBe('glm');
  });

  it('labels only product activities and generated result fallbacks', () => {
    const projector = new DshProjector('dsh:test');
    const prompt = projector.live(header, event(0, 'user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Respondendo is my exact prompt' }],
    }));
    expect(prompt.find((item) => item.type === 'activity')).toMatchObject({ activity: {
      text: 'Nova instrução', i18n: { key: 'Nova instrução' },
    } });
    expect(prompt.find((item) => item.type === 'terminal')).toMatchObject({ entries: [
      { kind: 'user', text: 'Respondendo is my exact prompt' },
    ] });
    const call = projector.live(header, event(1, 'tool/call', { callId: 'tool-1', name: 'Bash', arguments: '{"command":"printf ok"}' }));
    const activity = call.find((item) => item.type === 'activity');
    expect(activity).toMatchObject({ activity: { i18n: { key: 'Executando {ferramenta}', params: { ferramenta: 'Bash' } } } });
    if (activity?.type !== 'activity') throw new Error('missing activity');
    expect(serverMessages[activity.activity.i18n!.key]).toBe('运行 {ferramenta}');
    const result = projector.live(header, event(2, 'tool/result', { message: { role: 'tool', toolCallId: 'tool-1', content: [] } }));
    expect(result.find((item) => item.type === 'terminal')).toMatchObject({ entries: [
      { kind: 'result', text: 'Concluído', resultI18n: { key: 'Concluído' } },
    ] });
    const wait = projector.status(header.id, 'waiting', undefined, 'aprovar uma permissão');
    expect(wait).toMatchObject({ waitingFor: 'aprovar uma permissão', waitingForI18n: { key: 'aprovar uma permissão' } });
  });

  it('has a Chinese template for each native tool activity category', () => {
    const projector = new DshProjector('dsh:test');
    const names = ['SpawnAgent', 'RunTests', 'GitStatus', 'EditFile', 'ReadFile', 'Search', 'Playwright', 'WebFetch', 'Bash', 'McpTool', 'CustomTool'];
    names.forEach((name, seq) => {
      const activity = projector.live(header, event(seq, 'tool/call', { callId: `call-${seq}`, name }))
        .find((item) => item.type === 'activity');
      if (activity?.type !== 'activity') throw new Error(`missing activity for ${name}`);
      expect(serverMessages[activity.activity.i18n!.key], name).toBeTruthy();
    });
  });

  it('uses explicit subagent origin for parent linkage; a normal fork stays top level', () => {
    const projector = new DshProjector('dsh:test');
    const child = projector.session({ ...header, id: 'child', origin: 'subagent', parentSession: 'parent' });
    const fork = projector.session({ ...header, id: 'fork', parentSession: 'parent' });
    const parent = projector.session({ ...header, id: 'parent' });
    expect(child).toMatchObject({ session: { parentSessionId: 'parent', role: 'Subagent' } });
    expect(fork).not.toMatchObject({ session: { parentSessionId: 'parent' } });
    expect(parent).toMatchObject({ session: { stats: { subagents: 1 } } });
  });

  it('redacts terminal text and retains only the last 500 entries', () => {
    const projector = new DshProjector('dsh:test');
    const history = Array.from({ length: 510 }, (_, seq) => event(seq, 'user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'API_KEY=secret-value' }],
    }));
    const out = projector.bootstrap(header, history, false);
    const terminal = out.find((item) => item.type === 'terminal');
    expect(terminal).toMatchObject({ truncated: true });
    if (terminal?.type !== 'terminal') throw new Error('missing terminal');
    expect(terminal.entries).toHaveLength(500);
    expect(JSON.stringify(terminal.entries)).not.toContain('secret-value');
  });

  it('caps the serialized terminal snapshot at four MiB', () => {
    const projector = new DshProjector('dsh:test');
    const body = 'x'.repeat(20_000);
    const history = Array.from({ length: 250 }, (_, seq) => event(seq, 'user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: body }],
    }));
    const out = projector.bootstrap(header, history, false);
    const terminal = out.find((item) => item.type === 'terminal');
    if (terminal?.type !== 'terminal') throw new Error('missing terminal');
    expect(terminal.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(terminal.entries), 'utf8')).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});
