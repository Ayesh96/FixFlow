import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs font-medium',
                active && 'border-primary bg-primary text-primary-foreground',
                done && 'border-border bg-secondary text-foreground',
                !active && !done && 'text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              <span className="sr-only">{done ? ' (completed)' : ''}</span>
            </span>
            <span className={cn('text-sm', active ? 'font-medium' : 'hidden text-muted-foreground sm:inline')}>{label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-4 bg-border sm:w-8" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
