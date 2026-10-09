import { Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { ErrorRow } from '@/components/errors/ErrorRow';
import { IssueDrawer, type InboxItem } from '@/components/errors/IssueDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TrackerIssue, TrackerProjectGroup } from '@/lib/api';
import { copy } from '@/lib/copy';
import { lifecycleOf } from '@/lib/lifecycle';

const c = copy.errors.all;
const PAGE = 25;

type StateFilter = keyof typeof c.states;

const matches: Record<StateFilter, (i: TrackerIssue) => boolean> = {
  all: () => true,
  unfiled: (i) => lifecycleOf(i).reached < 2,
  safe: (i) => i.triageTags?.includes('bot-safe') === true,
  open: (i) => i.resolverStatus === 'PENDING' || i.resolverStatus === 'IN_PROGRESS',
  pr: (i) => lifecycleOf(i).reached === 4,
  stuck: (i) => lifecycleOf(i).ended !== null,
};

/** Every error of one project, newest activity first: search, one filter, 25 at a time. Each opens its detail drawer. */
export function ErrorList({ group, onChanged }: { group: TrackerProjectGroup; onChanged?: () => void }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<StateFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const sorted = useMemo(() => group.issues.slice().sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)), [group.issues]);
  const visible = useMemo(
    () => sorted.filter((i) => matches[state](i) && (deferred === '' || i.title.toLowerCase().includes(deferred) || (i.service ?? '').toLowerCase().includes(deferred) || (i.triageMessage ?? '').toLowerCase().includes(deferred))),
    [sorted, state, deferred],
  );
  const shown = visible.slice(0, limit);
  const filtered = query !== '' || state !== 'all';
  const open: InboxItem | null = useMemo(() => {
    const issue = group.issues.find((i) => i.fingerprintHash === openHash);
    return issue ? { issue, projectId: group.projectId, repo: group.repo, branch: group.branch } : null;
  }, [group, openHash]);
  const reset = () => {
    setQuery('');
    setState('all');
    setLimit(PAGE);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:p-4">
        <p className="mr-auto pl-1 text-sm text-muted-foreground" aria-hidden>
          {c.count(visible.length, group.issues.length)}
        </p>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))} placeholder={c.searchPlaceholder} aria-label={c.search} className="pl-8" />
        </div>
        <Select value={state} onValueChange={(v) => (setState(v as StateFilter), setLimit(PAGE))}>
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

      <p className="sr-only" role="status" aria-live="polite">
        {c.count(visible.length, group.issues.length)}
      </p>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="font-medium">{c.noMatch.title}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{c.noMatch.body}</p>
          {filtered && (
            <Button variant="outline" size="sm" onClick={reset}>
              {c.noMatch.clear}
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/60 px-2 sm:px-3">
          {shown.map((issue) => (
            <li key={issue.fingerprintHash}>
              <ErrorRow issue={issue} onOpen={() => setOpenHash(issue.fingerprintHash)} />
            </li>
          ))}
        </ul>
      )}

      {visible.length > shown.length && (
        <div className="flex items-center justify-between border-t px-4 py-2">
          <p className="text-sm text-muted-foreground" aria-hidden>
            {c.count(shown.length, visible.length)}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            {c.showMore(Math.min(PAGE, visible.length - shown.length))}
          </Button>
        </div>
      )}

      <IssueDrawer item={open} onClose={() => setOpenHash(null)} onChanged={onChanged} />
    </div>
  );
}
