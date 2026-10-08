import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BranchPicker } from '@/components/projects/BranchPicker';
import { Field, fieldProps } from '@/components/wizard/fields';
import { api, ApiError, type FieldErrors, type ProjectView } from '@/lib/api';
import { copy } from '@/lib/copy';

const c = copy.projects;
const s = c.settings;

interface Props {
  /** The project being edited; null keeps the dialog closed. */
  project: ProjectView | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProjectSettingsDialog({ project, onClose, onSaved }: Props) {
  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        {/* Keyed by project so each one starts from its own saved values, and no typed token outlives the dialog. */}
        {project && <SettingsForm key={project.id} project={project} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ project, onClose, onSaved }: { project: ProjectView; onClose: () => void; onSaved: () => void }) {
  const [branch, setBranch] = useState(project.branch ?? '');
  const [token, setToken] = useState('');
  const [prToken, setPrToken] = useState('');
  const [useMain, setUseMain] = useState(false);
  const [verifyCommand, setVerifyCommand] = useState(project.verifyCommand ?? '');
  const [plainErrors, setPlainErrors] = useState(project.issuesWithoutStack);
  const [list, setList] = useState<{ branches: string[]; defaultBranch: string | null; truncated: boolean } | 'loading'>('loading');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // The dropdown is filled from the repo itself. When GitHub will not say, it falls back to a text box.
  useEffect(() => {
    let current = true;
    api.projects.branches(project.id).then(
      (found) => current && setList(found),
      () => current && setList({ branches: [], defaultBranch: null, truncated: false }),
    );
    return () => {
      current = false;
    };
  }, [project.id]);

  /** Only what the user changed is sent, so an untouched token is never replaced and GitHub is only asked when it must be. */
  const changes = () => ({
    ...(branch.trim() !== (project.branch ?? '') ? { branch } : {}),
    ...(token.trim() ? { token } : {}),
    ...(useMain ? { resolverToken: '' } : prToken.trim() ? { resolverToken: prToken } : {}),
    ...(verifyCommand.trim() !== (project.verifyCommand ?? '') ? { verifyCommand } : {}),
    ...(plainErrors !== project.issuesWithoutStack ? { issuesWithoutStack: plainErrors } : {}),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    const body = changes();
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await api.projects.update(project.id, body);
      toast.success(c.toast.saved(project.repo));
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        setErrors(err.fields);
        setTimeout(() => document.getElementById(`field-${Object.keys(err.fields)[0]}`)?.focus(), 0);
      } else {
        toast.error(c.toast.failed('save', project.repo), { description: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <DialogHeader>
        <DialogTitle>{s.title(project.repo)}</DialogTitle>
        <DialogDescription>{s.description}</DialogDescription>
      </DialogHeader>

      <Field id="branch" label={s.branch.label} help={s.branch.help} error={errors.branch}>
        <BranchPicker value={branch} onChange={setBranch} branches={list === 'loading' ? [] : list.branches} defaultBranch={list === 'loading' ? null : list.defaultBranch} truncated={list !== 'loading' && list.truncated} loading={list === 'loading'} error={errors.branch} help={s.branch.help} />
      </Field>

      <Field id="token" label={s.token.label} help={s.token.help} error={errors.token}>
        <Input {...fieldProps('token', errors.token, s.token.help)} type="password" value={token} placeholder={s.token.keep(project.tokenHint)} autoComplete="off" spellCheck={false} className="font-mono text-sm" onChange={(e) => setToken(e.target.value)} />
      </Field>

      <div className="space-y-3">
        <Field id="resolverToken" label={s.prToken.label} help={project.hasResolverToken ? s.prToken.helpSeparate : s.prToken.helpNone} error={errors.resolverToken}>
          <Input {...fieldProps('resolverToken', errors.resolverToken, project.hasResolverToken ? s.prToken.helpSeparate : s.prToken.helpNone)} type="password" value={prToken} disabled={useMain} placeholder={project.hasResolverToken ? s.prToken.keep : c.wizard.token.placeholder} autoComplete="off" spellCheck={false} className="font-mono text-sm" onChange={(e) => setPrToken(e.target.value)} />
        </Field>
        {project.hasResolverToken && (
          <div className="flex items-center gap-3">
            <Checkbox id="field-useMain" checked={useMain} onCheckedChange={(v) => setUseMain(v === true)} />
            <Label htmlFor="field-useMain" className="font-normal">
              {s.prToken.useMain}
            </Label>
          </div>
        )}
      </div>

      <Field id="verifyCommand" label={c.verify.label} optional={c.verify.optional} help={c.verify.help} error={errors.verifyCommand}>
        <Input {...fieldProps('verifyCommand', errors.verifyCommand, c.verify.help)} value={verifyCommand} placeholder={c.verify.placeholder} autoComplete="off" spellCheck={false} className="font-mono text-sm" onChange={(e) => setVerifyCommand(e.target.value)} />
      </Field>

      <div className="flex items-start gap-3">
        <Checkbox id="field-issuesWithoutStack" checked={plainErrors} onCheckedChange={(v) => setPlainErrors(v === true)} className="mt-0.5" aria-describedby="help-issuesWithoutStack" />
        <div className="space-y-1">
          <Label htmlFor="field-issuesWithoutStack" className="font-normal">
            {c.plainErrors.label}
          </Label>
          <p id="help-issuesWithoutStack" className="text-sm text-muted-foreground">
            {c.plainErrors.help}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {s.cancel}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {saving ? s.saving : s.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
