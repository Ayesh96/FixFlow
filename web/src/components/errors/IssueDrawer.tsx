import { Check, Circle, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, When } from '@/components/Bits';
import { StatusBadge, TagChips, TriageBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api, type TrackerIssue } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatCount } from '@/lib/format';
import { lifecycleOf, safeUrl } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

const c = copy.errors.detail;

/** One error with the project it belongs to, as the drawer shows it. */
export interface InboxItem {
  issue: TrackerIssue;
  projectId: string | null;
  repo: string | null;
  branch: string | null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Detail for one error: what it is, how often, and a timeline of how far the pipeline got with it. */
export function IssueDrawer({ item, onClose, onChanged }: { item: InboxItem | null; onClose: () => void; onChanged?: () => void }) {
  const [asking, setAsking] = useState(false);
  const issue = item?.issue;
  const life = issue ? lifecycleOf(issue) : null;
  const issueUrl = safeUrl(issue?.githubIssueUrl);
  const prUrl = safeUrl(issue?.resolverPrUrl);

  const triaged = life !== null && life.reached >= 1;
  const again = async () => {
    if (!issue) return;
    setAsking(true);
    try {
      await api.errorTracker.retriage(issue.fingerprintHash);
      onChanged?.(); // the server has marked it Analyzing; show that now rather than at the next poll
    } catch (err) {
      toast.error(copy.triage.againFailed, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAsking(false);
    }
  };

  const steps = issue && life && [
    { key: 'reported', done: true, text: c.steps.reported.done, link: null },
    { key: 'triaged', done: triaged, text: issue.triageStatus === 'ERRORED' ? c.steps.triaged.failed : triaged ? c.steps.triaged.done : c.steps.triaged.todo, link: null },
    { key: 'filed', done: life.reached >= 2, text: issue.githubIssueNumber !== null ? c.steps.filed.done(issue.githubIssueNumber) : c.steps.filed.todo, link: issueUrl && { href: issueUrl, label: c.openIssue } },
    { key: 'fixing', done: life.reached >= 3, text: life.reached >= 3 ? c.steps.fixing.done : c.steps.fixing.todo, link: null },
    { key: 'review', done: life.reached >= 4, text: life.reached >= 4 ? c.steps.review.done : c.steps.review.todo, link: prUrl && { href: prUrl, label: c.openPr } },
  ];

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {item && issue && steps && (
          <>
            <SheetHeader className="gap-2 border-b pr-12">
              <SheetTitle className="break-words font-mono text-sm leading-relaxed">{issue.title}</SheetTitle>
              <SheetDescription>
                {item.repo ?? copy.errors.other.title}
                {item.branch && <span className="font-mono"> · {item.branch}</span>}
              </SheetDescription>
            </SheetHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b p-4">
              <Fact label={c.facts.seen}>{formatCount(issue.count)}</Fact>
              <Fact label={c.facts.app}>{issue.service ?? '—'}</Fact>
              <Fact label={c.facts.first}>
                <When iso={issue.firstSeen} />
              </Fact>
              <Fact label={c.facts.last}>
                <When iso={issue.lastSeen} />
              </Fact>
            </dl>

            <section className="space-y-3 border-b p-4" aria-labelledby="triage">
              <div className="flex items-center justify-between gap-2">
                <h3 id="triage" className="text-sm font-medium">
                  {copy.triage.heading}
                </h3>
                <div className="flex items-center gap-2">
                  {issue.triageStatus && <TriageBadge status={issue.triageStatus} />}
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={asking || issue.triageStatus === 'PENDING'} onClick={() => void again()}>
                    <RotateCw className={asking ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'} aria-hidden />
                    {copy.triage.again}
                  </Button>
                </div>
              </div>

              {issue.triageStatus === 'COMPLETED' && (
                <>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{copy.triage.message}</p>
                    <p className="text-sm break-words">{issue.triageMessage}</p>
                  </div>
                  <div className="space-y-1 rounded-md border bg-background p-3">
                    <p className="text-xs text-muted-foreground">{copy.triage.suggestion}</p>
                    <p className="text-sm break-words">{issue.triageSuggestion}</p>
                  </div>
                  <TagChips tags={issue.triageTags ?? []} />
                  {issue.triageSource && <p className="text-xs text-muted-foreground">{copy.triage.source[issue.triageSource]}</p>}
                </>
              )}
              {issue.triageStatus === 'PENDING' && <p className="text-sm text-muted-foreground">{copy.triage.status.PENDING}…</p>}
              {issue.triageStatus === 'ERRORED' && (
                <div className="space-y-1">
                  <p className="text-sm">{copy.triage.failed}</p>
                  {issue.triageMessage && <p className="text-xs break-words text-muted-foreground">{issue.triageMessage}</p>}
                </div>
              )}
              {!issue.triageStatus && <p className="text-sm text-muted-foreground">{copy.triage.notYet}</p>}
            </section>

            <section className="space-y-4 p-4" aria-labelledby="journey">
              <div className="flex items-center justify-between gap-2">
                <h3 id="journey" className="text-sm font-medium">
                  {c.journey}
                </h3>
                {issue.resolverStatus && <StatusBadge status={issue.resolverStatus} />}
              </div>

              <ol className="relative space-y-5">
                {steps.map((step, i) => (
                  <li key={step.key} className="relative flex gap-3">
                    {i < steps.length - 1 && <span className={cn('absolute top-6 left-[11px] h-[calc(100%-4px)] w-px', step.done && steps[i + 1]!.done ? 'bg-foreground' : 'bg-border')} aria-hidden />}
                    <span className={cn('z-10 flex size-6 shrink-0 items-center justify-center rounded-full border', step.done ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground')}>
                      {step.done ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-2" aria-hidden />}
                      <span className="sr-only">{step.done ? '(done)' : '(not yet)'}</span>
                    </span>
                    <div className="min-w-0 space-y-1 pt-0.5">
                      <p className={cn('text-sm', !step.done && 'text-muted-foreground')}>{step.text}</p>
                      {step.link && (
                        <ExternalLink href={step.link.href} className="text-sm">
                          {step.link.label}
                        </ExternalLink>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              {issue.resolverReason && (
                <div className="space-y-1 rounded-md border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Why</p>
                  <p className="text-sm break-words">{issue.resolverReason}</p>
                </div>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
