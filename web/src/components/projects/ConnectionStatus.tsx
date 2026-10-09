import { CircleCheck, CircleDashed, Plug } from 'lucide-react';
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
