import type { TrackerIssue } from '@/lib/api';

/** Stages an error moves through, in order. `reached` is the index of the furthest one it got to. */
export const STAGE_KEYS = ['reported', 'filed', 'fixing', 'review'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export interface Lifecycle {
  /** 0 = reported only … 3 = pull request open. */
  reached: number;
  /** The attempt stopped here for good, rather than still moving. */
  ended: 'SKIPPED' | 'FAILED' | null;
}

export function lifecycleOf(issue: Pick<TrackerIssue, 'githubIssueNumber' | 'resolverStatus'>): Lifecycle {
  const status = issue.resolverStatus ?? null;
  if (status === 'PR_OPEN') return { reached: 3, ended: null };
  if (status !== null) return { reached: 2, ended: status === 'SKIPPED' || status === 'FAILED' ? status : null };
  return { reached: issue.githubIssueNumber !== null ? 1 : 0, ended: null };
}

/** Counts how many errors reached each stage or beyond: the pipeline funnel. */
export function funnel(issues: Pick<TrackerIssue, 'githubIssueNumber' | 'resolverStatus'>[]): number[] {
  const out = STAGE_KEYS.map(() => 0);
  for (const issue of issues) {
    const { reached } = lifecycleOf(issue);
    for (let i = 0; i <= reached; i++) out[i]! += 1;
  }
  return out;
}

/** Only http(s) links are ever rendered, whatever the server returns. */
export const safeUrl = (url: string | null | undefined): string | null => (url && /^https?:\/\//i.test(url) ? url : null);
