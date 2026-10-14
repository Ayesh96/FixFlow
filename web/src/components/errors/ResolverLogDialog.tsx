import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type ResolverLogEntry } from '@/lib/api';
import { copy } from '@/lib/copy';
import { startLive } from '@/lib/live';
import { cn } from '@/lib/utils';

const c = copy.resolverLog;
/** The log is a file the server appends to without announcing each line, so a running attempt is read on a timer. */
const WHILE_WORKING_MS = 2000;
const ATTEMPT = /^---- attempt started/;

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : '');
const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

function Part({ label, tone, children }: { label: string; tone?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <pre className={cn('max-h-64 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words', tone)}>{children}</pre>
    </div>
  );
}

/** One logged step: its time and what happened, then whatever the model or a tool said with it. */
function Entry({ entry }: { entry: ResolverLogEntry }) {
  const { detail } = entry;
  const calls = Array.isArray(detail?.tool_calls) ? (detail.tool_calls as unknown[]).map(text) : [];
  const said = typeof detail?.content === 'string' ? detail.content.trim() : '';
  return (
    <li className="space-y-1.5 py-2">
      <p className="text-sm break-words">
        <span className="mr-2 font-mono text-xs text-muted-foreground tabular-nums">{time(entry.at)}</span>
        {entry.message}
      </p>
      {calls.length > 0 && <Part label={c.toolCalls}>{calls.join('\n\n')}</Part>}
      {said && <Part label={c.said}>{said}</Part>}
      {detail?.result !== undefined && <Part label={c.result}>{text(detail.result)}</Part>}
      {detail?.error !== undefined && (
        <Part label={c.error} tone="text-destructive">
          {text(detail.error)}
        </Part>
      )}
    </li>
  );
}

/** Splits the log at each "attempt started" line, so every attempt reads as its own section. */
function byAttempt(entries: ResolverLogEntry[]): { start: ResolverLogEntry | null; steps: ResolverLogEntry[] }[] {
  const attempts: { start: ResolverLogEntry | null; steps: ResolverLogEntry[] }[] = [];
  for (const entry of entries) {
    if (ATTEMPT.test(entry.message)) attempts.push({ start: entry, steps: [] });
    else if (attempts.length === 0) attempts.push({ start: null, steps: [entry] });
    else attempts[attempts.length - 1]!.steps.push(entry);
  }
  return attempts;
}

/** What the resolver did on one error, read from its log file; kept current while an attempt is running. */
export function ResolverLogDialog({ fingerprintHash, working, onClose }: { fingerprintHash: string | null; working: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<ResolverLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fingerprintHash) return;
    setEntries(null);
    setError(null);
    const load = async () => {
      try {
        setEntries((await api.errorResolver.log(fingerprintHash)).entries);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    // Read again when an attempt starts or ends, and every few seconds while one is running.
    const live = startLive(load, ['resolver']);
    const timer = working ? setInterval(() => void live.now(), WHILE_WORKING_MS) : null;
    return () => {
      live.stop();
      if (timer) clearInterval(timer);
    };
  }, [fingerprintHash, working]);

  // The latest step is what matters most, so keep it in view as lines arrive.
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [entries]);

  const attempts = entries ? byAttempt(entries) : [];
  return (
    <Dialog open={fingerprintHash !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>
            {c.description}
            {working && (
              <span className="mt-1 flex items-center gap-1.5 text-xs">
                <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                {c.live}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
          {error && <p className="text-sm text-destructive">{`${c.failed}: ${error}`}</p>}
          {!error && entries === null && <p className="text-sm text-muted-foreground">{c.loading}</p>}
          {!error && entries?.length === 0 && <p className="text-sm text-muted-foreground">{c.empty}</p>}
          {attempts.map((attempt, i) => (
            <section key={i} className="border-b pb-2 last:border-b-0">
              {attempt.start && (
                <h3 className="sticky top-0 bg-background py-2 text-sm font-medium">
                  {`${c.attempt} ${attempts.slice(0, i + 1).filter((a) => a.start).length}`}
                  <span className="ml-2 font-normal text-muted-foreground">{attempt.start.at ? new Date(attempt.start.at).toLocaleString() : ''}</span>
                </h3>
              )}
              <ol className="divide-y">
                {attempt.steps.map((entry, j) => (
                  <Entry key={j} entry={entry} />
                ))}
              </ol>
            </section>
          ))}
          <div ref={end} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
