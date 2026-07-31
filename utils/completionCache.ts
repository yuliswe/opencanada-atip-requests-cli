import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { getEnv } from '@/utils/env';
import { getCliHomeDir } from '@/utils/store';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 30 * 1000;

export function getCompletionCacheDir(): string {
  return path.join(getCliHomeDir(), 'completion-cache');
}

function isCacheFresh(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return Date.now() - stat.mtimeMs < ONE_DAY_MS;
  } catch {
    return false;
  }
}

function readCache(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function writeCacheAtomic(file: string, lines: string[]): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${lines.join('\n')}\n`, 'utf-8');
    fs.renameSync(tmp, file);
  } catch {
    // Best-effort: a failed cache write only costs the next call a refetch.
  }
}

function spawnBackgroundRefresh(): void {
  const child = spawn(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1)],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...getEnv(), ATIP_CLI_AUTOCOMPLETE_REFRESH: '1' },
    }
  );
  child.unref();
}

/**
 * Serves completion candidates from a file cache so that tab completion stays
 * fast even when the source is a network call. A stale cache is still served
 * immediately; a detached re-invocation of the same command (marked by
 * ATIP_CLI_AUTOCOMPLETE_REFRESH) refetches and rewrites the cache off the
 * completion's critical path.
 */
export async function runCached(
  cacheFile: string,
  fetchLines: () => Promise<string[]>
): Promise<void> {
  if (getEnv().ATIP_CLI_AUTOCOMPLETE_REFRESH === '1') {
    setTimeout(() => process.exit(1), REFRESH_TIMEOUT_MS).unref();
    const lines = await fetchLines();
    writeCacheAtomic(cacheFile, lines);
    return;
  }

  const cached = readCache(cacheFile);
  if (cached !== null) {
    process.stdout.write(cached);
    if (!isCacheFresh(cacheFile)) {
      spawnBackgroundRefresh();
    }
    return;
  }

  const lines = await fetchLines();
  writeCacheAtomic(cacheFile, lines);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}
