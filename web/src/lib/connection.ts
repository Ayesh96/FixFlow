import type { TrackerProjectGroup } from '@/lib/api';

export interface Connection {
  /** An app has reported at least once. That is the proof that it is connected, not a setting someone ticked. */
  connected: boolean;
  events: number;
  /** When the most recent event arrived; null while none has. */
  lastSeen: string | null;
  /** The apps that have reported, by the `service` tag they set; empty when none tag themselves. */
  apps: string[];
  /** The latest refusal, while no event has got through since; null once an app is reporting again. */
  refusal: { status: number; reason: string; at: string; count: number } | null;
}

export function connectionOf(group: TrackerProjectGroup | undefined): Connection {
  const events = group?.eventCount ?? 0;
  const apps = [...new Set((group?.issues ?? []).map((i) => i.service).filter((s): s is string => s !== null && s !== ''))].sort();
  const lastSeen = group?.lastSeen ?? null;
  const last = group?.rejections?.last ?? null;
  // An event newer than the refusal means the problem has passed (or was another app's); stop warning.
  const refusal = last && (lastSeen === null || last.at > lastSeen) ? { ...last, count: group?.rejections.count ?? 1 } : null;
  return { connected: events > 0, events, lastSeen, apps, refusal };
}
