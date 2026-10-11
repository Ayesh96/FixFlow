import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ResolverStatus } from '@/lib/api';
import { startLive, type Live } from '@/lib/live';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reads the resolver's status while the panel is mounted and again whenever a cycle or an attempt changes: when
 * it last ran, whether it is running now, and its counts. (The list of attempts is not read here; nothing on this page shows it.)
 */
export function useResolverAttempts() {
  const [status, setStatus] = useState<ResolverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<Live | null>(null);
  /** Reads again now, e.g. right after starting a run. */
  const refresh = useCallback(async () => void (await live.current?.now()), []);

  useEffect(() => {
    const load = async () => {
      try {
        const next = await api.errorResolver.status();
        setStatus(next);
        setError(null);
      } catch (err) {
        setError(message(err));
      }
    };
    live.current = startLive(load, ['resolver']);
    return () => live.current?.stop();
  }, []);

  return { status, error, refresh };
}
