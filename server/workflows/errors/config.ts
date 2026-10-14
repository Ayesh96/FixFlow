import { join } from 'node:path';
import type { LlmGateway } from '../../llm/index.ts';
import { parseDatabaseUrl } from '../../shared/database-url.ts';
import { ConfigError } from '../../shared/errors.ts';
import { LEVELS, type Level } from './types.ts';

export interface Config {
  /** Port for the public ingest listener (Sentry SDKs post here); never the dashboard's port. */
  ingestPort: number;
  /**
   * Interface the ingest listener binds. Defaults to loopback: only apps on this machine can
   * report. Set `0.0.0.0` to accept events from browsers or other hosts.
   */
  ingestHost: string;
  /**
   * The base address apps use to reach ingest when it is not this machine's own port, e.g.
   * `http://code-akos:3000` for a container on the same Compose network. Null builds DSNs from host and port.
   */
  publicUrl: string | null;
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

type Env = Record<string, string | undefined>;

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

  const publicUrl = ((): string | null => {
    const raw = text('ORCH_ERRORS_PUBLIC_URL');
    if (!raw) return null;
    try {
      const url = new URL(raw);
      const plain = (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
      if (plain) return url.origin;
    } catch {
      // falls through to the same message as any other bad value
    }
    problems.push(`ORCH_ERRORS_PUBLIC_URL must be an http(s) address with no path, query or credentials, like http://code-akos:3000 (got "${raw}")`);
    return null;
  })();

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
    publicUrl,
    databasePath: databasePath as string,
    dsnPublicKey: text('ORCH_ERRORS_DSN_PUBLIC_KEY') || null,
    github: { apiUrl: githubApiUrl, labels: list('ORCH_ERRORS_GITHUB_LABELS') },
    minIssueLevel,
    commentThresholds,
    retentionDays,
    llm,
  };
}
