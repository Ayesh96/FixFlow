import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { changed, columnsOf, openDatabase, transaction, type Row } from '../../sqlite.ts';
import { TRIAGE_TAGS, type IssueRecord, type NormalizedEvent, type ResolverStatus, type StoreStats, type TriageResult, type TriageStatus, type TriageTag } from './types.ts';

interface IssueRow {
  fingerprint_hash: string;
  project_id: string;
  service: string | null;
  title: string;
  first_seen: string;
  last_seen: string;
  count: number;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_repo: string | null;
  resolver_status: ResolverStatus | null;
  resolver_pr_number: number | null;
  resolver_pr_url: string | null;
  resolver_reason: string | null;
  resolver_updated_at: string | null;
  triage_status: TriageStatus | null;
  triage_message: string | null;
  triage_suggestion: string | null;
  triage_tags: string | null;
  triage_source: TriageResult['source'] | null;
  triage_updated_at: string | null;
}

/** Tags are stored as JSON text; anything unreadable or unknown is dropped rather than shown. */
function parseTags(text: string | null): TriageTag[] {
  try {
    const list = JSON.parse(text ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((tag): tag is TriageTag => (TRIAGE_TAGS as readonly unknown[]).includes(tag)) : [];
  } catch {
    return [];
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS issues (
  fingerprint_hash    TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL DEFAULT '',
  service             TEXT,
  title               TEXT NOT NULL,
  first_seen          TEXT NOT NULL,
  last_seen           TEXT NOT NULL,
  count               INTEGER NOT NULL DEFAULT 1,
  github_issue_number INTEGER,
  github_issue_url    TEXT,
  github_repo         TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id         TEXT PRIMARY KEY,
  fingerprint_hash TEXT NOT NULL REFERENCES issues(fingerprint_hash) ON DELETE CASCADE,
  received_at      TEXT NOT NULL,
  occurred_at      TEXT NOT NULL,
  level            TEXT NOT NULL,
  platform         TEXT NOT NULL,
  environment      TEXT,
  payload          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_last_seen_idx ON issues (last_seen);
CREATE INDEX IF NOT EXISTS events_fingerprint_idx ON events (fingerprint_hash, received_at);
CREATE INDEX IF NOT EXISTS events_received_idx ON events (received_at);
`;

/** Columns added after the first release; databases created by older versions get them on open. */
const ADDED_COLUMNS: [column: string, definition: string][] = [
  ['project_id', "TEXT NOT NULL DEFAULT ''"],
  ['github_repo', 'TEXT'],
  ['service', 'TEXT'],
  ['resolver_status', 'TEXT'],
  ['resolver_pr_number', 'INTEGER'],
  ['resolver_pr_url', 'TEXT'],
  ['resolver_reason', 'TEXT'],
  ['resolver_updated_at', 'TEXT'],
  ['triage_status', 'TEXT'],
  ['triage_message', 'TEXT'],
  ['triage_suggestion', 'TEXT'],
  ['triage_tags', 'TEXT'],
  ['triage_source', 'TEXT'],
  ['triage_updated_at', 'TEXT'],
];

const toRecord = (row: IssueRow): IssueRecord => ({
  fingerprintHash: row.fingerprint_hash,
  projectId: row.project_id,
  service: row.service,
  title: row.title,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  count: row.count,
  githubIssueNumber: row.github_issue_number,
  githubIssueUrl: row.github_issue_url,
  githubRepo: row.github_repo,
  resolverStatus: row.resolver_status,
  resolverPrNumber: row.resolver_pr_number,
  resolverPrUrl: row.resolver_pr_url,
  resolverReason: row.resolver_reason,
  resolverUpdatedAt: row.resolver_updated_at,
  triageStatus: row.triage_status,
  triageMessage: row.triage_message,
  triageSuggestion: row.triage_suggestion,
  triageTags: parseTags(row.triage_tags),
  triageSource: row.triage_source,
  triageUpdatedAt: row.triage_updated_at,
});

export class Store {
  private readonly db: DatabaseSync;
  private readonly onChange: () => void;
  private readonly recordTx: (event: NormalizedEvent, fingerprint: string, title: string, projectId: string, now: string) => IssueRecord | null;
  private readonly getIssueStmt: StatementSync;
  private readonly setGithubStmt: StatementSync;
  private readonly setResolverStatusStmt: StatementSync;
  private readonly setTriageStmt: StatementSync;
  private readonly latestPayloadStmt: StatementSync;
  private readonly pruneStmt: StatementSync;
  private readonly listStmt: StatementSync;
  private readonly statsStmt: StatementSync;

  /** `onChange` runs after anything an issue list shows is written, so a live view can read again. */
  constructor(path: string, onChange: () => void = () => {}) {
    this.onChange = onChange;
    this.db = openDatabase(path);
    this.db.exec(SCHEMA);
    const have = columnsOf(this.db, 'issues');
    for (const [column, definition] of ADDED_COLUMNS) {
      if (!have.has(column)) this.db.exec(`ALTER TABLE issues ADD COLUMN ${column} ${definition}`);
    }

    const findEvent = this.db.prepare('SELECT 1 AS one FROM events WHERE event_id = ?');
    const upsertIssue = this.db.prepare(
      `INSERT INTO issues (fingerprint_hash, project_id, service, title, first_seen, last_seen, count)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (fingerprint_hash) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen
       RETURNING *`,
    );
    const insertEvent = this.db.prepare(
      `INSERT INTO events (event_id, fingerprint_hash, received_at, occurred_at, level, platform, environment, payload)
       VALUES (@eventId, @fingerprint, @now, @occurredAt, @level, @platform, @environment, @payload)`,
    );

    // Atomic: an event either lands together with its issue bump, or (if the SDK retried
    // and we've seen its event_id) not at all.
    this.recordTx = transaction(this.db, (event: NormalizedEvent, fingerprint: string, title: string, projectId: string, now: string) => {
      if (findEvent.get(event.eventId)) return null;
      const row = upsertIssue.get(fingerprint, projectId, event.tags.service ?? null, title, now, now) as unknown as IssueRow;
      insertEvent.run({
        eventId: event.eventId,
        fingerprint,
        now,
        occurredAt: event.occurredAt,
        level: event.level,
        platform: event.platform,
        environment: event.environment,
        payload: event.rawJson,
      });
      return toRecord(row);
    });

    this.getIssueStmt = this.db.prepare('SELECT * FROM issues WHERE fingerprint_hash = ?');
    this.setGithubStmt = this.db.prepare(
      'UPDATE issues SET github_issue_number = ?, github_issue_url = ?, github_repo = ? WHERE fingerprint_hash = ?',
    );
    this.setResolverStatusStmt = this.db.prepare(
      `UPDATE issues SET resolver_status = ?, resolver_pr_number = ?, resolver_pr_url = ?, resolver_reason = ?, resolver_updated_at = ?
       WHERE fingerprint_hash = ?`,
    );
    this.setTriageStmt = this.db.prepare(
      `UPDATE issues SET triage_status = ?, triage_message = ?, triage_suggestion = ?, triage_tags = ?, triage_source = ?, triage_updated_at = ?
       WHERE fingerprint_hash = ?`,
    );
    this.latestPayloadStmt = this.db.prepare('SELECT payload FROM events WHERE fingerprint_hash = ? ORDER BY received_at DESC, rowid DESC LIMIT 1');
    this.pruneStmt = this.db.prepare('DELETE FROM events WHERE received_at < ?');
    this.listStmt = this.db.prepare('SELECT * FROM issues ORDER BY last_seen DESC, fingerprint_hash LIMIT ? OFFSET ?');
    this.statsStmt = this.db.prepare(
      'SELECT COUNT(*) AS issues, COALESCE(SUM(count), 0) AS events, MAX(last_seen) AS last_event_at FROM issues',
    );
  }

  /**
   * Stores the event and bumps its issue (creating it on first sight). Returns the
   * updated issue, or null when the event_id was already recorded.
   */
  recordEvent(event: NormalizedEvent, fingerprint: string, title: string, projectId: string, now = new Date()): IssueRecord | null {
    const record = this.recordTx(event, fingerprint, title, projectId, now.toISOString());
    if (record) this.onChange();
    return record;
  }

  getIssue(fingerprint: string): IssueRecord | null {
    const row = this.getIssueStmt.get(fingerprint) as unknown as IssueRow | undefined;
    return row ? toRecord(row) : null;
  }

  setGithubIssue(fingerprint: string, number: number, url: string, repo: string): void {
    this.setGithubStmt.run(number, url, repo, fingerprint);
    this.onChange();
  }

  /** The most recent stored event for an error, exactly as received; null once pruning has removed them all. */
  latestEventPayload(fingerprint: string): string | null {
    const row = this.latestPayloadStmt.get(fingerprint) as unknown as { payload: string } | undefined;
    return row?.payload ?? null;
  }

  /** Marks triage as under way. Clears any earlier finding, so a retry never shows a stale one. */
  setTriagePending(fingerprint: string, now = new Date()): void {
    this.setTriageStmt.run('PENDING', null, null, null, null, now.toISOString(), fingerprint);
    this.onChange();
  }

  setTriageResult(fingerprint: string, result: TriageResult, now = new Date()): void {
    this.setTriageStmt.run('COMPLETED', result.message, result.suggestion, JSON.stringify(result.tags), result.source, now.toISOString(), fingerprint);
    this.onChange();
  }

  /** Triage itself failed; `reason` is what went wrong, shown in place of a finding. */
  setTriageError(fingerprint: string, reason: string, now = new Date()): void {
    this.setTriageStmt.run('ERRORED', reason, null, '[]', null, now.toISOString(), fingerprint);
    this.onChange();
  }

  /**
   * Records an external fixer's outcome for this issue. Returns false without writing anything
   * if the fingerprint isn't known, so the caller can answer with a 404.
   */
  setResolverStatus(
    fingerprint: string,
    status: ResolverStatus,
    details: { prNumber?: number | null; prUrl?: string | null; reason?: string | null } = {},
    now = new Date(),
  ): boolean {
    const result = this.setResolverStatusStmt.run(
      status,
      details.prNumber ?? null,
      details.prUrl ?? null,
      details.reason ?? null,
      now.toISOString(),
      fingerprint,
    );
    const found = changed(result) > 0;
    if (found) this.onChange();
    return found;
  }

  /** Most recently seen issues first. */
  listIssues(limit: number, offset: number): IssueRecord[] {
    return (this.listStmt.all(limit, offset) as unknown as IssueRow[]).map(toRecord);
  }

  stats(): StoreStats {
    const row = this.statsStmt.get() as Row as { issues: number; events: number; last_event_at: string | null };
    return { issues: row.issues, events: row.events, lastEventAt: row.last_event_at };
  }

  /** Deletes raw events older than the cutoff. Issue rows and their counters are kept. */
  pruneEventsBefore(cutoff: Date): number {
    return changed(this.pruneStmt.run(cutoff.toISOString()));
  }

  close(): void {
    this.db.close();
  }
}
