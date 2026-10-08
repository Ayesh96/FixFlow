import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fieldProps } from '@/components/wizard/fields';
import { copy } from '@/lib/copy';

const c = copy.projects.wizard.branch;
const OTHER = '__other__';

interface Props {
  value: string;
  onChange: (branch: string) => void;
  /** The repo's branches as GitHub listed them. Empty when they could not be fetched: the picker is then a plain text box. */
  branches: string[];
  defaultBranch?: string | null | undefined;
  /** The list may be missing some branches, so typing one is offered too. */
  truncated?: boolean;
  loading?: boolean;
  error?: string | undefined;
  help?: string;
  autoFocus?: boolean;
}

/**
 * Picks the branch to work on from the repo's own branches. A value that is not in the list (a branch
 * the repo has more of than fit, or one that was saved earlier) still shows and can be kept.
 */
export function BranchPicker({ value, onChange, branches, defaultBranch, truncated = false, loading = false, error, help, autoFocus }: Props) {
  // Typing is offered only when the list cannot be trusted to be complete.
  const canType = truncated;
  const [typing, setTyping] = useState(false);
  const props = fieldProps('branch', error, help);

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger {...props} className="w-full font-mono text-sm">
          <SelectValue placeholder={c.loading} />
        </SelectTrigger>
      </Select>
    );
  }

  if (branches.length === 0) {
    return <Input {...props} value={value} placeholder={c.otherLabel} autoComplete="off" spellCheck={false} autoFocus={autoFocus} className="font-mono text-sm" onChange={(e) => onChange(e.target.value)} />;
  }

  // Default branch first, then the rest as GitHub ordered them; the saved value stays even when it is not listed.
  const ordered = [...(defaultBranch && branches.includes(defaultBranch) ? [defaultBranch] : []), ...branches.filter((b) => b !== defaultBranch)];
  const options = value !== '' && !ordered.includes(value) ? [value, ...ordered] : ordered;

  return (
    <div className="space-y-2">
      <Select
        value={typing ? OTHER : value}
        onValueChange={(next) => {
          if (next === OTHER) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(next);
        }}
      >
        <SelectTrigger {...props} className="w-full font-mono text-sm" autoFocus={autoFocus}>
          <SelectValue placeholder={c.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((name) => (
            <SelectItem key={name} value={name} className="font-mono">
              {name}
              {name === defaultBranch && <span className="font-sans text-xs text-muted-foreground"> · {c.defaultTag}</span>}
            </SelectItem>
          ))}
          {canType && <SelectItem value={OTHER}>{c.other}</SelectItem>}
        </SelectContent>
      </Select>
      {typing && (
        <Input aria-label={c.otherLabel} value={value} placeholder={c.otherLabel} autoComplete="off" spellCheck={false} autoFocus className="font-mono text-sm" onChange={(e) => onChange(e.target.value)} />
      )}
      {truncated && !error && <p className="text-sm text-muted-foreground">{c.incomplete}</p>}
    </div>
  );
}
