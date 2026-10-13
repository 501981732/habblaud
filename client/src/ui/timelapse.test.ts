import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../shared/i18n';
beforeEach(() => setLocale('pt-BR'));
afterEach(() => setLocale('zh-CN'));
import { dayLabel, hourTicks } from './timelapse';

describe('timelapse: rótulos', () => {
  it('dia: Hoje, Ontem ou a data curta', () => {
    expect(dayLabel('2026-10-08', '2026-10-08')).toBe('Hoje');
    expect(dayLabel('2026-10-07', '2026-10-08')).toBe('Ontem');
    expect(dayLabel('2026-10-01', '2026-10-01')).toBe('Hoje');
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Ontem');
    expect(dayLabel('2026-10-05', '2026-10-08')).toMatch(/5 de out/);
  });

  it('régua: horas cheias, no máximo ~6 marcas', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();
    expect(hourTicks(at(9, 10), at(12, 30)).map((t) => new Date(t).getHours())).toEqual([10, 11, 12]);
    expect(hourTicks(at(9), at(19)).map((t) => new Date(t).getHours())).toEqual([10, 12, 14, 16, 18]);
    expect(hourTicks(at(0, 5), at(23, 50)).map((t) => new Date(t).getHours())).toEqual([4, 8, 12, 16, 20]);
    expect(hourTicks(at(9, 10), at(9, 50))).toEqual([]);
  });
});
