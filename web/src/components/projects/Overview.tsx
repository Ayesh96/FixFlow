import { CircleCheck, Play, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pipeline } from '@/components/Pipeline';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StateLabel } from '@/components/StatusLabel';
import { api, type ResolverStatus, type TrackerProjectGroup, type TrackerStatus } from '@/lib/api';
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
export function Overview({
  groups,
  tracker,
  resolver,
  onResolverChanged,
}: {
  groups: TrackerProjectGroup[] | null;
  tracker: TrackerStatus | null;
  resolver: ResolverStatus | null;
  onResolverChanged?: () => void;
}) {
  const counts = useMemo(() => funnel((groups ?? []).flatMap((g) => g.issues)), [groups]);
  const [starting, setStarting] = useState(false);
  const running = starting || resolver?.polling === true;
  const runNow = async () => {
    setStarting(true);
    try {
      await api.errorResolver.run();
    } catch (err) {
      toast.error(copy.resolver.runFailed, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setStarting(false);
      onResolverChanged?.(); // show "Running…" now rather than at the next poll
    }
  };
  return (
    <section aria-label="Overview" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {tracker && <Health ok={tracker.healthy}>{tracker.healthy ? copy.errors.health.ok : copy.errors.health.down}</Health>}
        {tracker?.healthy && (
          <p className="text-sm text-muted-foreground">
            {formatCount(tracker.events)} {tracker.events === 1 ? 'event' : 'events'} received · {tracker.lastEventAt ? `last ${formatRelative(tracker.lastEventAt)}` : copy.errors.kpi.last.none}
          </p>
        )}
        {resolver && (
          <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={running}>
            <Play aria-hidden />
            {running ? copy.resolver.running : copy.resolver.runNow}
          </Button>
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
