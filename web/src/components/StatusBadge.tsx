import { CircleDashed, CircleSlash, GitPullRequest, Loader2, ScanSearch, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AttemptStatus, TrackerIssue } from '@/lib/api';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

/** One vocabulary for resolver states everywhere. Shape carries the meaning; colour only reinforces it (DESIGN.md §1). */
const STATES: Record<AttemptStatus, { icon: LucideIcon; tone: string; spin?: boolean }> = {
  PENDING: { icon: CircleDashed, tone: 'text-status-stopped' },
  IN_PROGRESS: { icon: Loader2, tone: 'text-chart-1', spin: true },
  PR_OPEN: { icon: GitPullRequest, tone: 'text-status-running' },
  SKIPPED: { icon: CircleSlash, tone: 'text-status-stopped' },
  FAILED: { icon: TriangleAlert, tone: 'text-status-crashed' },
};

export function StatusBadge({ status, className }: { status: AttemptStatus; className?: string }) {
  const { icon: Icon, tone, spin } = STATES[status] ?? STATES.PENDING;
  return (
    <Badge variant="outline" className={cn('gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground', className)} data-status={status}>
      <Icon className={cn('size-3.5', tone, spin && 'animate-spin motion-reduce:animate-none')} aria-hidden />
      {copy.status[status] ?? copy.status.PENDING}
    </Badge>
  );
}


type TriageState = NonNullable<TrackerIssue['triageStatus']>;
const TRIAGE: Record<TriageState, { icon: LucideIcon; tone: string; spin?: boolean }> = {
  PENDING: { icon: Loader2, tone: 'text-chart-1', spin: true },
  COMPLETED: { icon: ScanSearch, tone: 'text-status-running' },
  ERRORED: { icon: TriangleAlert, tone: 'text-status-crashed' },
};

/** Where triage has got to for an error: Analyzing, Triaged or Couldn't triage. */
export function TriageBadge({ status, className }: { status: TriageState; className?: string }) {
  const { icon: Icon, tone, spin } = TRIAGE[status];
  return (
    <Badge variant="outline" className={cn('gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground', className)} data-triage={status}>
      <Icon className={cn('size-3.5', tone, spin && 'animate-spin motion-reduce:animate-none')} aria-hidden />
      {copy.triage.status[status]}
    </Badge>
  );
}

/** Triage's tags as small chips. `bot-safe` is the one the resolver acts on, so it gets the stronger outline. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="outline" className={cn('px-2 py-0.5 text-xs font-normal', tag === 'bot-safe' ? 'border-foreground/60 text-foreground' : 'text-muted-foreground')}>
            {(copy.triage.tags as Record<string, string>)[tag] ?? tag}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
