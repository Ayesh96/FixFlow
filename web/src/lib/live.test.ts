import { describe, expect, it } from 'vitest';
import { startLive, type LiveEnv, type Topic } from './live';

/** A stream and page the test drives by hand. */
function fakeEnv() {
  let onOpen = () => {};
  let onChange: (topic: Topic) => void = () => {};
  const visible = new Set<() => void>();
  let connections = 0;
  let closed = 0;
  const env: LiveEnv = {
    connect: (open, change) => {
      connections++;
      onOpen = open;
      onChange = change;
      return () => void closed++;
    },
    hidden: () => false,
    onVisible: (fn) => {
      visible.add(fn);
      return () => visible.delete(fn);
    },
  };
  return {
    env,
    open: () => onOpen(),
    change: (topic: Topic) => onChange(topic),
    show: () => visible.forEach((fn) => fn()),
    connections: () => connections,
    closed: () => closed,
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('startLive', () => {
  it('loads at once, then on a change to one of its topics, and ignores the others', async () => {
    const page = fakeEnv();
    let calls = 0;
    startLive(async () => void calls++, ['errors'], page.env);
    await settle();
    expect(calls).toBe(1);
    page.change('projects');
    await settle();
    expect(calls).toBe(1);
    page.change('errors');
    await settle();
    expect(calls).toBe(2);
  });

  it('does not read twice for the first open, but reads again on a reconnect', async () => {
    const page = fakeEnv();
    let calls = 0;
    startLive(async () => void calls++, ['errors'], page.env);
    page.open();
    await settle();
    expect(calls).toBe(1);
    page.open();
    await settle();
    expect(calls).toBe(2);
  });

  it('runs once more, not once per message, when changes arrive during a load', async () => {
    const page = fakeEnv();
    let calls = 0;
    let finish: () => void = () => {};
    startLive(
      () => {
        calls++;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      ['errors'],
      page.env,
    );
    page.change('errors');
    page.change('errors');
    page.change('errors');
    expect(calls).toBe(1);
    finish();
    await settle();
    expect(calls).toBe(2);
    finish();
    await settle();
    expect(calls).toBe(2);
  });

  it('reads again when the tab comes back', async () => {
    const page = fakeEnv();
    let calls = 0;
    startLive(async () => void calls++, ['errors'], page.env);
    await settle();
    page.show();
    await settle();
    expect(calls).toBe(2);
  });

  it('shares one stream between views and closes it with the last one', async () => {
    const page = fakeEnv();
    const a = startLive(async () => {}, ['errors'], page.env);
    const b = startLive(async () => {}, ['projects'], page.env);
    expect(page.connections()).toBe(1);
    a.stop();
    expect(page.closed()).toBe(0);
    b.stop();
    expect(page.closed()).toBe(1);
  });

  it('does nothing after stop', async () => {
    const page = fakeEnv();
    let calls = 0;
    const live = startLive(async () => void calls++, ['errors'], page.env);
    await settle();
    live.stop();
    page.change('errors');
    page.show();
    await settle();
    expect(calls).toBe(1);
  });
});
