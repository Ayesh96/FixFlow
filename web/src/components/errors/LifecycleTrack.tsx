import { copy } from '@/lib/copy';
import { STAGE_KEYS, type Lifecycle } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

/**
 * Four short segments, one per stage, filled up to the furthest one reached. A glanceable "how far did this get"
 * in the list; the exact state is the text alternative and, in the drawer, the full timeline.
 */
export function LifecycleTrack({ lifecycle }: { lifecycle: Lifecycle }) {
  const { reached, ended } = lifecycle;
  const label = copy.stages[STAGE_KEYS[reached]!].label;
  const text = `${copy.stages.track(label, reached + 1)}${ended ? `, ${copy.stages.ended[ended]}` : ''}`;
  return (
    <div role="img" aria-label={text} title={text} className="flex w-24 gap-0.5">
      {STAGE_KEYS.map((key, i) => (
        <span
          key={key}
          className={cn(
            'h-1.5 flex-1 first:rounded-l-full last:rounded-r-full',
            i <= reached ? 'bg-foreground' : 'bg-border',
            i === reached && ended === 'FAILED' && 'bg-status-crashed',
            i === reached && ended === 'SKIPPED' && 'bg-status-stopped',
          )}
        />
      ))}
    </div>
  );
}
