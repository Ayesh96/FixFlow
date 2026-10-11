import { join } from 'node:path';
import type { LlmGateway } from '../../llm/index.ts';
import type { RepoRef } from './types.ts';

const MIN_POLL_INTERVAL_MS = 30_000;

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

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const REPO_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/;

export function parseRepo(text: string): RepoRef | null {
  const match = REPO_PATTERN.exec(text.trim());
  return match ? { owner: match[1] as string, repo: match[2] as string } : null;
}

export const formatRepo = ({ owner, repo }: RepoRef): string => `${owner}/${repo}`;

/** Accepts `sqlite:///abs/path.db`, `sqlite://./rel.db`, `file:./rel.db`, `:memory:` or a bare path. */
export function parseDatabaseUrl(url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(sqlite|file):/i.test(url)) return null;
  return url.replace(/^(?:sqlite|file):(?:\/\/)?/i, '') || null;
}

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
  const pollIntervalMs = integer('ORCH_RESOLVER_POLL_INTERVAL_MS', 300_000, MIN_POLL_INTERVAL_MS);
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
