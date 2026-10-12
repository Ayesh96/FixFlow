import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

/** A snippet you can read, scroll and copy. `wrap` breaks a long single-line value (such as the DSN) inside the box instead of scrolling sideways. */
export function CodeBlock({ code, label, wrap = false }: { code: string; label: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(copy.connect.copyFailed);
    }
  };
  return (
    <div className="relative">
      <pre tabIndex={0} aria-label={label} className={cn('max-h-60 overflow-auto rounded-md border bg-background p-3 pr-12 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', wrap && 'whitespace-pre-wrap break-all')}>
        <code>{code}</code>
      </pre>
      <Button variant="ghost" size="icon" className="absolute top-1.5 right-1.5 size-8" aria-label={`${copy.connect.copy}: ${label}`} onClick={() => void onCopy()}>
        {copied ? <Check className="size-4 text-status-running" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copy.connect.copied : ''}
      </span>
    </div>
  );
}
