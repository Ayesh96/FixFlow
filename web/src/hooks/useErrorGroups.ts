import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TrackerProjectGroup, type TrackerStatus } from '@/lib/api';
import { startPolling, type Poller } from '@/lib/poll';

/** Quickly while an error is being read, slowly otherwise. Actions that change something refresh straight away. */
const ACTIVE_MS = 3000;
const IDLE_MS = 15000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Polls the errors workflow while the panel is mounted and the page is visible. `error` is set when the errors
 * can't be read; the last good list is kept meanwhile.
 */
export function useErrorGroups() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [groups, setGroups] = useState<TrackerProjectGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poller = useRef<Poller | null>(null);
  const busy = useRef(false);
  /** Reads the errors straight away, e.g. right after an action that changes one. */
  const refresh = useCallback(async () => void (await poller.current?.now()), []);

  useEffect(() => {
    const load = async () => {
      const [nextStatus, nextGroups] = await Promise.allSettled([api.errorTracker.status(), api.errorTracker.projects()]);
      if (nextStatus.status === 'fulfilled') setStatus(nextStatus.value);
      if (nextGroups.status === 'fulfilled') {
        setGroups(nextGroups.value);
        setError(null);
        // Something is moving if an error is being triaged or the resolver is working on one.
        busy.current = nextGroups.value.some((g) => g.issues.some((i) => i.triageStatus === 'PENDING' || i.resolverStatus === 'IN_PROGRESS'));
      } else {
        setError(message(nextGroups.reason));
      }
    };
    poller.current = startPolling(load, () => (busy.current ? ACTIVE_MS : IDLE_MS));
    return () => poller.current?.stop();
  }, []);

  return { status, groups, error, refresh };
}
