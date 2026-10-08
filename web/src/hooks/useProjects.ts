import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectList } from '@/lib/api';

/** Quickly while a clone is running, so progress feels live; slowly otherwise. */
const BUSY_MS = 1500;
const IDLE_MS = 6000;

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
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const next = await api.projects.list();
        if (stopped) return;
        setData(next);
        setError(null);
        for (const project of next.projects) {
          const was = previous.current[project.id];
          if (was === 'working' && project.setup.state === 'ready') setAnnouncement(`${project.repo} is cloned and ready`);
          if (was === 'working' && project.setup.state === 'failed') setAnnouncement(`Cloning ${project.repo} failed`);
          previous.current[project.id] = project.setup.state;
        }
      } catch (err) {
        if (!stopped) setError(message(err));
      }
    };
    refreshRef.current = refresh;

    const tick = async () => {
      if (!document.hidden) await refresh();
      if (stopped) return;
      const working = Object.values(previous.current).includes('working');
      timer = window.setTimeout(() => void tick(), working ? BUSY_MS : IDLE_MS);
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

  const refresh = useCallback(() => refreshRef.current(), []);
  return { data, error, announcement, refresh };
}
