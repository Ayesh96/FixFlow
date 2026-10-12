import { Layers, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PANELS } from '@/components/extensions';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsButton } from '@/components/SettingsButton';
import { Toaster } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, ApiError, type ExtensionInfo } from '@/lib/api';
import { copy } from '@/lib/copy';

type Load = { state: 'loading' } | { state: 'ready'; extensions: ExtensionInfo[] } | { state: 'locked' } | { state: 'offline' };

export default function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tab, setTab] = useState('projects');

  // One tab per workflow the server loaded that the UI knows how to show. A 401 means the one-time login link was never opened.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const fetchTabs = () =>
      api.extensions().then(
        (list) => !stopped && setLoad({ state: 'ready', extensions: list.filter((e) => e.id in PANELS) }),
        (err: unknown) => {
          if (stopped) return;
          if (err instanceof ApiError && err.status === 401) return setLoad({ state: 'locked' });
          setLoad({ state: 'offline' });
          timer = window.setTimeout(fetchTabs, 5000); // the server may just be restarting
        },
      );
    void fetchTabs();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  const extensions = load.state === 'ready' ? load.extensions : [];

  return (
    <TooltipProvider delayDuration={150}>
      <Tabs value={tab} onValueChange={setTab} className="min-h-screen gap-0">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[2000px] items-center gap-3 px-4 sm:px-8">
            <Layers className="size-5" aria-hidden />
            <span className="font-semibold tracking-tight">{copy.name}</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">{copy.tagline}</span>
            {load.state === 'ready' && <SettingsButton />}
          </div>
          {extensions.length > 1 && (
            <div className="mx-auto max-w-[2000px] overflow-x-auto px-4 sm:px-8">
              <TabsList aria-label={copy.tabs.label} className="h-10 w-fit gap-1 rounded-none bg-transparent p-0">
                {extensions.map((e) => (
                  <TabsTrigger
                    key={e.id}
                    value={e.id}
                    className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-3 text-muted-foreground shadow-none transition-colors duration-150 hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-foreground"
                  >
                    {e.title}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          )}
          {load.state === 'offline' && (
            <p role="status" className="border-t border-status-crashed/40 bg-status-crashed/10 px-4 py-2 text-center text-sm">
              {copy.offline}
            </p>
          )}
        </header>

        <main className="mx-auto max-w-[2000px] space-y-6 px-4 py-8 sm:px-8">
          {load.state === 'loading' && (
            <div className="space-y-3" aria-busy="true" aria-label="Loading">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {load.state === 'locked' && (
            <Card className="gap-3 px-6 py-16 text-center">
              <Lock className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <h2 className="text-base font-semibold">{copy.locked.title}</h2>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">{copy.locked.body}</p>
            </Card>
          )}

          {extensions.map((e) => {
            const Panel = PANELS[e.id];
            return (
              Panel && (
                <TabsContent key={e.id} value={e.id} className="space-y-6">
                  <Panel />
                </TabsContent>
              )
            );
          })}
        </main>
      </Tabs>
      <Toaster />
    </TooltipProvider>
  );
}
