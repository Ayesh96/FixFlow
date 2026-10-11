import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectList } from '@/lib/api';
import { startLive, type Live } from '@/lib/live';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reads the project list while the Projects tab is mounted and again whenever a project or its clone changes. `announcement` is
 * a sentence for a screen reader when a clone finishes or fails, since numbers changing silently
 * on screen are not heard.
 */
export function useProjects() {
  const [data, setData] = useState<ProjectList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<Record<string, string>>({});
  const live = useRef<Live | null>(null);
  const refresh = useCallback(async () => void (await live.current?.now()), []);

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
    live.current = startLive(load, ['projects']);
    return () => live.current?.stop();
  }, []);

  return { data, error, announcement, refresh };
}
