import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ResolverStatus } from '@/lib/api';
import { startPolling, type Poller } from '@/lib/poll';

const ACTIVE_MS = 3000;
const IDLE_MS = 15000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Polls the resolver's status while the panel is mounted and the page is visible: when it last ran, whether it
 * is running now, and its counts. (The list of attempts is not read here; nothing on this page shows it.)
 */
export function useResolverAttempts() {
  const [status, setStatus] = useState<ResolverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poller = useRef<Poller | null>(null);
  const running = useRef(false);
  /** Reads again now, e.g. right after starting a run. */
  const refresh = useCallback(async () => void (await poller.current?.now()), []);

  useEffect(() => {
    const load = async () => {
      try {
        const next = await api.errorResolver.status();
        setStatus(next);
        setError(null);
        running.current = next.polling;
      } catch (err) {
        setError(message(err));
      }
    };
    poller.current = startPolling(load, () => (running.current ? ACTIVE_MS : IDLE_MS));
    return () => poller.current?.stop();
  }, []);

  return { status, error, refresh };
}
