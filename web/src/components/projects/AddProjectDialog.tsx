import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BranchPicker } from '@/components/projects/BranchPicker';
import { Field, fieldProps } from '@/components/wizard/fields';
import { Stepper } from '@/components/wizard/Stepper';
import { api, ApiError, type FieldErrors, type RepoInspection } from '@/lib/api';
import { copy } from '@/lib/copy';

const c = copy.projects.wizard;

/** Which form fields live on which step, so a server-side error is shown where the user can fix it. */
const STEP_FIELDS: string[][] = [['repo', 'token', 'resolverToken'], ['branch', 'verifyCommand'], []];

interface FormState {
  repo: string;
  token: string;
  separate: boolean;
  resolverToken: string;
  branch: string;
  verifyCommand: string;
  issuesWithoutStack: boolean;
}

const initial = (): FormState => ({ repo: '', token: '', separate: false, resolverToken: '', branch: '', verifyCommand: '', issuesWithoutStack: false });

const pick = (errors: FieldErrors, keys: string[]): FieldErrors => Object.fromEntries(Object.entries(errors).filter(([k]) => keys.includes(k)));
const focusField = (id: string) => setTimeout(() => document.getElementById(`field-${id}`)?.focus(), 0);
const stepOf = (field: string) => STEP_FIELDS.findIndex((fields) => fields.includes(field));

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddProjectDialog({ open, onOpenChange, onAdded }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        // A stray click outside shouldn't throw away a half-filled form (and a pasted token); Esc and the close button still work.
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Mounted only while open, so every open starts clean and no token lingers in state. */}
        <Wizard onClose={() => onOpenChange(false)} onAdded={onAdded} />
      </DialogContent>
    </Dialog>
  );
}

