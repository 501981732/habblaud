import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { piAccountLabel } from '../../integrations/native/accounts';
import { parsePiSessionJsonl } from '../../integrations/pi/history';
import type { RecentSession } from '../../shared/types';
import type { HistoryProvider, HistoryResolveResult } from '../sources/source';
import type { NativeSource } from './source';

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_AGE = 7 * 24 * 60 * 60_000;

export function piHistoryRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const expand = (path: string): string => resolve(path.replace(/^~(?=$|\/)/, home));
  if (env.HABBLAUD_PI_DIRS?.trim()) return env.HABBLAUD_PI_DIRS.split(delimiter).filter((s) => s.trim()).slice(0, 16).map((s) => join(expand(s.trim()), 'sessions'));
  return [join(expand(env.PI_CODING_AGENT_DIR?.trim() || join(home, '.pi', 'agent')), 'sessions')];
}

/** Pi owns a tree of entries. Cache its active branch, without reviving closed sessions. */
export class PiHistory implements HistoryProvider {
  readonly provider = 'pi' as const;
  private seen = new Map<string, string>();
  constructor(private readonly opts: { source: NativeSource; roots: string[]; now?: () => number }) {}
  hasAccount(account: string): boolean { return this.opts.source.hasAccount(account); }
  resolve(account: string, sessionId: string): HistoryResolveResult { return this.opts.source.resolve(account, sessionId); }

  async list(): Promise<RecentSession[]> {
    const now = this.opts.now?.() ?? Date.now();
    const candidates: Array<{ path: string; root: string; account: string; modified: number }> = [];
    for (const configured of this.opts.roots) {
      let root: string;
      try { root = realpathSync(configured); } catch { continue; }
      const account = piAccountLabel(dirname(configured));
      const visit = (dir: string, depth: number): void => {
        if (candidates.length >= MAX_FILES) return;
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true }).slice(0, MAX_FILES)) {
            if (candidates.length >= MAX_FILES) break;
            const path = join(dir, entry.name);
            if (entry.isDirectory() && depth < 1) visit(path, depth + 1);
            else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
              const st = statSync(path);
              if (st.size <= MAX_FILE_BYTES && now - st.mtimeMs <= MAX_AGE) candidates.push({ path, root, account, modified: st.mtimeMs });
            }
          }
        } catch { /* One unavailable session directory does not affect the other providers. */ }
      };
      visit(root, 0);
    }
    candidates.sort((a, b) => b.modified - a.modified);
    const keep = new Set<string>();
    for (const candidate of candidates.slice(0, 150)) {
      let fd: number | undefined;
      try {
        const path = realpathSync(candidate.path);
        if (!path.startsWith(candidate.root + sep) || path !== candidate.path) continue;
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const st = fstatSync(fd);
        if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
        const signature = `${st.mtimeMs}:${st.size}`;
        keep.add(path);
        if (this.seen.get(path) === signature) continue;
        const parsed = parsePiSessionJsonl(readFileSync(fd, 'utf8'));
        if (!parsed?.cwd || parsed.lastAt < now - MAX_AGE) continue;
        this.opts.source.cacheHistorical({ sessionId: parsed.sessionId, account: candidate.account, cwd: parsed.cwd,
          sessionFile: path, startedAt: parsed.startedAt, title: parsed.title, model: parsed.model,
          stats: parsed.stats, status: 'offline', capabilities: { history: true, terminal: true } }, parsed.entries, parsed.truncated);
        this.seen.set(path, signature);
      } catch { /* Corrupt, replaced and unreadable files are omitted. */ }
      finally { if (fd !== undefined) closeSync(fd); }
    }
    for (const path of this.seen.keys()) if (!keep.has(path)) this.seen.delete(path);
    return this.opts.source.list();
  }
}
