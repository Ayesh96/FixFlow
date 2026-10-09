import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Pipeline } from '@/components/Pipeline';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StateLabel } from '@/components/StatusLabel';
import type { ResolverStatus, TrackerProjectGroup, TrackerStatus } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatCount, formatRelative } from '@/lib/format';
import { funnel } from '@/lib/lifecycle';

function Health({ ok, children }: { ok: boolean; children: string }) {
  return (
    <StateLabel icon={ok ? CircleCheck : TriangleAlert} tone={ok ? 'text-status-running' : 'text-status-crashed'} data-healthy={ok}>
      {children}
    </StateLabel>
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
