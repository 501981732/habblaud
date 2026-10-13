import { lstatSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { ensureBridgeConfig, localBridgeUrl } from './config';

describe('native bridge config', () => {
  it('writes a private loopback config and reuses its token on port changes', () => {
    const tmp = tempDir('habblaud-bridge-config-');
    try {
      const dir = join(tmp.dir, 'private');
      const first = ensureBridgeConfig(dir, 'http://127.0.0.1:7123');
      const second = ensureBridgeConfig(dir, 'http://127.0.0.1:7124');
      expect(first.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
      expect(second.token).toBe(first.token);
      expect(second.url).toBe('http://127.0.0.1:7124');
      expect(JSON.parse(readFileSync(join(dir, 'bridge.json'), 'utf8'))).toEqual(second);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, 'bridge.json')).mode & 0o777).toBe(0o600);
    } finally { tmp.cleanup(); }
  });

  it('rejects non-loopback addresses and existing symlinks', () => {
    for (const url of ['https://127.0.0.1:4', 'http://example.com:4', 'http://127.0.0.1:4/path', 'http://localhost:4/?x=1']) {
      expect(() => localBridgeUrl(url)).toThrow();
    }
    const tmp = tempDir('habblaud-bridge-link-');
    try {
      const target = join(tmp.dir, 'target');
      writeFileSync(target, 'outside');
      const config = join(tmp.dir, 'bridge.json');
      symlinkSync(target, config);
      expect(() => ensureBridgeConfig(tmp.dir, 'http://[::1]:7123', config)).toThrow();
      expect(lstatSync(config).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('outside');
    } finally { tmp.cleanup(); }
  });
});
