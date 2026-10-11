import { describe, expect, it } from 'vitest';
import { startPolling, type PollEnv } from './poll';

/** A clock and timer queue the test drives by hand. */
function fakeEnv() {
  let time = 0;
  let hidden = false;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const listeners = new Set<() => void>();
  const env: PollEnv = {
    hidden: () => hidden,
    now: () => time,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
    onVisibility: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    env,
    pending: () => timers.size,
    setHidden(value: boolean) {
      hidden = value;
      listeners.forEach((fn) => fn());
    },
    async advance(ms: number) {
      time += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= time) {
          timers.delete(id);
          t.fn();
        }
      }
      for (let i = 0; i < 10; i++) await Promise.resolve(); // let the load's promise chain settle
    },
  };
}

describe('startPolling', () => {
  it('loads at once, then again after the delay, with one timer pending', async () => {
    const page = fakeEnv();
    let calls = 0;
    startPolling(async () => void calls++, () => 1000, page.env);
    await page.advance(0);
    expect(calls).toBe(1);
    expect(page.pending()).toBe(1);
    await page.advance(1000);
    expect(calls).toBe(2);
  });

  it('does not start a second chain when the page comes back while a load is running', async () => {
    const page = fakeEnv();
    let calls = 0;
    let finish: () => void = () => {};
    startPolling(
      () => {
        calls++;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      () => 1000,
      page.env,
    );
    page.setHidden(true);
    page.setHidden(false); // back while the first load is still in flight
    expect(calls).toBe(1);
    finish();
    await page.advance(0);
    expect(page.pending()).toBe(1); // a single timer, not two chains
  });

  it('schedules nothing while hidden, and refreshes on return only if stale', async () => {
    const page = fakeEnv();
    let calls = 0;
    startPolling(async () => void calls++, () => 1000, page.env);
    await page.advance(0);
    page.setHidden(true);
    expect(page.pending()).toBe(0);
    page.setHidden(false); // came straight back: not stale, so no extra load
    expect(calls).toBe(1);
    page.setHidden(true);
    await page.advance(5000);
    page.setHidden(false); // away a while: stale, loads
    await page.advance(0);
    expect(calls).toBe(2);
  });

  it('stops for good', async () => {
    const page = fakeEnv();
    let calls = 0;
    const poller = startPolling(async () => void calls++, () => 1000, page.env);
    await page.advance(0);
    poller.stop();
    await page.advance(10_000);
    expect(calls).toBe(1);
    expect(page.pending()).toBe(0);
  });
});
