import type { Store as ErrorsStore } from '../errors/store.ts';
import type { AttemptStatus, TrackedIssue } from './types.ts';
import { GITHUB_ISSUES_PAGE_SIZE } from '../../constants.ts';

/** What the scheduler needs from a tracked-issue source; a seam for tests. */
export interface IssueSource {
  listIssues(): Promise<TrackedIssue[]>;
  reportResolverStatus(
    fingerprintHash: string,
    status: Exclude<AttemptStatus, 'PENDING'>,
    details?: { prNumber?: number | null; prUrl?: string | null; reason?: string | null },
  ): Promise<void>;
}


/**
 * Reads issues straight out of the errors workflow's store.
 *
 * Before the merge this was a 145-line HTTP client against the tracker's `/admin` API, with
 * pagination, timeouts, bearer auth and status-code mapping. Both workflows now live in one
 * process, so it is a function call: there is no transport to fail, and nothing to authenticate.
 */
export class StoreIssueSource implements IssueSource {
  private readonly store: ErrorsStore;

  constructor(store: ErrorsStore) {
    this.store = store;
  }

  async listIssues(): Promise<TrackedIssue[]> {
    return this.store.listIssues(GITHUB_ISSUES_PAGE_SIZE, 0);
  }

  async reportResolverStatus(
    fingerprintHash: string,
    status: Exclude<AttemptStatus, 'PENDING'>,
    details: { prNumber?: number | null; prUrl?: string | null; reason?: string | null } = {},
  ): Promise<void> {
    this.store.setResolverStatus(fingerprintHash, status, details);
  }
}
