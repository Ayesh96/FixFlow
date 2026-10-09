import type { TrackerProjectGroup } from '@/lib/api';

export interface Connection {
  /** An app has reported at least once. That is the proof that it is connected, not a setting someone ticked. */
  connected: boolean;
  events: number;
  /** When the most recent event arrived; null while none has. */
  lastSeen: string | null;
  /** The apps that have reported, by the `service` tag they set; empty when none tag themselves. */
  apps: string[];
}

export function connectionOf(group: TrackerProjectGroup | undefined): Connection {
  const events = group?.eventCount ?? 0;
  const apps = [...new Set((group?.issues ?? []).map((i) => i.service).filter((s): s is string => s !== null && s !== ''))].sort();
  return { connected: events > 0, events, lastSeen: group?.lastSeen ?? null, apps };
}
