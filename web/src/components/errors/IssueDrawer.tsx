import { ChevronDown, CircleCheck, CircleDashed, GitPullRequest, LoaderCircle, Play, RotateCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ExternalLink, When } from '@/components/Bits';
import { ResolverLabel, StateLabel, TagChips, TriageLabel } from '@/components/StatusLabel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api, type TrackerIssue } from '@/lib/api';
import { copy } from '@/lib/copy';
import { formatCount } from '@/lib/format';
import { safeUrl } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

const c = copy.errors.detail;
const stage = c.stage;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One error with the project it belongs to, as the drawer shows it. */
export interface InboxItem {
  issue: TrackerIssue;
  projectId: string | null;
  repo: string | null;
  branch: string | null;
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-0.5', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

/**
 * One stage of an error's journey. Closed, every stage looks the same: its name and its own state on one line.
 * A stage with something more to say (the triage read, a skip reason, a link, an action) opens on click; one with
 * nothing more is just the line, with no chevron.
 */
function Stage({ id, title, state, children }: { id: string; title: string; state: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const expandable = children !== undefined && children !== null && children !== false;
  const head = (
    <>
      <h3 id={id} className="text-sm font-medium">
        {title}
      </h3>
      <span className="flex items-center gap-2">
        {state}
        {expandable && <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />}
      </span>
    </>
  );
  return (
    <section aria-labelledby={id} className="border-b last:border-b-0">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-details`}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {head}
        </button>
      ) : (
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">{head}</div>
      )}
      {expandable && open && (
        <div id={`${id}-details`} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** A short passage under a stage, set off from the plain text around it. */
function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{children}</p>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

/** Detail for one error: what it is, then four stages (triage, GitHub issue, resolver, pull request), each with its own state. */
export function IssueDrawer({ item, onClose, onChanged }: { item: InboxItem | null; onClose: () => void; onChanged?: () => void }) {
  const [asking, setAsking] = useState(false);
  const [forcing, setForcing] = useState(false);
  const issue = item?.issue;
  const issueUrl = safeUrl(issue?.githubIssueUrl);
  const prUrl = safeUrl(issue?.resolverPrUrl);

  const triageAgain = async () => {
    if (!issue) return;
    setAsking(true);
    try {
      await api.errorTracker.retriage(issue.fingerprintHash);
      onChanged?.(); // the server has marked it Analyzing; show that now rather than at the next poll
    } catch (err) {
      toast.error(copy.triage.againFailed, { description: errorText(err) });
    } finally {
      setAsking(false);
    }
  };

  const runResolver = async () => {
    if (!issue) return;
    setForcing(true);
    try {
      await api.errorResolver.runIssue(issue.fingerprintHash);
      toast.success(copy.resolver.forceRunStarted);
      onChanged?.();
    } catch (err) {
      toast.error(copy.resolver.forceRunFailed, { description: errorText(err) });
    } finally {
      setForcing(false);
    }
  };

  const resolver = issue?.resolverStatus ?? null;
  const filed = issue?.githubIssueNumber != null;
  const analyzing = issue?.triageStatus === 'PENDING';
  // Needs a GitHub issue to work from; a pull request already open would only be duplicated.
  const canRun = filed && resolver !== 'PR_OPEN' && resolver !== 'IN_PROGRESS';

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {item && issue && (
          <>
            <SheetHeader className="gap-2 border-b pr-12">
              <SheetTitle className="break-words font-mono text-sm leading-relaxed">{issue.title}</SheetTitle>
              <SheetDescription>
                {item.repo ?? copy.errors.other.title}
                {item.branch && <span className="font-mono"> · {item.branch}</span>}
              </SheetDescription>
            </SheetHeader>

            <dl className="grid grid-cols-4 gap-x-3 border-b p-4">
              <Fact label={c.facts.seen}>{formatCount(issue.count)}</Fact>
              <Fact label={c.facts.app}>{issue.service ?? '—'}</Fact>
              <Fact label={c.facts.first}>
                <When iso={issue.firstSeen} />
              </Fact>
              <Fact label={c.facts.last}>
                <When iso={issue.lastSeen} />
              </Fact>
            </dl>

            <div key={issue.fingerprintHash}>
            <Stage id="stage-triage" title={stage.triage.title} state={issue.triageStatus ? <TriageLabel status={issue.triageStatus} /> : null}>
              {issue.triageStatus === 'COMPLETED' && (
                <>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{copy.triage.message}</p>
                    <p className="text-sm break-words">{issue.triageMessage}</p>
                  </div>
                  <Note label={copy.triage.suggestion}>{issue.triageSuggestion}</Note>
                  <TagChips tags={issue.triageTags ?? []} />
                  {issue.triageSource && <p className="text-xs text-muted-foreground">{copy.triage.source[issue.triageSource]}</p>}
                </>
              )}
              {analyzing && <Muted>{copy.triage.status.PENDING}…</Muted>}
              {issue.triageStatus === 'ERRORED' && (
                <>
                  <p className="text-sm">{copy.triage.failed}</p>
                  {issue.triageMessage && <p className="text-xs break-words text-muted-foreground">{issue.triageMessage}</p>}
                </>
              )}
              {!issue.triageStatus && <Muted>{stage.triage.notRead}</Muted>}
              <Button variant="outline" size="sm" className="gap-1.5" disabled={asking} onClick={() => void triageAgain()}>
                <RotateCw className={cn('size-3.5', (asking || analyzing) && 'animate-spin motion-reduce:animate-none')} aria-hidden />
                {copy.triage.again}
              </Button>
            </Stage>

            <Stage
              id="stage-issue"
              title={stage.issue.title}
              state={
                filed ? (
                  <StateLabel icon={CircleCheck} tone="text-status-running">
                    {stage.issue.filed(issue.githubIssueNumber!)}
                  </StateLabel>
                ) : (
                  <StateLabel icon={CircleDashed} tone="text-status-stopped">
                    {stage.issue.notFiled}
                  </StateLabel>
                )
              }
            >
              {issueUrl ? (
                <ExternalLink href={issueUrl} className="text-sm">
                  {c.openIssue}
                </ExternalLink>
              ) : null}
            </Stage>

            <Stage
              id="stage-resolver"
              title={stage.resolver.title}
              state={
                resolver ? (
                  <ResolverLabel status={resolver} />
                ) : (
                  <StateLabel icon={CircleDashed} tone="text-status-stopped">
                    {stage.resolver.notTried}
                  </StateLabel>
                )
              }
            >
              {resolver === 'IN_PROGRESS' && <Muted>{stage.resolver.working}</Muted>}
              {(resolver === 'SKIPPED' || resolver === 'FAILED') && issue.resolverReason && (
                <Note label={resolver === 'SKIPPED' ? stage.resolver.skippedWhy : stage.resolver.failedWhy}>{issue.resolverReason}</Note>
              )}
              {resolver === null && <Muted>{filed ? stage.resolver.notTriedBody : `${stage.resolver.notTriedBody} ${stage.resolver.needsIssue}`}</Muted>}
              {canRun && (
                <Button variant="outline" size="sm" className="gap-1.5" disabled={forcing} onClick={() => void runResolver()}>
                  {forcing ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                  {resolver === null ? copy.resolver.runOne : copy.resolver.forceRun}
                </Button>
              )}
            </Stage>

            <Stage
              id="stage-pr"
              title={stage.pr.title}
              state={
                resolver === 'PR_OPEN' ? (
                  <StateLabel icon={GitPullRequest} tone="text-status-running">
                    {stage.pr.open}
                  </StateLabel>
                ) : (
                  <StateLabel icon={CircleDashed} tone="text-status-stopped">
                    {stage.pr.none}
                  </StateLabel>
                )
              }
            >
              {prUrl ? (
                <ExternalLink href={prUrl} className="text-sm">
                  {c.openPr}
                </ExternalLink>
              ) : null}
            </Stage>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
