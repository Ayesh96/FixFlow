import { Settings } from 'lucide-react';
import { useState } from 'react';
import { CodeBlock } from '@/components/projects/CodeBlock';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { copy } from '@/lib/copy';

declare global {
  interface Window {
    /** Present only inside the desktop app (desktop/dashboard-preload.js). */
    fixflowDesktop?: { openSettings: () => Promise<void> };
  }
}

/** Opens the settings screen in the desktop app; in a browser, explains how to change them. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const desktop = window.fixflowDesktop;
  const c = copy.settings;

  return (
    <>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => (desktop ? void desktop.openSettings() : setOpen(true))}>
        <Settings aria-hidden />
        {c.button}
      </Button>
      {!desktop && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{c.title}</DialogTitle>
              <DialogDescription>{c.browserHelp}</DialogDescription>
            </DialogHeader>
            <CodeBlock code="npm run setup" label={c.command} />
            <p className="text-sm text-muted-foreground">{c.browserAfter}</p>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
