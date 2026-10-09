import { ChevronRight } from 'lucide-react';
import { When } from '@/components/Bits';
import { LifecycleTrack } from '@/components/errors/LifecycleTrack';
import type { TrackerIssue } from '@/lib/api';
import { copy } from '@/lib/copy';
import { lifecycleOf, STAGE_KEYS } from '@/lib/lifecycle';

const c = copy.errors.recent;

/** The word under a row's track: the resolver's state when it has one, else the furthest stage reached. */
const stateWord = (i: TrackerIssue) => {
  if (i.resolverStatus) return copy.status[i.resolverStatus];
  if (i.triageStatus === 'PENDING') return copy.triage.status.PENDING;
  if (i.triageStatus === 'ERRORED' && i.githubIssueNumber === null) return copy.triage.status.ERRORED;
  return copy.stages[STAGE_KEYS[lifecycleOf(i).reached]!].label;
};

/** The one-line read under a title: triage's message when there is one, else why the resolver stopped. */
const note = (i: TrackerIssue) => (i.triageStatus === 'COMPLETED' ? i.triageMessage : i.triageStatus === 'PENDING' ? `${copy.triage.status.PENDING}…` : i.resolverReason);

/** One error as a row: title and triage's read, how far it got, how often, and when. Opens its detail on click. */
export function ErrorRow({ issue, onOpen }: { issue: TrackerIssue; onOpen: () => void }) {
  const life = lifecycleOf(issue);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={c.open(issue.title)}
      className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 rounded-md px-2 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[1fr_6.5rem_4rem_5rem_1rem]"
    >
      <span className="min-w-0 space-y-0.5">
        <span className="block truncate font-mono text-sm font-medium" title={issue.title}>
          {issue.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground" title={issue.triageMessage ?? undefined}>
          {[issue.service, issue.githubIssueNumber !== null ? `#${issue.githubIssueNumber}` : null, note(issue)].filter(Boolean).join(' · ') || ' '}
        </span>
      </span>
      <span className="hidden space-y-1 md:block">
        <LifecycleTrack lifecycle={life} />
        <span className="block text-xs text-muted-foreground">{stateWord(issue)}</span>
      </span>
      <span className="hidden text-right text-sm tabular-nums md:block">{c.seen(issue.count)}</span>
      <span className="hidden text-sm text-muted-foreground md:block">
        <When iso={issue.lastSeen} />
      </span>
      <ChevronRight className="hidden size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none md:block" aria-hidden />
      <span className="col-span-2 flex items-center gap-3 text-xs text-muted-foreground md:hidden">
        <LifecycleTrack lifecycle={life} />
        <span>{stateWord(issue)}</span>
        <span className="ml-auto tabular-nums">{c.seen(issue.count)}</span>
        <When iso={issue.lastSeen} />
      </span>
    </button>
  );
}
