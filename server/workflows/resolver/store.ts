import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { columnsOf, openDatabase } from '../../sqlite.ts';
import type { AttemptRecord, AttemptStats, AttemptStatus } from './types.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempts (
  repo             TEXT NOT NULL,
  issue_number     INTEGER NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  status           TEXT NOT NULL,
  pr_number        INTEGER,
  pr_url           TEXT,
  reason           TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  attempted_at     TEXT NOT NULL,
  PRIMARY KEY (repo, issue_number)
);
CREATE INDEX IF NOT EXISTS attempts_status_idx ON attempts (status);
`;

interface Row {
  repo: string;
  issue_number: number;
  fingerprint_hash: string;
  status: AttemptStatus;
  pr_number: number | null;
  pr_url: string | null;
  reason: string | null;
  attempt_count: number;
  attempted_at: string;
}

function toRecord(row: Row): AttemptRecord {
  return {
    issueNumber: row.issue_number,
    repo: row.repo,
    fingerprintHash: row.fingerprint_hash,
    status: row.status,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    reason: row.reason,
    attempts: row.attempt_count,
    attemptedAt: row.attempted_at,
  };
}

export class Store {
  private readonly db: DatabaseSync;
  private readonly stmtGetAttempt: StatementSync;
  private readonly stmtBeginAttempt: StatementSync;
  private readonly stmtRecordResult: StatementSync;
  private readonly stmtListAttempts: StatementSync;
  private readonly stmtStats: StatementSync;

  constructor(path: string) {
    this.db = openDatabase(path);
    this.db.exec(SCHEMA);
    // Databases from before attempts were counted get the column; their old failures start with a fresh allowance.
    if (!columnsOf(this.db, 'attempts').has('attempt_count')) {
      this.db.exec('ALTER TABLE attempts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
    }

    this.stmtGetAttempt = this.db.prepare(`
      SELECT * FROM attempts WHERE repo = ? AND issue_number = ?
    `);

    this.stmtBeginAttempt = this.db.prepare(`
      INSERT INTO attempts (repo, issue_number, fingerprint_hash, status, pr_number, pr_url, reason, attempted_at, attempt_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (repo, issue_number) DO UPDATE SET
        attempt_count = attempt_count + 1,
        fingerprint_hash = excluded.fingerprint_hash,
        status = excluded.status,
        pr_number = excluded.pr_number,
        pr_url = excluded.pr_url,
        reason = excluded.reason,
        attempted_at = excluded.attempted_at
    `);

    this.stmtRecordResult = this.db.prepare(`
      UPDATE attempts
      SET status = ?, pr_number = ?, pr_url = ?, reason = ?, attempted_at = ?
      WHERE repo = ? AND issue_number = ?
    `);

    this.stmtListAttempts = this.db.prepare(`
      SELECT * FROM attempts ORDER BY attempted_at DESC, issue_number LIMIT ? OFFSET ?
    `);

    this.stmtStats = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'PR_OPEN' THEN 1 ELSE 0 END), 0) AS pr_open,
        COALESCE(SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END), 0) AS skipped,
        COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
      FROM attempts
    `);
  }

  listInProgress(): AttemptRecord[] {
    const rows = this.db.prepare("SELECT * FROM attempts WHERE status = 'IN_PROGRESS'").all() as unknown as Row[];
    return rows.map(toRecord);
  }

  getAttempt(repo: string, issueNumber: number): AttemptRecord | null {
    const row = this.stmtGetAttempt.get(repo, issueNumber) as unknown as Row | undefined;
    return row ? toRecord(row) : null;
  }

  beginAttempt(repo: string, issueNumber: number, fingerprintHash: string, now: Date = new Date()): void {
    this.stmtBeginAttempt.run(
      repo,
      issueNumber,
      fingerprintHash,
      'IN_PROGRESS',
      null,
      null,
      null,
      now.toISOString(),
    );
  }

  recordResult(
    repo: string,
    issueNumber: number,
    status: Exclude<AttemptStatus, 'PENDING' | 'IN_PROGRESS'>,
    details: { prNumber?: number | null; prUrl?: string | null; reason?: string | null } = {},
    now: Date = new Date(),
  ): void {
    this.stmtRecordResult.run(
      status,
      details.prNumber ?? null,
      details.prUrl ?? null,
      details.reason ?? null,
      now.toISOString(),
      repo,
      issueNumber,
    );
  }

  listAttempts(limit: number, offset: number): AttemptRecord[] {
    const rows = this.stmtListAttempts.all(limit, offset) as unknown as Row[];
    return rows.map(toRecord);
  }

  stats(): AttemptStats {
    const row = this.stmtStats.get() as unknown as {
      total: number;
      pr_open: number;
      skipped: number;
      failed: number;
    };
    return {
      total: row.total,
      prOpen: row.pr_open,
      skipped: row.skipped,
      failed: row.failed,
    };
  }

  close(): void {
    this.db.close();
  }
}
