import { ArrowLeft, Copy, GitBranch, Plug, RotateCw, Settings, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ExternalLink } from '@/components/Bits';
import { ErrorList } from '@/components/errors/ErrorList';
import { Pipeline } from '@/components/Pipeline';
import { ConnectionButton, ConnectionNote } from '@/components/projects/ConnectionStatus';
import { SetupLabel } from '@/components/projects/ProjectCard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LIST_HREF } from '@/hooks/useProjectRoute';
import type { ProjectView, TrackerProjectGroup } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatRelative } from '@/lib/format';
import { connectionOf } from '@/lib/connection';
import { funnel } from '@/lib/lifecycle';

const c = copy.projects;

interface Props {
  project: ProjectView;
  group: TrackerProjectGroup | undefined;
  busy: boolean;
  onRefreshErrors: () => void;
  onConnect: () => void;
  onCopyDsn: () => void;
  onRetry: () => void;
  onSettings: () => void;
  onDelete: () => void;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/** One project, whole: its pipeline, every one of its errors, and how it is set up. */
export function ProjectPage({ project, group, busy, onRefreshErrors, onConnect, onCopyDsn, onRetry, onSettings, onDelete }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true }); // a new page: start the screen reader at its title
  }, [project.id]);

  const issues = group?.issues ?? [];
  const connection = connectionOf(group);
  const canRetry = project.branch !== null && (project.setup.state === 'failed' || project.setup.state === 'idle');

  return (
    <div className="space-y-6">
      <a href={LIST_HREF} className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ArrowLeft className="size-4" aria-hidden />
        {c.page.back}
      </a>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 ref={heading} tabIndex={-1} className="flex min-w-0 items-center gap-2 text-xl font-semibold outline-none">
            <span className="truncate">{project.repo}</span>
            <ExternalLink href={`https://github.com/${project.repo}`} label={c.repoLink(project.repo)} className="shrink-0">
              <span className="sr-only">GitHub</span>
            </ExternalLink>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1 font-mono text-sm text-muted-foreground">
              <GitBranch className="size-3.5" aria-hidden />
              {project.branch ?? (
                <>
                  —<span className="sr-only"> ({c.branchPending})</span>
                </>
              )}
            </span>
            <SetupLabel setup={project.setup} />
            {project.dsn && <ConnectionNote connection={connection} className="text-sm text-muted-foreground" />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {project.dsn && <ConnectionButton connection={connection} onClick={onConnect} />}
          {project.dsn && (
            <Button variant="outline" size="sm" onClick={onCopyDsn}>
              <Copy className="size-4" aria-hidden />
              {c.card.copyDsn}
            </Button>
          )}
          {canRetry && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
              <RotateCw className="size-4" aria-hidden />
              {project.setup.state === 'failed' ? c.actions.retry : c.actions.cloneNow}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={onSettings}>
            <Settings className="size-4" aria-hidden />
            {c.actions.settings}
          </Button>
          <Button variant="outline" size="sm" className="hover:text-destructive" disabled={busy} onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            {c.actions.delete}
          </Button>
        </div>
      </header>

      {project.setup.state !== 'ready' && project.setup.state !== 'idle' && (
        <p className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground" role={project.setup.state === 'failed' ? 'alert' : undefined}>
          {project.setup.message}
        </p>
      )}

      <Pipeline counts={funnel(issues)} />

      <section aria-labelledby="errors-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="errors-heading" className="text-base font-semibold">
            {c.page.errors}
          </h3>
          {group && group.issueCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {c.card.total(group.issueCount, group.eventCount)}
              {group.lastSeen && <> · {copy.errors.project.lastSeen(formatRelative(group.lastSeen))}</>}
            </p>
          )}
        </div>
        <Card className="gap-0 overflow-hidden py-0">
          {group && issues.length > 0 ? (
            <ErrorList group={group} onChanged={onRefreshErrors} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <p className="font-medium">{c.card.quiet.title}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{project.dsn ? c.card.quiet.withDsn : c.card.quiet.noDsn}</p>
              {project.dsn && (
                <Button size="sm" className="mt-2" onClick={onConnect}>
                  <Plug className="size-4" aria-hidden />
                  {copy.connect.button}
                </Button>
              )}
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="setup-heading" className="space-y-3">
        <h3 id="setup-heading" className="text-base font-semibold">
          {c.page.setup}
        </h3>
        <Card className="p-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={c.page.clone}>
              <SetupLabel setup={project.setup} always />
            </Fact>
            <Fact label={c.columns.token}>
              <span className="font-mono">{c.token(project.tokenHint)}</span>
              {project.hasResolverToken && <span> + {c.separateToken}</span>}
            </Fact>
            <Fact label={c.card.check}>{project.verifyCommand ? <span className="font-mono">{project.verifyCommand}</span> : c.noVerify}</Fact>
            <Fact label={c.page.stackless}>{project.issuesWithoutStack ? c.page.on : c.page.off}</Fact>
            <Fact label={c.page.apps}>{connection.apps.length > 0 ? connection.apps.join(', ') : connection.connected ? c.page.untagged : c.page.noneYet}</Fact>
            <Fact label={c.page.address}>{project.dsn ? <span className="font-mono">{project.dsn}</span> : c.card.quiet.noDsn}</Fact>
          </dl>
        </Card>
      </section>
    </div>
  );
}
