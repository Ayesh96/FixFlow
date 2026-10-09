import { CircleCheck, CircleDashed, Copy, GitBranch, Loader2, RotateCw, Settings, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ExternalLink } from '@/components/Bits';
import { ErrorInbox } from '@/components/errors/ErrorInbox';
import { Pipeline } from '@/components/Pipeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ProjectView, SetupStatus, TrackerProjectGroup } from '@/lib/api';
import { copy } from '@/lib/copy';
import { funnel } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

const c = copy.projects;

const SETUP: Record<SetupStatus['state'], { label: string; icon: LucideIcon; tone: string; spin?: boolean }> = {
  idle: { label: c.setup.idle, icon: CircleDashed, tone: 'text-status-stopped' },
  working: { label: c.setup.working, icon: Loader2, tone: 'text-chart-1', spin: true },
  ready: { label: c.setup.ready, icon: CircleCheck, tone: 'text-status-running' },
  failed: { label: c.setup.failed, icon: TriangleAlert, tone: 'text-status-crashed' },
};

/** Icon and word together, never colour alone (DESIGN.md §1). */
export function SetupBadge({ setup }: { setup: SetupStatus }) {
  const { label, icon: Icon, tone, spin } = SETUP[setup.state];
  return (
    <Badge variant="outline" className="gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground" data-setup={setup.state}>
      <Icon className={cn('size-3.5', tone, spin && 'animate-spin motion-reduce:animate-none')} aria-hidden />
      {label}
    </Badge>
  );
}

function IconAction({ label, icon: Icon, onClick, disabled, destructive }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={cn('size-8 pointer-coarse:size-11', destructive && 'hover:text-destructive')} aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface Props {
  project: ProjectView;
  /** The project's errors, when the tracker has any for it. */
  group: TrackerProjectGroup | undefined;
  busy: boolean;
  onRefreshErrors: () => void;
  onCopyDsn: () => void;
  onRetry: () => void;
  onSettings: () => void;
  onDelete: () => void;
}

/** One project, whole: where its clone is, how its errors are moving through the pipeline, and the latest of them. */
export function ProjectCard({ project, group, busy, onRefreshErrors, onCopyDsn, onRetry, onSettings, onDelete }: Props) {
  const issues = group?.issues ?? [];
  const canRetry = project.branch !== null && (project.setup.state === 'failed' || project.setup.state === 'idle');
  const headingId = `project-${project.id}`;

  return (
    <Card className="gap-0 overflow-hidden py-0" role="region" aria-labelledby={headingId} data-project={project.id}>
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 space-y-1.5">
          <h3 id={headingId} className="truncate text-base font-semibold">
            <ExternalLink href={`https://github.com/${project.repo}`} label={c.repoLink(project.repo)}>
              {project.repo}
            </ExternalLink>
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1 font-mono text-sm text-muted-foreground">
              <GitBranch className="size-3.5" aria-hidden />
              {project.branch ?? (
                <>
                  —<span className="sr-only"> ({c.branchPending})</span>
                </>
              )}
            </span>
            <SetupBadge setup={project.setup} />
          </div>
        </div>
        <div className="-mr-2 -mt-1 flex shrink-0">
          {canRetry && <IconAction label={c.actions.forProject(project.setup.state === 'failed' ? c.actions.retry : c.actions.cloneNow, project.repo)} icon={RotateCw} disabled={busy} onClick={onRetry} />}
          <IconAction label={c.actions.forProject(c.actions.settings, project.repo)} icon={Settings} disabled={busy} onClick={onSettings} />
          <IconAction label={c.actions.forProject(c.actions.delete, project.repo)} icon={Trash2} destructive disabled={busy} onClick={onDelete} />
        </div>
      </header>

      {project.setup.state !== 'ready' && project.setup.state !== 'idle' && (
        <p className="border-b bg-background px-4 py-2 text-sm text-muted-foreground" role={project.setup.state === 'failed' ? 'alert' : undefined}>
          {project.setup.message}
        </p>
      )}

      <div className="flex-1 space-y-4 p-4">
        <Pipeline counts={funnel(issues)} compact />

        {issues.length > 0 && group ? (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">{c.card.errors}</p>
              <p className="text-xs text-muted-foreground">{c.card.total(group.issueCount, group.eventCount)}</p>
            </div>
            <ErrorInbox groups={[group]} embedded onChanged={onRefreshErrors} />
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{c.card.quiet.title}</p>
            <p className="mt-1">{project.dsn ? c.card.quiet.withDsn : c.card.quiet.noDsn}</p>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-background/40 px-4 py-2.5 text-xs text-muted-foreground">
        {project.dsn && (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onCopyDsn}>
            <Copy className="size-3.5" aria-hidden />
            {c.card.copyDsn}
          </Button>
        )}
        <span>
          <span className="font-mono">{c.token(project.tokenHint)}</span>
          {project.hasResolverToken && <span> + {c.separateToken}</span>}
        </span>
        <span className="min-w-0 max-w-full truncate" title={project.verifyCommand ?? undefined}>
          {c.card.check}: {project.verifyCommand ? <span className="font-mono">{project.verifyCommand}</span> : c.noVerify}
        </span>
      </footer>
    </Card>
  );
}
