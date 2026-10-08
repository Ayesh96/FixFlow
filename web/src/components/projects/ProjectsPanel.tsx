import { CircleCheck, CircleDashed, Copy, ExternalLink, FolderGit2, Loader2, Plus, RotateCw, Settings, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddProjectDialog } from '@/components/projects/AddProjectDialog';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useProjects } from '@/hooks/useProjects';
import { api, type ProjectView, type SetupStatus } from '@/lib/api';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

const c = copy.projects;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const SETUP: Record<SetupStatus['state'], { label: string; icon: LucideIcon; tone: string; spin?: boolean }> = {
  idle: { label: c.setup.idle, icon: CircleDashed, tone: 'text-status-stopped' },
  working: { label: c.setup.working, icon: Loader2, tone: 'text-muted-foreground', spin: true },
  ready: { label: c.setup.ready, icon: CircleCheck, tone: 'text-status-running' },
  failed: { label: c.setup.failed, icon: TriangleAlert, tone: 'text-status-crashed' },
};

/** Icon and word together, never colour alone (DESIGN.md §1), with what the clone is doing underneath. */
function SetupBadge({ setup }: { setup: SetupStatus }) {
  const { label, icon: Icon, tone, spin } = SETUP[setup.state];
  return (
    <div className="min-w-0 space-y-1">
      <Badge variant="outline" className="gap-1.5 px-2 py-0.5 text-[13px] font-normal text-foreground" data-setup={setup.state}>
        <Icon className={cn('size-3.5', tone, spin && 'animate-spin motion-reduce:animate-none')} aria-hidden />
        {label}
      </Badge>
      {setup.state !== 'ready' && setup.state !== 'idle' && (
        <p className="max-w-[260px] truncate text-xs text-muted-foreground" title={setup.message}>
          {setup.message}
        </p>
      )}
    </div>
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

/** The Projects tab: each repository the resolver works on, with where its clone has got to. */
export function ProjectsPanel() {
  const { data, error, announcement, refresh } = useProjects();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ProjectView | null>(null);
  const [editing, setEditing] = useState<ProjectView | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const projects = data?.projects ?? null;

  const run = async (project: ProjectView, verb: string, task: () => Promise<unknown>, done: string) => {
    setBusy((b) => ({ ...b, [project.id]: true }));
    try {
      await task();
      toast.success(done);
    } catch (err) {
      toast.error(c.toast.failed(verb, project.repo), { description: message(err) });
    } finally {
      setBusy((b) => ({ ...b, [project.id]: false }));
      void refresh();
    }
  };

  const copyDsn = async (project: ProjectView) => {
    try {
      await navigator.clipboard.writeText(project.dsn ?? '');
      toast.success(c.toast.copied);
    } catch {
      toast.error(c.toast.copyFailed);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{c.heading}</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          {c.add}
        </Button>
      </div>

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

      {projects === null && error === null && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading projects">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {projects?.length === 0 && (
        <Card className="items-center gap-3 px-6 py-16 text-center">
          <FolderGit2 className="size-8 text-muted-foreground" aria-hidden />
          <h3 className="text-base font-semibold">{c.empty.title}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{c.empty.body}</p>
          <Button onClick={() => setAdding(true)}>{c.empty.cta}</Button>
        </Card>
      )}

      {projects && projects.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{c.columns.repo}</TableHead>
                  <TableHead>{c.columns.branch}</TableHead>
                  <TableHead>{c.columns.token}</TableHead>
                  <TableHead>{c.columns.verify}</TableHead>
                  <TableHead>{c.columns.setup}</TableHead>
                  <TableHead className="pr-4 text-right">{c.columns.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => {
                  const working = busy[project.id] === true;
                  return (
                    <TableRow key={project.id} data-project={project.id}>
                      <TableCell className="pl-4 font-medium">
                        <a
                          href={`https://github.com/${project.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={c.repoLink(project.repo)}
                          className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {project.repo}
                          <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {project.branch ?? (
                          <span className="text-muted-foreground">
                            —<span className="sr-only"> ({c.branchPending})</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="font-mono">{c.token(project.tokenHint)}</span>
                        {project.hasResolverToken && (
                          <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[11px] font-normal">
                            {c.separateToken}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm" title={project.verifyCommand ?? undefined}>
                        {project.verifyCommand ? <span className="font-mono">{project.verifyCommand}</span> : <span className="text-muted-foreground">{c.noVerify}</span>}
                      </TableCell>
                      <TableCell>
                        <SetupBadge setup={project.setup} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end">
                          {project.dsn && <IconAction label={c.actions.forProject(c.actions.copyDsn, project.repo)} icon={Copy} onClick={() => void copyDsn(project)} />}
                          {project.branch && (project.setup.state === 'failed' || project.setup.state === 'idle') && (
                            <IconAction
                              label={c.actions.forProject(project.setup.state === 'failed' ? c.actions.retry : c.actions.cloneNow, project.repo)}
                              icon={RotateCw}
                              disabled={working}
                              onClick={() => void run(project, 'clone', () => api.projects.retry(project.id), c.toast.retrying(project.repo))}
                            />
                          )}
                          <IconAction label={c.actions.forProject(c.actions.settings, project.repo)} icon={Settings} disabled={working} onClick={() => setEditing(project)} />
                          <IconAction label={c.actions.forProject(c.actions.delete, project.repo)} icon={Trash2} destructive disabled={working} onClick={() => setDeleting(project)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {data?.ingest && <p className="border-t px-4 py-3 text-sm text-muted-foreground">{c.dsnHelp}</p>}
        </Card>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <AddProjectDialog open={adding} onOpenChange={setAdding} onAdded={() => void refresh()} />

      <ProjectSettingsDialog project={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting ? c.delete.title(deleting.repo, deleting.branch) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{c.delete.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.delete.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                const project = deleting;
                setDeleting(null);
                if (project) void run(project, 'delete', () => api.projects.remove(project.id), c.toast.deleted(project.repo));
              }}
            >
              {c.delete.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
