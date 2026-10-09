import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TrackerProjectGroup, type TrackerStatus } from '@/lib/api';

const POLL_MS = 5000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Polls the errors workflow while the tab is mounted (the Errors tab unmounts when inactive) and the
 * page is visible. `error` is set when the errors can't be read; the last good list is kept meanwhile.
 */
export function useErrorGroups() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [groups, setGroups] = useState<TrackerProjectGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshNow = useRef<() => Promise<void>>(async () => {});
  /** Reads the errors straight away, e.g. right after an action that changes one. */
  const refresh = useCallback(() => refreshNow.current(), []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const load = async () => {
      const [nextStatus, nextGroups] = await Promise.allSettled([api.errorTracker.status(), api.errorTracker.projects()]);
      if (stopped) return;
      if (nextStatus.status === 'fulfilled') setStatus(nextStatus.value);
      if (nextGroups.status === 'fulfilled') {
        setGroups(nextGroups.value);
        setError(null);
      } else {
        setError(message(nextGroups.reason));
      }
    };
    refreshNow.current = load;
    const tick = async () => {
      if (!document.hidden) await load();
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

  return { status, groups, error, refresh };
}
