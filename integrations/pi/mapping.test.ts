import { describe, expect, it } from 'vitest';
import { serverMessages } from '../../shared/i18n/server';
import { contentText, toolActivity, toolTerminal } from './mapping';

describe('Pi native product copy', () => {
  it('uses fixed refs for activities and leaves native command content in the terminal', () => {
    const activity = toolActivity('s1', 'c1', 'bash', { command: 'printf 你好' }, 1);
    expect(activity).toMatchObject({ kind: 'run', i18n: { key: 'Executando {comando}', params: { comando: 'printf 你好' } } });
    expect(serverMessages[activity.i18n!.key]).toBe('运行 {comando}');
    const terminal = toolTerminal('c1', 'bash', { command: 'printf 你好' }, 1);
    expect(terminal).toMatchObject({ input: 'printf 你好' });
    const read = toolActivity('s1', 'c2', 'read', { path: '/repo/原始文件.ts' }, 2);
    expect(read).toMatchObject({ i18n: { key: 'Lendo {arquivo}', params: { arquivo: '原始文件.ts' } } });
    expect(contentText([{ type: 'text', text: 'Conversa compactada by model' }])).toBe('Conversa compactada by model');
  });

  it('has a language-neutral marker for image content', () => {
    expect(contentText([{ type: 'image', data: 'redacted' }])).toBe('📷');
  });

  it('covers every Pi tool activity template in both languages', () => {
    const names = ['read', 'ls', 'edit', 'write', 'grep', 'find', 'bash', 'powershell', 'mcp__sample', 'custom'];
    names.forEach((name, seq) => {
      const activity = toolActivity('s1', `c${seq}`, name, { path: '/repo/a.ts', command: 'echo ok' }, seq);
      expect(serverMessages[activity.i18n!.key], name).toBeTruthy();
    });
  });
});
