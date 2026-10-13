import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, localize, serverMessages, setLocale, t } from './index';

describe('i18n', () => {
  afterEach(() => setLocale('zh-CN'));

  it('starts in Chinese, interpolates product copy, and preserves Portuguese mode', () => {
    expect(getLocale()).toBe('zh-CN');
    expect(t('há {n} min', { n: 3 })).toBe('3 分钟前');
    setLocale('pt-BR');
    expect(t('há {n} min', { n: 3 })).toBe('há 3 min');
  });

  it('translates a server template with params and safely falls back for unknown messages', () => {
    const key = '__i18n_test_template__ {name}';
    serverMessages[key] = '你好，{name}';
    try {
      expect(localize({ text: key, i18n: { key, params: { name: '小明' } } })).toBe('你好，小明');
    } finally {
      delete serverMessages[key];
    }
    expect(localize({ text: '原始活动输出', i18n: { key: '未知模板 {name}', params: { name: '值' } } })).toBe('未知模板 值');
  });
});
