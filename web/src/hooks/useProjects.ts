import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectList } from '@/lib/api';
import { startPolling, type Poller } from '@/lib/poll';

/** Quickly while a clone is running, so progress feels live; slowly otherwise. */
const BUSY_MS = 2000;
const IDLE_MS = 15000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Polls the project list while the Projects tab is mounted and the page is visible. `announcement` is
 * a sentence for a screen reader when a clone finishes or fails, since numbers changing silently
 * on screen are not heard.
 */
export function useProjects() {
  const [data, setData] = useState<ProjectList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<Record<string, string>>({});
  const poller = useRef<Poller | null>(null);
  const refresh = useCallback(async () => void (await poller.current?.now()), []);

  useEffect(() => {
    const load = async () => {
      try {
        const next = await api.projects.list();
        setData(next);
        setError(null);
        for (const project of next.projects) {
          const was = previous.current[project.id];
          if (was === 'working' && project.setup.state === 'ready') setAnnouncement(`${project.repo} is cloned and ready`);
          if (was === 'working' && project.setup.state === 'failed') setAnnouncement(`Cloning ${project.repo} failed`);
          previous.current[project.id] = project.setup.state;
        }
      } catch (err) {
        setError(message(err));
      }
    };
    poller.current = startPolling(load, () => (Object.values(previous.current).includes('working') ? BUSY_MS : IDLE_MS));
    return () => poller.current?.stop();
  }, []);

  return { data, error, announcement, refresh };
}
