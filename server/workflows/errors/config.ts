import { join } from 'node:path';
import type { LlmGateway } from '../../llm/index.ts';
import { LEVELS, type Level } from './types.ts';

export interface Config {
  /** Port for the public ingest listener (Sentry SDKs post here); never the dashboard's port. */
  ingestPort: number;
  /**
   * Interface the ingest listener binds. Defaults to loopback: only apps on this machine can
   * report. Set `0.0.0.0` to accept events from browsers or other hosts.
   */
  ingestHost: string;
  databasePath: string;
  /** When set, ingest requests must carry this `sentry_key`. */
  dsnPublicKey: string | null;
  github: { apiUrl: string; labels: string[] };
  minIssueLevel: Level;
  commentThresholds: number[];
  retentionDays: number;
  /** The models; triage uses them when any is set up for it, and otherwise the rule-based heuristic. */
  llm: LlmGateway;
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

/**
 * Accepts `sqlite:///abs/path.db`, `sqlite://./rel.db`, `file:./rel.db`, `:memory:` or a bare path.
 * Returns null for anything else (notably postgres:// URLs, which are unsupported).
 */
export function parseDatabaseUrl(url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(sqlite|file):/i.test(url)) return null;
  return url.replace(/^(?:sqlite|file):(?:\/\/)?/i, '') || null;
}

export interface LoadOptions {
  dataDir: string;
  githubApiUrl: string;
  llm: LlmGateway;
}

const OFF = /^(?:0|false|no|off)$/i;

/**
 * Reads the errors workflow's settings. It is on unless `ORCH_ERRORS_ENABLED` turns it off (0, false,
 * no or off), and then it returns null, which leaves the tab out of the dashboard.
 */
export function loadConfig(env: Env, { dataDir, githubApiUrl, llm }: LoadOptions): Config | null {
  const text = (name: string): string => env[name]?.trim() ?? '';
  const list = (name: string): string[] =>
    text(name)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  if (OFF.test(text('ORCH_ERRORS_ENABLED'))) return null;

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

  const ingestPort = integer('ORCH_ERRORS_INGEST_PORT', 3000, 1);
  const retentionDays = integer('ORCH_ERRORS_RETENTION_DAYS', 30, 0);

  const databaseUrl = text('ORCH_ERRORS_DB') || join(dataDir, 'errors.db');
  const databasePath = parseDatabaseUrl(databaseUrl);
  if (!databasePath) problems.push('ORCH_ERRORS_DB must be a SQLite location (e.g. file:./data/errors.db); PostgreSQL is not supported');

  const minIssueLevel = (text('ORCH_ERRORS_MIN_LEVEL') || 'error') as Level;
  if (!LEVELS.includes(minIssueLevel)) problems.push(`ORCH_ERRORS_MIN_LEVEL must be one of: ${LEVELS.join(', ')}`);

  const commentThresholds = (text('ORCH_ERRORS_COMMENT_THRESHOLDS') ? list('ORCH_ERRORS_COMMENT_THRESHOLDS') : ['100', '1000', '10000']).map(Number);
  if (commentThresholds.some((n) => !Number.isInteger(n) || n < 2)) {
    problems.push('ORCH_ERRORS_COMMENT_THRESHOLDS must be a comma-separated list of integers >= 2');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    ingestPort,
    ingestHost: text('ORCH_ERRORS_INGEST_HOST') || '127.0.0.1',
    databasePath: databasePath as string,
    dsnPublicKey: text('ORCH_ERRORS_DSN_PUBLIC_KEY') || null,
    github: { apiUrl: githubApiUrl, labels: list('ORCH_ERRORS_GITHUB_LABELS') },
    minIssueLevel,
    commentThresholds,
    retentionDays,
    llm,
  };
}
