import type { TrackerIssue } from '@/lib/api';

/** Stages an error moves through, in order. `reached` is the index of the furthest one it got to. */
export const STAGE_KEYS = ['reported', 'triaged', 'filed', 'fixing', 'review'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

type Progress = Pick<TrackerIssue, 'githubIssueNumber' | 'resolverStatus' | 'triageStatus'>;

export interface Lifecycle {
  /** 0 = tracked only … 4 = pull request open. */
  reached: number;
  /** The attempt stopped here for good, rather than still moving. */
  ended: 'SKIPPED' | 'FAILED' | null;
}

export function lifecycleOf(issue: Progress): Lifecycle {
  const status = issue.resolverStatus ?? null;
  if (status === 'PR_OPEN') return { reached: 4, ended: null };
  if (status !== null) return { reached: 3, ended: status === 'SKIPPED' || status === 'FAILED' ? status : null };
  if (issue.githubIssueNumber !== null) return { reached: 2, ended: null }; // filed (older errors were filed before triage was recorded)
  // Triage has finished, one way or the other, once it is no longer pending.
  if (issue.triageStatus === 'COMPLETED' || issue.triageStatus === 'ERRORED') return { reached: 1, ended: null };
  return { reached: 0, ended: null };
}

/** Counts how many errors reached each stage or beyond: the pipeline funnel. */
export function funnel(issues: Progress[]): number[] {
  const out = STAGE_KEYS.map(() => 0);
  for (const issue of issues) {
    const { reached } = lifecycleOf(issue);
    for (let i = 0; i <= reached; i++) out[i]! += 1;
  }
  return out;
}

/** Only http(s) links are ever rendered, whatever the server returns. */
export const safeUrl = (url: string | null | undefined): string | null => (url && /^https?:\/\//i.test(url) ? url : null);
