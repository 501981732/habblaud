import { describe, expect, it } from 'vitest';
import { BridgeInvalidRequest, parseEnvelope } from './validate';

const envelope = (events: unknown[]) => ({ version: 1, provider: 'pi', instanceId: 'pi-test', seq: 1, events });
const status = (i18n: unknown) => ({ type: 'status', sessionId: 'session-1', status: 'waiting',
  waitingFor: 'Aguardando você', waitingForI18n: i18n });

describe('native bridge MessageRef validation', () => {
  it('accepts fixed product refs on sessions, status, activities and generated terminal entries', () => {
    const parsed = parseEnvelope(envelope([
      { type: 'session', session: { sessionId: 'session-1', account: '.pi', cwd: '/work', startedAt: 1,
        status: 'waiting', waitingFor: 'Aguardando você', waitingForI18n: { key: 'Aguardando você' } } },
      status({ key: 'Aguardando você' }),
      { type: 'activity', sessionId: 'session-1', activity: { id: 'act-1', kind: 'run', icon: '⌨️', text: 'Executando Bash',
        i18n: { key: 'Executando {ferramenta}', params: { ferramenta: 'Bash', count: 2 } },
        detail: 'operação', detailI18n: { key: 'Detalhe' }, at: 2 } },
      { type: 'terminal', sessionId: 'session-1', entries: [
        { kind: 'tool', id: 't1', at: 3, tool: 'Bash', title: 'Executando Bash', titleI18n: { key: 'Executando {ferramenta}', params: { ferramenta: 'Bash' } } },
        { kind: 'result', id: 'r1', at: 4, toolUseId: 't1', text: 'Concluído', resultI18n: { key: 'Concluído' } },
        { kind: 'system', id: 'c1', at: 5, text: 'Conversa compactada', i18n: { key: 'Conversa compactada' },
          detail: 'Fixed copy', detailI18n: { key: 'Fixed copy' } },
      ] },
    ]));
    expect(parsed.events[0]).toMatchObject({ session: { waitingForI18n: { key: 'Aguardando você' } } });
    expect(parsed.events[1]).toMatchObject({ waitingForI18n: { key: 'Aguardando você' } });
    expect(parsed.events[2]).toMatchObject({ activity: { i18n: { params: { ferramenta: 'Bash', count: 2 } }, detailI18n: { key: 'Detalhe' } } });
    expect(parsed.events[3]).toMatchObject({ entries: [
      { titleI18n: { key: 'Executando {ferramenta}' } },
      { resultI18n: { key: 'Concluído' } },
      { i18n: { key: 'Conversa compactada' }, detailI18n: { key: 'Fixed copy' } },
    ] });
  });

  it.each([
    { key: 'x'.repeat(301) },
    { key: 'ok', params: { long: 'x'.repeat(4097) } },
    { key: 'ok', params: { ["p".repeat(65)]: 'x' } },
    { key: 'ok', params: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, i])) },
    { key: 'ok', params: { count: Infinity } },
    { key: 'ok', params: { count: NaN } },
    { key: 'ok', params: { count: 1e13 } },
    { key: 'ok', params: { extra: { nested: true } } },
    { key: 'ok', unknown: true },
    ['not', 'a', 'ref'],
  ])('rejects an invalid MessageRef: %j', (ref) => {
    expect(() => parseEnvelope(envelope([status(ref)]))).toThrow(BridgeInvalidRequest);
  });

  it('keeps user and assistant text exact and forbids refs on their transcript entries', () => {
    const raw = '用户原文：Respondendo / 执行命令';
    const valid = envelope([{ type: 'terminal', sessionId: 'session-1', entries: [
      { kind: 'user', id: 'u1', at: 1, text: raw },
      { kind: 'assistant', id: 'a1', at: 2, text: raw },
    ] }]);
    expect(parseEnvelope(valid).events[0]).toMatchObject({ entries: [{ text: raw }, { text: raw }] });
    for (const kind of ['user', 'assistant']) {
      expect(() => parseEnvelope(envelope([{ type: 'terminal', sessionId: 'session-1', entries: [
        { kind, id: 'x', at: 1, text: raw, i18n: { key: '翻译原文' } },
      ] }]))).toThrow(BridgeInvalidRequest);
    }
  });
});
