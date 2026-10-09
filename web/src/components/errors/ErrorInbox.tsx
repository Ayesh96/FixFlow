import { ChevronRight, FolderGit2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeferredValue, useMemo, useState } from 'react';
import { When } from '@/components/Bits';
import { IssueDrawer } from '@/components/errors/IssueDrawer';
import { LifecycleTrack } from '@/components/errors/LifecycleTrack';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TrackerIssue, TrackerProjectGroup } from '@/lib/api';
import { copy } from '@/lib/copy';
import { lifecycleOf, STAGE_KEYS } from '@/lib/lifecycle';

const c = copy.errors.inbox;
const PAGE = 25;
const EMBEDDED_PAGE = 5;

export interface InboxItem {
  issue: TrackerIssue;
  projectId: string | null;
  repo: string | null;
  branch: string | null;
}

type StateFilter = keyof typeof c.states;

const matches: Record<StateFilter, (i: TrackerIssue) => boolean> = {
  all: () => true,
  unfiled: (i) => lifecycleOf(i).reached === 0,
  open: (i) => i.resolverStatus === 'PENDING' || i.resolverStatus === 'IN_PROGRESS',
  pr: (i) => lifecycleOf(i).reached === 3,
  stuck: (i) => lifecycleOf(i).ended !== null,
};

/** The word under each row's track: the resolver's state when it has one, else the furthest stage reached. */
const stateWord = (i: TrackerIssue) => (i.resolverStatus ? copy.status[i.resolverStatus] : copy.stages[STAGE_KEYS[lifecycleOf(i).reached]!].label);

/**
 * Every error across every project in one list, newest activity first, with search and two filters.
 * One flat inbox beats a table per project once there is more than one project: the question is
 * "what needs me", not "which repo".
 */
export function ErrorInbox({ groups, embedded = false }: { groups: TrackerProjectGroup[]; embedded?: boolean }) {
  const page = embedded ? EMBEDDED_PAGE : PAGE;
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('all');
  const [state, setState] = useState<StateFilter>('all');
  const [limit, setLimit] = useState(page);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const items = useMemo<InboxItem[]>(
    () =>
      groups
        .flatMap((g) => g.issues.map((issue) => ({ issue, projectId: g.projectId, repo: g.repo, branch: g.branch })))
        .sort((a, b) => Date.parse(b.issue.lastSeen) - Date.parse(a.issue.lastSeen)),
    [groups],
  );

  const visible = useMemo(
    () =>
      items.filter(
        ({ issue, projectId }) =>
          (project === 'all' || (projectId ?? '__deleted') === project) &&
          matches[state](issue) &&
          (deferred === '' || issue.title.toLowerCase().includes(deferred) || (issue.service ?? '').toLowerCase().includes(deferred)),
      ),
    [items, project, state, deferred],
  );
  const shown = visible.slice(0, limit);
  const open = items.find((i) => i.issue.fingerprintHash === openHash) ?? null;
  const filtered = query !== '' || project !== 'all' || state !== 'all';
  const reset = () => {
    setQuery('');
    setProject('all');
    setState('all');
    setLimit(page);
  };

  const Wrapper = embedded ? 'div' : Card;
  const showToolbar = !embedded || items.length > page;

  return (
    <Wrapper {...(embedded ? {} : { className: 'gap-0 overflow-hidden py-0' })}>
      {showToolbar && (
      <div className={embedded ? 'flex flex-wrap items-center gap-2 pb-2' : 'flex flex-wrap items-center gap-2 border-b p-3'}>
        {!embedded && <h3 className="mr-auto pl-1 font-medium">{c.title}</h3>}
        <div className={embedded ? 'relative min-w-40 flex-1' : 'relative w-full sm:w-56'}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => (setQuery(e.target.value), setLimit(page))} placeholder={c.searchPlaceholder} aria-label={c.search} className="pl-8" />
        </div>
        {!embedded && (
        <Select value={project} onValueChange={(v) => (setProject(v), setLimit(page))}>
          <SelectTrigger className="w-full sm:w-44" aria-label={c.project}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{c.allProjects}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.projectId ?? '__deleted'} value={g.projectId ?? '__deleted'}>
                {g.repo ?? copy.errors.other.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        )}
        <Select value={state} onValueChange={(v) => (setState(v as StateFilter), setLimit(page))}>
          <SelectTrigger className="w-full sm:w-44" aria-label={c.state}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(c.states) as StateFilter[]).map((k) => (
              <SelectItem key={k} value={k}>
                {c.states[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {c.count(visible.length, items.length)}
      </p>

      {visible.length === 0 ? (
        <div className={embedded ? 'flex flex-col items-center gap-2 px-6 py-8 text-center' : 'flex flex-col items-center gap-2 px-6 py-14 text-center'}>
          <FolderGit2 className="size-7 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtered ? c.noMatch.title : copy.errors.empty.title}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{filtered ? c.noMatch.body : copy.errors.project.noErrors}</p>
          {filtered && (
            <Button variant="outline" size="sm" onClick={reset}>
              {c.noMatch.clear}
            </Button>
          )}
        </div>
      ) : (
        <ul className={embedded ? '-mx-2 divide-y divide-border/60' : 'divide-y'}>
          {shown.map((item) => {
            const { issue } = item;
            const life = lifecycleOf(issue);
            return (
              <li key={issue.fingerprintHash}>
                <button
                  type="button"
                  onClick={() => setOpenHash(issue.fingerprintHash)}
                  aria-label={c.open(issue.title)}
                  className={cn('group grid w-full grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[1fr_6.5rem_4rem_5rem_1rem]', embedded ? 'rounded-md px-2' : 'px-4')}
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block truncate font-mono text-sm font-medium" title={issue.title}>
                      {issue.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[!embedded && project === 'all' ? item.repo ?? copy.errors.other.title : null, issue.service, issue.githubIssueNumber !== null ? `#${issue.githubIssueNumber}` : null, issue.resolverReason].filter(Boolean).join(' · ') || ' '}
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
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > shown.length && (
        <div className={embedded ? 'flex items-center justify-between pt-2' : 'flex items-center justify-between border-t px-4 py-2'}>
          <p className="text-sm text-muted-foreground" aria-hidden>
            {c.count(shown.length, visible.length)}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + page)}>
            {c.showMore(Math.min(page, visible.length - shown.length))}
          </Button>
        </div>
      )}

      <IssueDrawer item={open} onClose={() => setOpenHash(null)} />
    </Wrapper>
  );
}
