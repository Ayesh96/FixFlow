export type { RepoRef } from '../../shared/repo.ts';

/** One row from error-tracker's `GET /admin/issues`. */
export interface TrackedIssue {
  fingerprintHash: string;
  projectId: string;
  service: string | null;
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubRepo: string | null;
}

/** The subset of a GitHub issue this service needs to decide whether to work on it. */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  htmlUrl: string;
}

export interface CreatedPullRequest {
  number: number;
  url: string;
}

export type AttemptStatus = 'PENDING' | 'IN_PROGRESS' | 'PR_OPEN' | 'SKIPPED' | 'FAILED';

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

/** Outcome of one fix attempt, before it's turned into an AttemptRecord. */
export type FixOutcome =
  | { kind: 'skipped'; reason: string }
  | {
      kind: 'fixed';
      explanation: string;
      filesChanged: string[];
      verifyRan: boolean;
      verified: boolean;
      branchName: string;
      baseBranch: string;
    }
  | { kind: 'failed'; error: string };

export interface AttemptStats {
  total: number;
  prOpen: number;
  skipped: number;
  failed: number;
}

export interface PollStatus {
  lastPollAt: string | null;
  lastPollError: string | null;
  /** True while a cycle is running, so the dashboard can disable "Run now". */
  polling: boolean;
}
