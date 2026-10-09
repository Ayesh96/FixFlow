import { FolderGit2, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Overview } from '@/components/projects/Overview';
import { AddProjectDialog } from '@/components/projects/AddProjectDialog';
import { ConnectDialog } from '@/components/projects/ConnectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectPage } from '@/components/projects/ProjectPage';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorGroups } from '@/hooks/useErrorGroups';
import { useResolverAttempts } from '@/hooks/useResolverAttempts';
import { LIST_HREF, useProjectRoute } from '@/hooks/useProjectRoute';
import { useProjects } from '@/hooks/useProjects';
import { api, type ProjectView } from '@/lib/api';
import { copy } from '@/lib/copy';

const c = copy.projects;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The Projects tab: one card per repository, with its clone status, its errors' pipeline and the latest errors inside it. */
export function ProjectsPanel() {
  const { data, error, announcement, refresh } = useProjects();
  const { groups, status: tracker, refresh: refreshErrors } = useErrorGroups();
  const { status: resolver } = useResolverAttempts();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ProjectView | null>(null);
  const [editing, setEditing] = useState<ProjectView | null>(null);
  const [connecting, setConnecting] = useState<ProjectView | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const projects = data?.projects ?? null;
  const routeId = useProjectRoute();
  const current = routeId !== null ? (projects?.find((p) => p.id === routeId) ?? null) : null;
  const actionsFor = (project: ProjectView) => ({
    busy: busy[project.id] === true,
    onConnect: () => setConnecting(project),
    onCopyDsn: () => void copyDsn(project),
    onRetry: () => void run(project, 'clone', () => api.projects.retry(project.id), c.toast.retrying(project.repo)),
    onSettings: () => setEditing(project),
    onDelete: () => setDeleting(project),
  });

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
      {current && <ProjectPage project={current} group={groups?.find((g) => g.projectId === current.id)} onRefreshErrors={() => void refreshErrors()} {...actionsFor(current)} />}

      {routeId !== null && !current && projects !== null && (
        <Card className="items-center gap-3 px-6 py-16 text-center">
          <h3 className="text-base font-semibold">{c.page.missing}</h3>
          <a href={LIST_HREF} className={buttonVariants({ variant: 'outline' })}>
            {c.page.back}
          </a>
        </Card>
      )}

      {routeId === null && (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{c.heading}</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          {c.add}
        </Button>
      </div>
      )}

      {routeId === null && projects && projects.length > 0 && <Overview groups={groups} tracker={tracker} resolver={resolver} />}

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

      {routeId === null && projects?.length === 0 && (
        <Card className="items-center gap-3 px-6 py-16 text-center">
          <FolderGit2 className="size-8 text-muted-foreground" aria-hidden />
          <h3 className="text-base font-semibold">{c.empty.title}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{c.empty.body}</p>
          <Button onClick={() => setAdding(true)}>{c.empty.cta}</Button>
        </Card>
      )}

      {routeId === null && projects && projects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              group={groups?.find((g) => g.projectId === project.id)}
              {...actionsFor(project)}
            />
          ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Plus className="size-5" aria-hidden />
            {c.add}
          </button>
        </div>
      )}

      {routeId === null && data?.ingest && projects && projects.length > 0 && <p className="text-sm text-muted-foreground">{c.dsnHelp}</p>}

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <AddProjectDialog open={adding} onOpenChange={setAdding} onAdded={() => void refresh()} />

      <ConnectDialog project={connecting} onClose={() => setConnecting(null)} />

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
