import { useEffect, useState } from 'react';
import { api, type AttemptPage, type ResolverStatus } from '@/lib/api';

const POLL_MS = 5000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Polls the resolver workflow while the tab is mounted (the Resolver tab unmounts when inactive) and the
 * page is visible. `error` is set when the resolver can't be read; the last good data is kept meanwhile.
 */
export function useResolverAttempts() {
  const [status, setStatus] = useState<ResolverStatus | null>(null);
  const [attempts, setAttempts] = useState<AttemptPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const refresh = async () => {
      const [nextStatus, nextAttempts] = await Promise.allSettled([api.errorResolver.status(), api.errorResolver.attempts()]);
      if (stopped) return;
      if (nextStatus.status === 'fulfilled') setStatus(nextStatus.value);
      if (nextAttempts.status === 'fulfilled') {
        setAttempts(nextAttempts.value);
        setError(null);
      } else {
        setError(message(nextAttempts.reason));
      }
    };
    const tick = async () => {
      if (!document.hidden) await refresh();
      if (!stopped) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { status, attempts, error };
}