function Wizard({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [found, setFound] = useState<RepoInspection | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<'checking' | 'adding' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setState((s) => ({ ...s, ...patch }));
  const last = step === STEP_FIELDS.length - 1;

  /** Jumps to the earliest step that has an error and focuses its first invalid field. */
  const showErrors = (all: FieldErrors) => {
    const fields = Object.keys(all).sort((a, b) => stepOf(a) - stepOf(b));
    const first = fields[0];
    if (!first) return;
    const target = Math.max(0, stepOf(first));
    setStep(target);
    setErrors(pick(all, STEP_FIELDS[target] ?? []));
    focusField(first);
  };

  const rename = (fields: FieldErrors): FieldErrors => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === 'token' ? 'resolverToken' : k, v]));

  /** Asks GitHub about the repo (and branch). The pull-request token is checked too, as its own field. */
  const inspect = async (withBranch: boolean) => {
    const base = { repo: state.repo, ...(withBranch ? { branch: state.branch } : {}) };
    const main = await api.projects.check({ ...base, token: state.token });
    const extra = state.separate && state.resolverToken.trim() ? await api.projects.check({ ...base, token: state.resolverToken }) : null;
    const fields: FieldErrors = { ...main.fields, ...(extra ? rename(extra.fields) : {}) };
    // A token that cannot push matters for the one that will push: the pull-request token when there is one.
    const warns = (extra ?? main).warnings;
    return { main, fields, warns };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (last) {
      setBusy('adding');
      try {
        const body = { repo: state.repo, branch: state.branch, token: state.token, ...(state.separate && state.resolverToken.trim() ? { resolverToken: state.resolverToken } : {}), ...(state.verifyCommand.trim() ? { verifyCommand: state.verifyCommand } : {}), ...(state.issuesWithoutStack ? { issuesWithoutStack: true } : {}) };
        await api.projects.create(body);
        toast.success(copy.projects.toast.added(state.repo.trim()));
        onAdded();
        onClose();
      } catch (err) {
        if (err instanceof ApiError && Object.keys(err.fields).length > 0) showErrors(err.fields);
        else setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
      return;
    }

    if (step === 0 && (!state.repo.trim() || !state.token.trim() || (state.separate && !state.resolverToken.trim()))) {
      const missing: FieldErrors = {
        ...(state.repo.trim() ? {} : { repo: 'Enter the repository as owner/name, for example acme/web.' }),
        ...(state.token.trim() ? {} : { token: 'Paste a GitHub token. It stays on this computer, encrypted.' }),
        ...(state.separate && !state.resolverToken.trim() ? { resolverToken: 'Paste the token for pull requests, or untick the box to use one token for both.' } : {}),
      };
      setErrors(missing);
      focusField(Object.keys(missing)[0]!);
      return;
    }
    if (step === 1 && !state.branch.trim()) {
      setErrors({ branch: 'Enter the branch to work on, for example main.' });
      focusField('branch');
      return;
    }

    setBusy('checking');
    try {
      const { main, fields, warns } = await inspect(step === 1);
      if (Object.keys(fields).length > 0) {
        setErrors(pick(fields, STEP_FIELDS[step] ?? []));
        focusField(Object.keys(pick(fields, STEP_FIELDS[step] ?? []))[0] ?? STEP_FIELDS[step]![0]!);
        return;
      }
      setErrors({});
      setWarnings(warns);
      if (step === 0) {
        setFound(main);
        // Offer the repo's own default, but it is the user's choice: any branch they type works.
        if (!state.branch) set({ branch: main.repo.defaultBranch ?? main.branches[0] ?? '' });
      }
      setStep(step + 1);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setErrors(pick(err.fields, STEP_FIELDS[step] ?? []));
      else toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const branches = found?.branches ?? [];
  const defaultBranch = found?.repo.defaultBranch;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="space-y-5 px-6 pt-6 pb-4">
        <DialogHeader>
          <DialogTitle>{last ? c.review.title : c.title}</DialogTitle>
          <DialogDescription>{c.description}</DialogDescription>
        </DialogHeader>
        <Stepper steps={c.steps} current={step} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2 sm:min-h-[16rem]">
        {step === 0 && (
          <div className="space-y-5">
            <Field id="repo" label={c.repo.label} help={c.repo.help} error={errors.repo}>
              <Input {...fieldProps('repo', errors.repo, c.repo.help)} value={state.repo} placeholder={c.repo.placeholder} autoComplete="off" spellCheck={false} autoFocus className="font-mono text-sm" onChange={(e) => set({ repo: e.target.value })} />
            </Field>
            <Field id="token" label={c.token.label} help={c.token.help} error={errors.token}>
              <Input {...fieldProps('token', errors.token, c.token.help)} type="password" value={state.token} placeholder={c.token.placeholder} autoComplete="off" spellCheck={false} className="font-mono text-sm" onChange={(e) => set({ token: e.target.value })} />
            </Field>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox id="field-separate" checked={state.separate} onCheckedChange={(v) => set({ separate: v === true })} className="mt-0.5" aria-describedby="help-separate" />
                <div className="space-y-1">
                  <Label htmlFor="field-separate" className="font-normal">
                    {c.separate.label}
                  </Label>
                  <p id="help-separate" className="text-sm text-muted-foreground">
                    {c.separate.help}
                  </p>
                </div>
              </div>
              {state.separate && (
                <Field id="resolverToken" label={c.separate.tokenLabel} error={errors.resolverToken}>
                  <Input {...fieldProps('resolverToken', errors.resolverToken)} type="password" value={state.resolverToken} placeholder={c.token.placeholder} autoComplete="off" spellCheck={false} className="font-mono text-sm" onChange={(e) => set({ resolverToken: e.target.value })} />
                </Field>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Field id="branch" label={c.branch.label} help={c.branch.help} error={errors.branch}>
              <BranchPicker value={state.branch} onChange={(branch) => set({ branch })} branches={branches} defaultBranch={defaultBranch} truncated={found?.branchesTruncated ?? false} error={errors.branch} help={c.branch.help} autoFocus />
            </Field>
            <Field id="verifyCommand" label={copy.projects.verify.label} optional={copy.projects.verify.optional} help={copy.projects.verify.help} error={errors.verifyCommand}>
              <Input {...fieldProps('verifyCommand', errors.verifyCommand, copy.projects.verify.help)} value={state.verifyCommand} placeholder={copy.projects.verify.placeholder} autoComplete="off" spellCheck={false} className="font-mono text-sm" onChange={(e) => set({ verifyCommand: e.target.value })} />
            </Field>
            <div className="flex items-start gap-3">
              <Checkbox id="field-issuesWithoutStack" checked={state.issuesWithoutStack} onCheckedChange={(v) => set({ issuesWithoutStack: v === true })} className="mt-0.5" aria-describedby="help-issuesWithoutStack" />
              <div className="space-y-1">
                <Label htmlFor="field-issuesWithoutStack" className="font-normal">
                  {copy.projects.plainErrors.label}
                </Label>
                <p id="help-issuesWithoutStack" className="text-sm text-muted-foreground">
                  {copy.projects.plainErrors.help}
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <dl className="divide-y rounded-md border text-sm">
              {(
                [
                  [c.review.repo, state.repo.trim()],
                  [c.review.branch, state.branch.trim()],
                  [c.review.token, `••••${state.token.trim().slice(-4)}`],
                  [c.review.prToken, state.separate && state.resolverToken.trim() ? c.review.separateToken : c.review.sameToken],
                  [c.review.verify, state.verifyCommand.trim() || c.review.noVerify],
                  [c.review.plainErrors, state.issuesWithoutStack ? copy.projects.plainErrors.on : copy.projects.plainErrors.off],
                ] as const
              ).map(([term, value]) => (
                <div key={term} className="flex justify-between gap-4 px-3 py-2">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="min-w-0 truncate font-mono">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">{c.review.note}</p>
            {warnings.map((warning) => (
              <Alert key={warning}>
                <AlertTitle>{c.review.warning}</AlertTitle>
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}
            {submitError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 border-t px-6 py-4 sm:justify-between">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy !== null}>
          {c.cancel}
        </Button>
        <div className="flex gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                setErrors({});
                setSubmitError(null);
                setStep(step - 1);
              }}
            >
              {c.back}
            </Button>
          )}
          <Button type="submit" disabled={busy !== null}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy === 'adding' ? c.creating : busy === 'checking' ? c.checking : last ? c.create : c.next}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
