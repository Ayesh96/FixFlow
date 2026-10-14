import { CircleCheck, CircleDashed, Plug, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Connection } from '@/lib/connection';
import { copy } from '@/lib/copy';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const c = copy.connect;

/**
 * The way into the setup guide. Connected, it offers the guide for adding another app; until then it is the call to
 * connect the first. Same outline button as the rest of the card.
 */
export function ConnectionButton({ connection, onClick, compact = false, fill = false }: { connection: Connection; onClick: () => void; compact?: boolean; fill?: boolean }) {
  return (
    <Button variant="outline" size="sm" className={cn(compact && 'h-7 gap-1.5 px-2 text-xs', fill && 'w-full')} onClick={onClick}>
      <Plug className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
      {connection.connected ? c.guide : c.button}
    </Button>
  );
}

/**
 * Whether an app is reporting to this project, as a plain line of text like the token and fix check beside it:
 * icon and words, never colour alone, and when it last reported. It inherits its size and colour from where it sits.
 */
export function ConnectionNote({ connection, className }: { connection: Connection; className?: string }) {
  const { connected, lastSeen, apps } = connection;
  const Icon = connected ? CircleCheck : CircleDashed;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} data-connected={connected} title={apps.length > 0 ? c.status.apps(apps) : undefined}>
      <Icon className={cn('size-3.5 shrink-0', connected ? 'text-status-running' : 'text-status-stopped')} aria-hidden />
      <span>
        {connected ? c.status.connected : c.status.none}
        {connected && lastSeen && ` · ${c.status.last(formatRelative(lastSeen))}`}
      </span>
    </span>
  );
}

/**
 * Says so when the ingest address turned an app away. The SDK drops that silently, so this is the only place it
 * shows. Words and an icon, with the raw status kept in the text for anyone searching for it.
 */
export function RefusalNote({ connection, className }: { connection: Connection; className?: string }) {
  const { refusal } = connection;
  if (!refusal) return null;
  const r = copy.refused;
  return (
    <p role="status" className={cn('flex items-start gap-2 rounded-md border border-status-crashed/40 px-3 py-2 text-sm text-foreground', className)} data-refused={refusal.status}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-crashed" aria-hidden />
      <span>
        {r.line(r.reasons[refusal.status] ?? r.other, refusal.status, formatRelative(refusal.at))}{' '}
        <span className="text-muted-foreground">
          {refusal.count > 1 && `${r.more(refusal.count)} `}
          {refusal.status === 401 && r.hint}
        </span>
      </span>
    </p>
  );
}
