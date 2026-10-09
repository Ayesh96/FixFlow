import { CircleDashed, CircleSlash, GitPullRequest, Loader2, ScanSearch, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { AttemptStatus, TrackerIssue } from '@/lib/api';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

/**
 * A state is an icon and a word, as plain text: no capsule around it. Shape carries the meaning and colour only
 * reinforces it (DESIGN.md §1). Every state in the app, whatever it describes, is drawn this way.
 */
export function StateLabel({ icon: Icon, tone, spin, className, children, ...rest }: { icon: LucideIcon; tone: string; spin?: boolean; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)} {...rest}>
      <Icon className={cn('size-3.5 shrink-0', tone, spin && 'animate-spin motion-reduce:animate-none')} aria-hidden />
      {children}
    </span>
  );
}

const RESOLVER: Record<AttemptStatus, { icon: LucideIcon; tone: string; spin?: boolean }> = {
  PENDING: { icon: CircleDashed, tone: 'text-status-stopped' },
  IN_PROGRESS: { icon: Loader2, tone: 'text-chart-1', spin: true },
  PR_OPEN: { icon: GitPullRequest, tone: 'text-status-running' },
  SKIPPED: { icon: CircleSlash, tone: 'text-status-stopped' },
  FAILED: { icon: TriangleAlert, tone: 'text-status-crashed' },
};

/** Where the resolver got to with an error. */
export function ResolverLabel({ status, className }: { status: AttemptStatus; className?: string }) {
  return (
    <StateLabel {...(RESOLVER[status] ?? RESOLVER.PENDING)} className={className} data-status={status}>
      {copy.status[status] ?? copy.status.PENDING}
    </StateLabel>
  );
}

type TriageState = NonNullable<TrackerIssue['triageStatus']>;
const TRIAGE: Record<TriageState, { icon: LucideIcon; tone: string; spin?: boolean }> = {
  PENDING: { icon: Loader2, tone: 'text-chart-1', spin: true },
  COMPLETED: { icon: ScanSearch, tone: 'text-status-running' },
  ERRORED: { icon: TriangleAlert, tone: 'text-status-crashed' },
};

/** Where triage has got to for an error: Analyzing, Triaged or Couldn't triage. */
export function TriageLabel({ status, className }: { status: TriageState; className?: string }) {
  return (
    <StateLabel {...TRIAGE[status]} className={className} data-triage={status}>
      {copy.triage.status[status]}
    </StateLabel>
  );
}

/** Triage's tags as small square chips. `bot-safe` is the one the resolver acts on, so it gets the stronger outline. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag} className={cn('rounded-sm border px-1.5 py-0.5 text-xs', tag === 'bot-safe' ? 'border-foreground/60 text-foreground' : 'text-muted-foreground')}>
          {(copy.triage.tags as Record<string, string>)[tag] ?? tag}
        </li>
      ))}
    </ul>
  );
}
