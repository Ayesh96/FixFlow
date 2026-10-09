import { CircleDashed, CircleSlash, GitPullRequest, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AttemptStatus } from '@/lib/api';
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

