import { join } from 'node:path';
import type { LlmGateway } from '../../llm/index.ts';
import { parseDatabaseUrl } from '../../shared/database-url.ts';
import { ConfigError } from '../../shared/errors.ts';
import { RESOLVER_MIN_POLL_INTERVAL_MS } from '../../constants.ts';


export interface Config {
  /** The GitHub API address. Tokens belong to projects now (see server/projects). */
  githubApiUrl: string;
  /** The models that diagnose and fix issues, tried in the order set for the resolver. */
  llm: LlmGateway;
  pollIntervalMs: number;
  maxConcurrentFixes: number;
  /** Testing aid: re-attempt SKIPPED issues on every poll instead of remembering the skip. PR_OPEN is never retried. */
  retrySkippedAttempts: boolean;
  databasePath: string;
}

type Env = Record<string, string | undefined>;

export interface LoadOptions {
  dataDir: string;
  githubApiUrl: string;
  llm: LlmGateway;
}

/**
 * Reads the resolver workflow's settings. It is on unless `ORCH_RESOLVER_ENABLED` turns it off (0, false,
 * no or off), and then it returns null, which leaves the tab out of the dashboard.
 *
 * It no longer takes a tracker URL or admin token: the errors workflow's store is right here in
 * the same process, so the scheduler reads issues from it directly.
 */
export function loadConfig(env: Env, { dataDir, githubApiUrl, llm }: LoadOptions): Config | null {
  const text = (name: string): string => env[name]?.trim() ?? '';
  if (/^(?:0|false|no|off)$/i.test(text('ORCH_RESOLVER_ENABLED'))) return null;

  const problems: string[] = [];
  const integer = (name: string, fallback: number, min: number): number => {
    const raw = text(name);
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      problems.push(`${name} must be an integer >= ${min} (got "${raw}")`);
      return fallback;
    }
    return value;
  };
  const pollIntervalMs = integer('ORCH_RESOLVER_POLL_INTERVAL_MS', 300_000, RESOLVER_MIN_POLL_INTERVAL_MS);
  const maxConcurrentFixes = integer('ORCH_RESOLVER_MAX_CONCURRENT_FIXES', 3, 1);

  const databaseUrl = text('ORCH_RESOLVER_DB') || join(dataDir, 'resolver.db');
  const databasePath = parseDatabaseUrl(databaseUrl);
  if (!databasePath) problems.push('ORCH_RESOLVER_DB must be a SQLite location (e.g. file:./data/resolver.db)');

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    githubApiUrl,
    llm,
    pollIntervalMs,
    maxConcurrentFixes,
    retrySkippedAttempts: /^(?:1|true|yes|on)$/i.test(text('ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS')),
    databasePath: databasePath as string,
  };
}
