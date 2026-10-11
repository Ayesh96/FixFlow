/** What the poller needs from the page; a seam so it can be tested without a browser. */
export interface PollEnv {
  hidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  /** Calls `fn` when the page becomes visible or hidden; returns the way to stop. */
  onVisibility: (fn: () => void) => () => void;
}

const browser: PollEnv = {
  hidden: () => document.hidden,
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id as number),
  onVisibility: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
};

export interface Poller {
  /** Loads now (joining a load already under way) and keeps the schedule going. */
  now: () => Promise<void>;
  stop: () => void;
}

/**
 * Runs `load` now and then again after `delay()` for as long as the page is visible.
 *
 * There is only ever one load in flight and one timer pending, whatever happens: coming back to the tab
 * while a load is running joins it instead of starting a second chain, and a hidden page schedules nothing.
 * The delay is asked for afresh each time, so it can be short while something is changing and long when idle.
 */
export function startPolling(load: () => Promise<void>, delay: () => number, env: PollEnv = browser): Poller {
  let stopped = false;
  let timer: unknown;
  let inflight: Promise<void> | null = null;
  let last = 0;

  const run = (): Promise<void> => {
    inflight ??= load()
      .catch(() => undefined) // the hooks keep their own error state; a failed poll just tries again later
      .finally(() => {
        inflight = null;
        last = env.now();
      });
    return inflight;
  };
  const schedule = () => {
    env.clearTimer(timer);
    if (stopped || env.hidden()) return;
    timer = env.setTimer(() => void run().then(schedule), delay());
  };
  const onVisibility = () => {
    if (stopped) return;
    if (env.hidden()) return env.clearTimer(timer);
    // Back on the page: refresh only if what is shown has gone stale, otherwise carry on as before.
    if (env.now() - last >= delay()) void run().then(schedule);
    else schedule();
  };
  const unsubscribe = env.onVisibility(onVisibility);
  if (!env.hidden()) void run().then(schedule);

  return {
    now: () => run().then(schedule),
    stop: () => {
      stopped = true;
      env.clearTimer(timer);
      unsubscribe();
    },
  };
}
