export const LEVELS = ['debug', 'info', 'warning', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];

export interface StackFrame {
  filename: string | null;
  function: string | null;
  lineno: number | null;
  colno: number | null;
  inApp: boolean;
  contextLine: string | null;
}

export interface ExceptionInfo {
  type: string;
  value: string;
  /** Oldest call first, exactly as Sentry SDKs send them. */
  frames: StackFrame[];
}

/** The subset of a Sentry event this service cares about, with all SDK quirks smoothed out. */
export interface NormalizedEvent {
  eventId: string;
  /** ISO 8601 */
  occurredAt: string;
  platform: string;
  level: Level;
  environment: string | null;
  release: string | null;
  serverName: string | null;
  /** Type of the outermost exception, if the event carries one. */
  exceptionType: string | null;
  /** Outermost exception value, falling back to the log message. */
  message: string;
  culprit: string | null;
  /** Oldest first; the last entry is the exception that was actually thrown. */
  exceptions: ExceptionInfo[];
  tags: Record<string, string>;
  /** Client-supplied grouping override (Sentry's `fingerprint` field). */
  fingerprint: string[] | null;
  /** The event exactly as received, persisted verbatim. */
  rawJson: string;
}

/** A GitHub repository. */
export interface RepoRef {
  owner: string;
  repo: string;
}

export const RESOLVER_STATUSES = ['IN_PROGRESS', 'PR_OPEN', 'SKIPPED', 'FAILED'] as const;
export type ResolverStatus = (typeof RESOLVER_STATUSES)[number];

export interface IssueRecord {
  fingerprintHash: string;
  /** The DSN project the events arrived under; the same error in two projects is two issues. */
  projectId: string;
  /** The app that reported it (the event's `service` tag, when the SDK sets one); null when untagged. */
  service: string | null;
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  /** `owner/repo` the GitHub issue lives in; null until one is opened. */
  githubRepo: string | null;
  /** Set by an external fixer (e.g. ErrorResolver) via POST /admin/issues/:fingerprintHash/resolver-status; null until one reports in. */
  resolverStatus: ResolverStatus | null;
  resolverPrNumber: number | null;
  resolverPrUrl: string | null;
  resolverReason: string | null;
  resolverUpdatedAt: string | null;
}

export interface StoreStats {
  /** Distinct grouped issues. */
  issues: number;
  /** Events ever counted against those issues (unaffected by raw-event pruning). */
  events: number;
  /** ISO 8601 time of the most recent event, null while the store is empty. */
  lastEventAt: string | null;
}
