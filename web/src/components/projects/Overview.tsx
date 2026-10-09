import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Pipeline } from '@/components/Pipeline';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { ResolverStatus, TrackerProjectGroup, TrackerStatus } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatCount, formatRelative } from '@/lib/format';
import { funnel } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

function Health({ ok, children }: { ok: boolean; children: string }) {
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <Badge variant="outline" className="gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground" data-healthy={ok}>
      <Icon className={cn('size-3.5', ok ? 'text-status-running' : 'text-status-crashed')} aria-hidden />
      {children}
    </Badge>
  );
}

/** Across every project: is the tracker and resolver alive, and how far do errors get overall. */
export function Overview({ groups, tracker, resolver }: { groups: TrackerProjectGroup[] | null; tracker: TrackerStatus | null; resolver: ResolverStatus | null }) {
  const counts = useMemo(() => funnel((groups ?? []).flatMap((g) => g.issues)), [groups]);
  return (
    <section aria-label="Overview" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {tracker && <Health ok={tracker.healthy}>{tracker.healthy ? copy.errors.health.ok : copy.errors.health.down}</Health>}
        {tracker?.healthy && (
          <p className="text-sm text-muted-foreground">
            {formatCount(tracker.events)} {tracker.events === 1 ? 'event' : 'events'} received · {tracker.lastEventAt ? `last ${formatRelative(tracker.lastEventAt)}` : copy.errors.kpi.last.none}
          </p>
        )}
        {resolver?.lastPollAt && <p className="text-sm text-muted-foreground">{copy.resolver.lastPoll(formatRelative(resolver.lastPollAt))}</p>}
      </div>
      {resolver?.lastPollError && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{copy.resolver.pollError.title}</AlertTitle>
          <AlertDescription>
            <p>{resolver.lastPollError}.</p>
            <p>{copy.resolver.pollError.hint}</p>
          </AlertDescription>
        </Alert>
      )}
      <Pipeline counts={counts} />
    </section>
  );
}
