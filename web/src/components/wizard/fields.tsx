import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** Props that wire an input to its label, help text and error message for assistive tech. */
export function fieldProps(id: string, error?: string, help?: string) {
  return {
    id: `field-${id}`,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `err-${id}` : help ? `help-${id}` : undefined,
  } as const;
}

interface FieldProps {
  id: string;
  label: string;
  optional?: string;
  help?: string;
  error?: string | undefined;
  children: ReactNode;
}

export function Field({ id, label, optional, help, error, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`field-${id}`}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">{optional}</span>}
      </Label>
      {children}
      {error ? (
        <p id={`err-${id}`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        help && (
          <p id={`help-${id}`} className="text-sm text-muted-foreground">
            {help}
          </p>
        )
      )}
    </div>
  );
}
