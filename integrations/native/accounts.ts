import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/** Same public account identity for Pi's extension and its read-only history scanner. */
export function piAccountLabel(agentDir?: string, home = homedir()): string {
  const standard = resolve(home, '.pi', 'agent');
  const configured = resolve((agentDir?.trim() || standard).replace(/^~(?=$|\/)/, home));
  if (configured === standard) return '.pi';
  return `${basename(configured).slice(0, 64)}-${createHash('sha256').update(configured).digest('hex').slice(0, 12)}`;
}
