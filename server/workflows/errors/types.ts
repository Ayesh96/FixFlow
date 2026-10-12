export const LEVELS = ['debug', 'info', 'warning', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];

export interface StackFrame {
  filename: string | null;
  function: string | null;
  lineno: number | null;
  colno: number | null;
  inApp: boolean;
  contextLine: string | null;
  /** The function's local variables at that point, as short strings; null when the SDK did not send any. */
  vars: Record<string, string> | null;
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
  /**
   * The stack an SDK attaches to a plain message (`attach_stacktrace`). Sentry puts it in `threads`, not `exception`.
   * Oldest first; empty when the event has an exception with frames, or carries no stack.
   */
  stack: StackFrame[];
  /** The HTTP request being served when it happened, without host or query string; null outside a request. */
  request: { method: string; path: string } | null;
  tags: Record<string, string>;
  /** Client-supplied grouping override (Sentry's `fingerprint` field). */
  fingerprint: string[] | null;
  /** The event exactly as received, persisted verbatim. */
  rawJson: string;
}

export type { RepoRef } from '../../shared/repo.ts';

export const RESOLVER_STATUSES = ['IN_PROGRESS', 'PR_OPEN', 'SKIPPED', 'FAILED'] as const;
export type ResolverStatus = (typeof RESOLVER_STATUSES)[number];

/** Where an error's triage has got to: `PENDING` while it is being analysed, then `COMPLETED` or `ERRORED`. */
export const TRIAGE_STATUSES = ['PENDING', 'COMPLETED', 'ERRORED'] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/** What triage can say about an error. `bot-safe` is also the GitHub label that lets the resolver act on it. */
export const TRIAGE_TAGS = ['bot-safe', 'needs-human', 'test-event', 'no-stack-trace', 'third-party', 'infrastructure'] as const;
export type TriageTag = (typeof TRIAGE_TAGS)[number];

/** Triage's finding: what the error is, what to do about it, and short labels for filtering. */
export interface TriageResult {
  /** What this looks like, why it likely happened, and who or what is the culprit. */
  message: string;
  /** What to do about it, including "don't report it" when it isn't a valid issue. */
  suggestion: string;
  tags: TriageTag[];
  /** `model` when an LLM answered; `rules` when the rule-based fallback did. */
  source: 'model' | 'rules';
}

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
  /** Set by the resolver through `reportResolverStatus`; null until it has attempted the issue. */
  resolverStatus: ResolverStatus | null;
  resolverPrNumber: number | null;
  resolverPrUrl: string | null;
  resolverReason: string | null;
  resolverUpdatedAt: string | null;
  /** Null until triage has been started for this error. */
  triageStatus: TriageStatus | null;
  /** The finding, or (when `ERRORED`) what went wrong. */
  triageMessage: string | null;
  triageSuggestion: string | null;
  triageTags: TriageTag[];
  triageSource: TriageResult['source'] | null;
  triageUpdatedAt: string | null;
}

export interface StoreStats {
  /** Distinct grouped issues. */
  issues: number;
  /** Events ever counted against those issues (unaffected by raw-event pruning). */
  events: number;
  /** ISO 8601 time of the most recent event, null while the store is empty. */
  lastEventAt: string | null;
}
