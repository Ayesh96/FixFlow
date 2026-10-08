import { ExternalLink, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useResolverAttempts } from '@/hooks/useResolverAttempts';
import { api } from '@/lib/api';
import type { AttemptRecord, AttemptStatus } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatCount, formatRelative } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatTile } from '@/components/StatTile';

const c = copy.resolver;

const STATUS_CONFIG: Record<AttemptStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'text-status-stopped' },
  IN_PROGRESS: { label: 'In Progress', tone: 'text-yellow-600 dark:text-yellow-400' },
  PR_OPEN: { label: 'PR Open', tone: 'text-status-running' },
  SKIPPED: { label: 'Skipped', tone: 'text-muted-foreground' },
  FAILED: { label: 'Failed', tone: 'text-status-crashed' },
};

function StatusBadgeForAttempt({ status }: { status: AttemptStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  return (
    <Badge variant="outline" className="gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground" data-status={status}>
      <span className={`size-2 rounded-full ${config.tone}`} aria-hidden />
      {config.label}
    </Badge>
  );
}

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {formatRelative(iso)}
    </time>
  );
}

const linkClass = 'inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

function GithubLink({ repo, issueNumber }: { repo: string; issueNumber: number }) {
  const href = `https://github.com/${repo}/issues/${issueNumber}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={c.issueLink(repo, issueNumber)} className={linkClass}>
      #{issueNumber}
      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
    </a>
  );
}

function PrLink({ prUrl }: { prUrl: string }) {
  return (
    <a href={prUrl} target="_blank" rel="noopener noreferrer" aria-label={c.prLink} className={linkClass}>
      PR
      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
    </a>
  );
}

/** The Resolver tab: poll status, stats, and recent attempts. */
export function ResolverPanel() {
  const { status, attempts, error } = useResolverAttempts();

  return (
    <>
      <h2 className="sr-only">{c.heading}</h2>

      <section aria-label="Summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={c.kpi.total.label} value={status ? formatCount(status.stats.total) : '—'} sub={c.kpi.total.sub} />
        <StatTile label={c.kpi.prOpen.label} value={status ? formatCount(status.stats.prOpen) : '—'} sub={c.kpi.prOpen.sub} />
        <StatTile label={c.kpi.skipped.label} value={status ? formatCount(status.stats.skipped) : '—'} sub={c.kpi.skipped.sub} />
        <StatTile label={c.kpi.failed.label} value={status ? formatCount(status.stats.failed) : '—'} sub={c.kpi.failed.sub} />
      </section>

      {status?.lastPollError && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{c.pollError.title}</AlertTitle>
          <AlertDescription>
            <p>{status.lastPollError}.</p>
            <p>{c.pollError.hint}</p>
          </AlertDescription>
        </Alert>
      )}

      {!status?.lastPollAt && error === null && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading resolver">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

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

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <h3 className="font-medium">{c.recentAttempts}</h3>
          {status?.lastPollAt && (
            <p className="text-sm text-muted-foreground">
              {c.lastPoll(formatRelative(status.lastPollAt))}
            </p>
          )}
        </div>

        {attempts?.attempts && attempts.attempts.length > 0 ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{c.columns.repo}</TableHead>
                  <TableHead>{c.columns.issue}</TableHead>
                  <TableHead>{c.columns.status}</TableHead>
                  <TableHead>{c.columns.pr}</TableHead>
                  <TableHead>{c.columns.reason}</TableHead>
                  <TableHead className="pr-4">{c.columns.attempted}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.attempts.map((attempt) => (
                  <TableRow key={attempt.fingerprintHash}>
                    <TableCell className="max-w-[200px] pl-4 font-medium">
                      <a href={`https://github.com/${attempt.repo}`} target="_blank" rel="noopener noreferrer" className={`${linkClass} text-sm text-muted-foreground`}>
                        {attempt.repo}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </TableCell>
                    <TableCell>
                      <GithubLink repo={attempt.repo} issueNumber={attempt.issueNumber} />
                    </TableCell>
                    <TableCell>
                      <StatusBadgeForAttempt status={attempt.status} />
                    </TableCell>
                    <TableCell>
                      {attempt.prUrl ? <PrLink prUrl={attempt.prUrl} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[250px] text-muted-foreground">
                      {attempt.reason ? <span title={attempt.reason}>{attempt.reason}</span> : '—'}
                    </TableCell>
                    <TableCell className="pr-4">
                      <When iso={attempt.attemptedAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{c.noAttempts}</div>
        )}
      </Card>
    </>
  );
}
