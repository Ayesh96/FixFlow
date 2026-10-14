import type { TriageStatus, TriageTag } from './workflows/errors/types.ts';
export type FieldErrors = Record<string, string>;

/** What `GET /api/extensions` says about each loaded extension; the UI builds one tab per entry. */
export interface ExtensionInfo {
  id: string;
  title: string;
}

/** One grouped error, as shown in the Errors tab. */
export interface TrackerIssue {
  fingerprintHash: string;
  /** The app that raised it (the event's `service` tag, when the SDK sets one); null otherwise. */
  service: string | null;
  /** The DSN project the events came from. */
  projectId: string;
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  /** `owner/repo` the GitHub issue lives in. */
  githubRepo: string | null;
  /** Status of resolver fix attempt on this issue. */
  resolverStatus?: AttemptStatus | null;
  /** PR number if a fix attempt opened a PR. */
  resolverPrNumber?: number | null;
  /** PR URL if a fix attempt opened a PR. */
  resolverPrUrl?: string | null;
  /** Reason for skipping or failure, if applicable. */
  resolverReason?: string | null;
  /** When the resolver last touched this issue. */
  resolverUpdatedAt?: string | null;
  /** `PENDING` while analysed, then `COMPLETED` or `ERRORED`; null for errors from before triage was recorded. */
  triageStatus?: TriageStatus | null;
  /** What it looks like, why it likely happened and who the culprit is; when `ERRORED`, what went wrong. */
  triageMessage?: string | null;
  /** What to do about it, including "don't report it". */
  triageSuggestion?: string | null;
  triageTags?: TriageTag[];
  /** `model` or `rules`. */
  triageSource?: 'model' | 'rules' | null;
  triageUpdatedAt?: string | null;
}

/** `healthy: false` means the tracker could not be read; `reason` says why. */
export interface TrackerStatus {
  healthy: boolean;
  issues: number;
  events: number;
  lastEventAt: string | null;
  reason: string | null;
}

/** One project's errors on the Errors tab. `projectId: null` collects errors whose project no longer exists. */
export interface TrackerProjectGroup {
  projectId: string | null;
  /** `owner/repo` */
  repo: string | null;
  branch: string | null;
  issueCount: number;
  eventCount: number;
  lastSeen: string | null;
  issues: TrackerIssue[];
  /** Requests the ingest listener refused since startup (wrong key, bad body...), which an SDK drops silently. */
  rejections: { count: number; last: { status: number; reason: string; at: string } | null };
}

/** Status of an error resolver fix attempt. */
export type AttemptStatus = 'PENDING' | 'IN_PROGRESS' | 'PR_OPEN' | 'SKIPPED' | 'FAILED';

/** One fix attempt by the error resolver. */
export interface AttemptRecord {
  issueNumber: number;
  repo: string;
  fingerprintHash: string;
  status: AttemptStatus;
  prNumber: number | null;
  prUrl: string | null;
  reason: string | null;
  /** How many times this issue has been attempted, whatever the outcome. */
  attempts: number;
  attemptedAt: string;
}

/** One line of the resolver's log for an error: a step it took, with what the model or a tool said when there is more. */
export interface ResolverLogEntry {
  /** Null for a line that could not be read; it is still shown, as written. */
  at: string | null;
  message: string;
  /** For an agent turn: `tool_calls` and `content`. For a tool result: `result`. For an error: `error`. */
  detail?: Record<string, unknown>;
}

/** Stats for the error resolver. */
export interface ResolverStats {
  total: number;
  prOpen: number;
  skipped: number;
  failed: number;
}

/** Status of the error resolver service. */
export interface ResolverStatus {
  lastPollAt: string | null;
  lastPollError: string | null;
  polling: boolean;
  stats: ResolverStats;
}

/** Attempts page returned by the error resolver. */
export interface AttemptPage {
  attempts: AttemptRecord[];
  limit: number;
  offset: number;
}

// ---- Projects (the Projects tab) ----

export type { RepoInspection } from './projects/github.ts';
export type { SetupStatus } from './projects/workflow.ts';
export type { PublicProject } from './projects/store.ts';

/** A project as the Projects tab shows it: no token, only enough of it to tell tokens apart. */
export interface ProjectView {
  id: string;
  /** `owner/name` */
  repo: string;
  /** Null for a project imported from the old settings, which learns it on its first fix. */
  branch: string | null;
  /** The last 4 characters of the token. */
  tokenHint: string;
  hasResolverToken: boolean;
  /** The command that checks a fix before it is proposed; null when fixes go out unverified. */
  verifyCommand: string | null;
  /** Also file errors that have no stack trace on GitHub; they are kept in the Errors tab either way. */
  issuesWithoutStack: boolean;
  createdAt: string;
  setup: import('./projects/workflow.ts').SetupStatus;
  /** What an app's Sentry SDK is pointed at; null when error tracking is off. */
  dsn: string | null;
  /** The same address for an app in a Docker container on this machine; null when `dsn` already works there, or errors are off. */
  dockerDsn: string | null;
}

export interface ProjectList {
  projects: ProjectView[];
  ingest: { host: string; port: number } | null;
}
