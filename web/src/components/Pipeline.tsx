import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { copy } from '@/lib/copy';
import { formatCount } from '@/lib/format';
import { STAGE_KEYS } from '@/lib/lifecycle';

/**
 * The product in one strip: how many errors reached each stage. A funnel of four ordered magnitudes is
 * stat tiles with a proportion bar, not a chart: the number is the message, the bar only shows the drop-off.
 * One hue (categorical slot 1) over a hairline track; the stage name and percentage are text, so nothing rides on colour.
 */
export function Pipeline({ counts, compact = false, roomy = false }: { counts: number[]; compact?: boolean; roomy?: boolean }) {
  const bare = compact || roomy; // lives inside another card, so draws none of its own
  const top = counts[0] ?? 0;
  const list = (
      <ol aria-label="Pipeline" className={bare ? 'grid grid-cols-5 gap-3' : 'grid grid-cols-2 divide-border lg:grid-cols-5 lg:divide-x'}>
        {STAGE_KEYS.map((key, i) => {
          const n = counts[i] ?? 0;
          const pct = top > 0 ? Math.round((n / top) * 100) : 0;
          const stage = copy.stages[key];
          return (
            <li key={key} className={bare ? 'flex min-w-0 flex-col gap-1.5' : 'relative flex flex-col gap-2 border-border p-4 max-lg:odd:border-r max-lg:nth-[n+3]:border-t max-lg:last:col-span-2 max-lg:last:border-r-0'}>
              <p className={bare ? 'truncate text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>{stage.label}</p>
              <p className={roomy ? 'text-3xl font-semibold tracking-tight' : compact ? 'text-xl font-semibold tracking-tight' : 'text-3xl font-semibold tracking-tight'}>{formatCount(n)}</p>
              <div className={roomy ? 'h-2 rounded-full bg-border' : 'h-1.5 rounded-full bg-border'} aria-hidden>
                <div className="h-full rounded-full bg-chart-1 transition-[width] duration-150 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
              </div>
              {roomy ? (
                <p className="text-xs text-muted-foreground">{i === 0 ? 'of all errors' : `${pct}% of tracked`}</p>
              ) : (
                !compact && <p className="text-xs text-muted-foreground">{i === 0 ? stage.sub : `${pct}% of reported · ${stage.sub}`}</p>
              )}
              {!bare && i < STAGE_KEYS.length - 1 && (
                <ChevronRight className="absolute top-1/2 -right-2 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-card text-muted-foreground lg:block" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
  );
  return bare ? list : <Card className="gap-0 py-0">{list}</Card>;
}
