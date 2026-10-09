import { ExternalLink as ExternalIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

export const linkClass = 'inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Relative time with the exact moment on hover. */
export function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {formatRelative(iso)}
    </time>
  );
}

/** A new-tab link with the external icon; `label` is the accessible name when the visible text isn't enough. */
export function ExternalLink({ href, label, className, children }: { href: string; label?: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cn(linkClass, className)}>
      {children}
      <ExternalIcon className="size-3.5 text-muted-foreground" aria-hidden />
    </a>
  );
}
