import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TrackerProjectGroup, TrackerIssue, AttemptStatus } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatCount, formatRelative } from '@/lib/format';

const c = copy.errors;
/** More than this and the rest sit behind "Show all", so one noisy project doesn't push the others off screen. */
const PREVIEW = 5;

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {formatRelative(iso)}
    </time>
  );
}

const linkClass = 'inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

const RESOLVER_STATUS_CONFIG: Record<AttemptStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'text-status-stopped' },
  IN_PROGRESS: { label: 'In Progress', tone: 'text-yellow-600 dark:text-yellow-400' },
  PR_OPEN: { label: 'PR Open', tone: 'text-status-running' },
  SKIPPED: { label: 'Skipped', tone: 'text-muted-foreground' },
  FAILED: { label: 'Failed', tone: 'text-status-crashed' },
};

/** Status badge for resolver attempt on an issue. */
function ResolverStatusBadge({ issue }: { issue: TrackerIssue }) {
  if (!issue.resolverStatus) {
    return null;
  }
  const config = RESOLVER_STATUS_CONFIG[issue.resolverStatus] ?? RESOLVER_STATUS_CONFIG.PENDING;
  const href = issue.resolverPrUrl && /^https?:\/\//i.test(issue.resolverPrUrl) ? issue.resolverPrUrl : null;

  const badge = (
    <Badge variant="outline" className="gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground" data-status={issue.resolverStatus}>
      <span className={`size-2 rounded-full ${config.tone}`} aria-hidden />
      {config.label}
    </Badge>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={c.resolverLink(issue.resolverStatus)}>
        {badge}
      </a>
    );
  }

  return badge;
}

/** Only http(s) links are ever rendered, whatever the tracker returns. */
function GithubLink({ issue }: { issue: TrackerIssue }) {
  const href = issue.githubIssueUrl && /^https?:\/\//i.test(issue.githubIssueUrl) ? issue.githubIssueUrl : null;
  if (!href || issue.githubIssueNumber === null) {
    return (
      <span className="text-muted-foreground">
        —<span className="sr-only"> ({c.noGithub})</span>
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={c.githubLink(issue.githubRepo, issue.githubIssueNumber)} className={linkClass}>
      #{issue.githubIssueNumber}
      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
    </a>
  );
}

/** One project and its own errors. */
export function ProjectErrors({ group }: { group: TrackerProjectGroup }) {
  const [all, setAll] = useState(false);
  const title = group.repo ?? c.other.title;
  const headingId = `errors-${group.projectId ?? 'other'}`;
  const shown = all ? group.issues : group.issues.slice(0, PREVIEW);
  const repoHref = group.repo ? `https://github.com/${group.repo}` : null;
  // The app column only earns its place when an SDK actually tags which app raised the error.
  const hasApps = group.issues.some((issue) => issue.service !== null);

  return (
    <Card className="gap-0 overflow-hidden py-0" role="region" aria-labelledby={headingId} data-project={group.projectId ?? undefined}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id={headingId} className="font-medium">
              {title}
            </h3>
            {group.branch && <span className="font-mono text-sm text-muted-foreground">{group.branch}</span>}
            {repoHref && group.repo && (
              <a href={repoHref} target="_blank" rel="noopener noreferrer" aria-label={c.project.repoLink(group.repo)} className={`${linkClass} text-sm text-muted-foreground`}>
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {group.issueCount === 0 ? (
              c.project.noErrors
            ) : (
              <>
                {c.project.summary(group.issueCount, group.eventCount)}
                {group.lastSeen && <> · {c.project.lastSeen(formatRelative(group.lastSeen))}</>}
              </>
            )}
          </p>
        </div>

        {group.projectId === null && <p className="border-t px-4 py-2 text-sm text-muted-foreground">{c.other.body}</p>}

        {group.issueCount > 0 && (
          <div className="border-t">
            <div className="overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">{c.columns.error}</TableHead>
                    {hasApps && <TableHead>{c.columns.app}</TableHead>}
                    <TableHead className="text-right">{c.columns.count}</TableHead>
                    <TableHead>{c.columns.first}</TableHead>
                    <TableHead>{c.columns.last}</TableHead>
                    <TableHead>{c.columns.github}</TableHead>
                    <TableHead className="pr-4">{c.columns.resolver}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((issue) => (
                    <TableRow key={issue.fingerprintHash}>
                      <TableCell className="max-w-[420px] pl-4">
                        <div className="truncate font-medium" title={issue.title}>
                          {issue.title}
                        </div>
                      </TableCell>
                      {hasApps && <TableCell className="text-muted-foreground">{issue.service ?? '—'}</TableCell>}
                      <TableCell className="text-right tabular-nums">{formatCount(issue.count)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <When iso={issue.firstSeen} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <When iso={issue.lastSeen} />
                      </TableCell>
                      <TableCell>
                        <GithubLink issue={issue} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <ResolverStatusBadge issue={issue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {group.issues.length > PREVIEW && (
              <div className="border-t px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
                  {all ? c.project.showFewer : c.project.showAll(group.issues.length)}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
