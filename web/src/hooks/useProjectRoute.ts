import { useEffect, useState } from 'react';

const PATTERN = /^#\/projects\/([^/?#]+)/;
/** The project id in a `#/projects/<id>` hash, or null for anything else (including a malformed escape). */
export const projectIdFromHash = (hash: string): string | null => {
  const match = PATTERN.exec(hash);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** The project whose page is open (`#/projects/<id>`), or null on the list. A hash route needs no server support and survives a reload. */
export function useProjectRoute(): string | null {
  const [id, setId] = useState<string | null>(() => projectIdFromHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setId(projectIdFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return id;
}

export const projectHref = (id: string): string => `#/projects/${encodeURIComponent(id)}`;
export const LIST_HREF = '#/';
