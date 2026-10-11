import type { Topic } from '@server/events.ts';

export type { Topic };

/** What a live view needs from the page; a seam so it can be tested without a browser. */
export interface LiveEnv {
  /**
   * Opens the server's stream and calls `onOpen` each time it (re)connects and `onChange` for each message.
   * Returns the way to close it.
   */
  connect: (onOpen: () => void, onChange: (topic: Topic) => void) => () => void;
  hidden: () => boolean;
  /** Calls `fn` when the page becomes visible; returns the way to stop. */
  onVisible: (fn: () => void) => () => void;
}

const browser: LiveEnv = {
  connect: (onOpen, onChange) => {
    // Same origin, so the login cookie goes with it. The browser reconnects by itself when the stream drops.
    const source = new EventSource('/api/events');
    source.onopen = onOpen;
    source.addEventListener('change', (event) => {
      try {
        onChange((JSON.parse((event as MessageEvent<string>).data) as { topic: Topic }).topic);
      } catch {
        // A message we cannot read is not worth acting on.
      }
    });
    return () => source.close();
  },
  hidden: () => document.hidden,
  onVisible: (fn) => {
    const listener = () => {
      if (!document.hidden) fn();
    };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

/** One stream is shared by every view, since browsers allow only a handful of connections to one server. */
interface Shared {
  open: () => void;
  change: (topic: Topic) => void;
}
const shared = new WeakMap<LiveEnv, { listeners: Set<Shared>; close: () => void }>();

function subscribe(env: LiveEnv, listener: Shared): () => void {
  let entry = shared.get(env);
  if (!entry) {
    const listeners = new Set<Shared>();
    const close = env.connect(
      () => listeners.forEach((l) => l.open()),
      (topic) => listeners.forEach((l) => l.change(topic)),
    );
    entry = { listeners, close };
    shared.set(env, entry);
  }
  entry.listeners.add(listener);
  return () => {
    const current = shared.get(env);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.close();
      shared.delete(env);
    }
  };
}

export interface Live {
  /** Loads now (joining a load already under way). */
  now: () => Promise<void>;
  stop: () => void;
}

/**
 * Runs `load` now and again whenever the server says one of `topics` changed, instead of asking on a timer.
 *
 * There is only ever one load in flight: a change that arrives during one makes it run once more when it ends,
 * so a burst costs two reads at most and what is shown is never older than the last message. It also reads
 * again when the stream reconnects (changes may have been missed meanwhile) and when the tab comes back.
 */
export function startLive(load: () => Promise<void>, topics: Topic[], env: LiveEnv = browser): Live {
  let stopped = false;
  let inflight: Promise<void> | null = null;
  let again = false;
  let opens = 0;

  const run = (): Promise<void> => {
    inflight ??= load()
      .catch(() => undefined) // the hooks keep their own error state; the next change or reconnect tries again
      .finally(() => {
        inflight = null;
        if (again && !stopped) {
          again = false;
          void run();
        }
      });
    return inflight;
  };
  /** Like `run`, but a request made mid-load is remembered rather than dropped. */
  const request = (): void => {
    if (stopped) return;
    if (inflight) again = true;
    else void run();
  };

  const unsubscribe = subscribe(env, {
    // The first open is the stream catching up with the load below; only a reconnect needs a read.
    open: () => (opens++ > 0 ? request() : undefined),
    change: (topic) => (topics.includes(topic) ? request() : undefined),
  });
  const stopVisible = env.onVisible(request);
  void run();

  return {
    now: () => run(),
    stop: () => {
      stopped = true;
      unsubscribe();
      stopVisible();
    },
  };
}
