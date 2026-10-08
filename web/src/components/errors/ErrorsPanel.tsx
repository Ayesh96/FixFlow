import { CircleCheck, FolderGit2, TriangleAlert } from 'lucide-react';
import { ProjectErrors } from '@/components/errors/ProjectErrors';
import { StatTile } from '@/components/StatTile';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorGroups } from '@/hooks/useErrorGroups';
import { copy } from '@/lib/copy';
import { formatCount, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const c = copy.errors;

/** The Errors tab: tracker health and totals, then each project with its own errors. */
export function ErrorsPanel() {
  const { status, groups, error } = useErrorGroups();
  const healthy = status?.healthy === true;
  const HealthIcon = healthy ? CircleCheck : TriangleAlert;

  return (
    <>
      <h2 className="sr-only">{c.heading}</h2>

      {status && (
        <Badge variant="outline" className="w-fit gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground" data-healthy={healthy}>
          <HealthIcon className={cn('size-3.5', healthy ? 'text-status-running' : 'text-status-crashed')} aria-hidden />
          {healthy ? c.health.ok : c.health.down}
        </Badge>
      )}

      <section aria-label="Summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={c.kpi.issues.label} value={healthy ? formatCount(status.issues) : '—'} sub={c.kpi.issues.sub} />
        <StatTile label={c.kpi.events.label} value={healthy ? formatCount(status.events) : '—'} sub={c.kpi.events.sub} />
        <StatTile label={c.kpi.last.label} value={healthy ? (status.lastEventAt ? formatRelative(status.lastEventAt) : c.kpi.last.none) : '—'} sub={c.kpi.last.sub} />
      </section>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{c.unreachable.title}</AlertTitle>
          <AlertDescription>
            <p>{error}.</p>
            <p>{c.unreachable.hint}</p>
          </AlertDescription>
        </Alert>
      )}

      {groups === null && error === null && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading errors">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {groups?.length === 0 && (
        <Card className="items-center gap-3 px-6 py-16 text-center">
          <FolderGit2 className="size-8 text-muted-foreground" aria-hidden />
          <h3 className="text-base font-semibold">{c.empty.title}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{c.empty.body}</p>
        </Card>
      )}

      {groups?.map((group) => (
        <ProjectErrors key={group.projectId ?? '__deleted'} group={group} />
      ))}
    </>
  );
}
