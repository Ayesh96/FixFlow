import type { Logger } from '../types.ts';

/** How many refusals are remembered per project; older ones fall away. */
export const REJECTIONS_KEPT_PER_PROJECT = 5;
/** At most one log line per project and status in this window, so a looping app cannot flood the console. */
export const REJECTIONS_LOG_INTERVAL_MS = 60_000;
/** At most one dashboard nudge in this window; the last refusal in a burst still gets one at the end. */
export const REJECTIONS_NOTIFY_INTERVAL_MS = 2_000;
/** Project ids come from the URL, so anyone who can reach the port picks them; stop tracking new ones past this. */
const MAX_TRACKED_PROJECTS = 500;

/** One refused request: what the SDK was told, and when. */
export interface Rejection {
  status: number;
  reason: string;
  /** ISO timestamp. */
  at: string;
}

export interface RejectionSummary {
  /** Refusals since the process started, not only the ones still remembered. */
  count: number;
  last: Rejection | null;
}

interface Tally {
  count: number;
  recent: Rejection[];
  loggedAt: Map<number, number>;
}

export interface RejectionsOptions {
  logger?: Pick<Logger, 'warn'>;
  /** Told when a refusal is recorded (throttled), so the dashboard can re-read. */
  onChange?: () => void;
  /** A seam for tests. */
  now?: () => number;
}

/**
 * Remembers the requests the ingest listener turned away. An SDK drops a refusal silently, so without
 * this a wrong key or an oversized payload looks exactly like an app that has nothing to report.
 *
 * In memory only: a refusal is a live symptom, not history worth a migration. A refusal with no project
 * id (a path that names none) is counted and logged but belongs to no project's card.
 */
export class Rejections {
  private readonly byProject = new Map<string | null, Tally>();
  private readonly logger?: Pick<Logger, 'warn'>;
  private readonly onChange?: () => void;
  private readonly now: () => number;
  private notifiedAt = -Infinity;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RejectionsOptions = {}) {
    this.logger = options.logger;
    this.onChange = options.onChange;
    this.now = options.now ?? Date.now;
  }

  record(projectId: string | null, status: number, reason: string): void {
    const now = this.now();
    let tally = this.byProject.get(projectId);
    if (!tally) {
      if (this.byProject.size >= MAX_TRACKED_PROJECTS) return;
      tally = { count: 0, recent: [], loggedAt: new Map() };
      this.byProject.set(projectId, tally);
    }
    tally.count += 1;
    tally.recent.push({ status, reason, at: new Date(now).toISOString() });
    if (tally.recent.length > REJECTIONS_KEPT_PER_PROJECT) tally.recent.shift();

    const lastLogged = tally.loggedAt.get(status);
    if (lastLogged === undefined || now - lastLogged >= REJECTIONS_LOG_INTERVAL_MS) {
      tally.loggedAt.set(status, now);
      this.logger?.warn(`refused an event${projectId === null ? '' : ` for project ${projectId}`}: ${status} ${reason} (${tally.count} since startup)`);
    }
    this.notify(now);
  }

  /** The most recent refusals for a project, newest last. */
  recent(projectId: string | null): Rejection[] {
    return [...(this.byProject.get(projectId)?.recent ?? [])];
  }

  summary(projectId: string | null): RejectionSummary {
    const tally = this.byProject.get(projectId);
    return { count: tally?.count ?? 0, last: tally?.recent.at(-1) ?? null };
  }

  private notify(now: number): void {
    if (!this.onChange || this.notifyTimer) return;
    const wait = this.notifiedAt + REJECTIONS_NOTIFY_INTERVAL_MS - now;
    const fire = (): void => {
      this.notifyTimer = null;
      this.notifiedAt = this.now();
      this.onChange?.();
    };
    if (wait <= 0) fire();
    else this.notifyTimer = setTimeout(fire, wait).unref();
  }
}
