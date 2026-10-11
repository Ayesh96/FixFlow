import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TrackerProjectGroup, type TrackerStatus } from '@/lib/api';
import { startLive, type Live } from '@/lib/live';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reads the errors workflow while the panel is mounted and again whenever the server says an error changed.
 * `error` is set when the errors can't be read; the last good list is kept meanwhile.
 */
export function useErrorGroups() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [groups, setGroups] = useState<TrackerProjectGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<Live | null>(null);
  /** Reads the errors straight away, e.g. right after an action that changes one. */
  const refresh = useCallback(async () => void (await live.current?.now()), []);

  useEffect(() => {
    const load = async () => {
      const [nextStatus, nextGroups] = await Promise.allSettled([api.errorTracker.status(), api.errorTracker.projects()]);
      if (nextStatus.status === 'fulfilled') setStatus(nextStatus.value);
      if (nextGroups.status === 'fulfilled') {
        setGroups(nextGroups.value);
        setError(null);
      } else {
        setError(message(nextGroups.reason));
      }
    };
    live.current = startLive(load, ['errors']);
    return () => live.current?.stop();
  }, []);

  return { status, groups, error, refresh };
}
