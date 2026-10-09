import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from '@/components/projects/CodeBlock';
import type { ProjectView } from '@/lib/api';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';
import { guides, serviceName, SETTINGS, type LanguageId } from '@/lib/snippets';

const c = copy.connect;

function Step({ n, title, className, children }: { n: number; title: string; className?: string; children: React.ReactNode }) {
  return (
    <li className={cn('min-w-0 space-y-2', className)}>
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground" aria-hidden>
          {n}
        </span>
        {title}
      </h3>
      <div className="min-w-0 space-y-2 sm:pl-7">{children}</div>
    </li>
  );
}

/**
 * A guide to pointing an app's Sentry SDK at one project, with the code filled in for the project and the language.
 * The dialog never outgrows the screen: the title and the language tabs stay put, and only the steps scroll.
 */
export function ConnectDialog({ project, onClose }: { project: ProjectView | null; onClose: () => void }) {
  const dsn = project?.dsn ?? null;
  const set = project && dsn ? guides(dsn, serviceName(project.repo)) : null;
  const ids = set ? (Object.keys(set) as LanguageId[]) : [];

  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <Tabs defaultValue="python" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="shrink-0 space-y-3 border-b px-4 py-4 pr-12 sm:px-6">
            <DialogHeader>
              <DialogTitle className="break-words">{project ? c.title(project.repo) : ''}</DialogTitle>
              <DialogDescription>{c.description}</DialogDescription>
            </DialogHeader>
            {set && (
              <TabsList aria-label={c.languages}>
                {ids.map((id) => (
                  <TabsTrigger key={id} value={id}>
                    {set[id].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {project && !set && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{c.noDsn}</p>}

            {dsn &&
              set &&
              ids.map((id) => {
                const g = set[id];
                return (
                  <TabsContent key={id} value={id} className="space-y-5">
                    <ol className="grid gap-5 sm:grid-cols-2">
                      <Step n={1} title={c.steps.address}>
                        <CodeBlock code={dsn} label={c.steps.address} />
                        <p className="text-xs text-muted-foreground">{c.localhostNote}</p>
                      </Step>
                      <Step n={2} title={c.steps.install}>
                        <CodeBlock code={g.install} label={`${g.label}: ${c.steps.install}`} />
                      </Step>
                      <Step n={3} title={c.steps.init} className="sm:col-span-2">
                        <CodeBlock code={g.init} label={`${g.label}: ${c.steps.init}`} />
                        <p className="text-xs text-muted-foreground">{c.initNote[id]}</p>
                      </Step>
                      <Step n={4} title={c.steps.test} className="sm:col-span-2">
                        <CodeBlock code={g.test} label={`${g.label}: ${c.steps.test}`} />
                        <p className="text-xs text-muted-foreground">{c.testNote}</p>
                      </Step>
                    </ol>

                    <details className="group rounded-md border">
                      <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{c.settingsTitle}</summary>
                      <dl className="divide-y border-t text-sm">
                        {SETTINGS.map((s, i) => (
                          <div key={s.key} className="grid gap-1 p-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                            <dt className="font-mono text-[13px] break-words">{g.names[i]}</dt>
                            <dd className="text-muted-foreground">{s.why}</dd>
                          </div>
                        ))}
                      </dl>
                      {id !== 'python' && <p className="border-t p-3 text-xs text-muted-foreground">{c.typescriptNote}</p>}
                    </details>
                  </TabsContent>
                );
              })}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
