import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { COOKIE_NAME } from '../server/auth.ts';
import { ChangeBus } from '../server/events.ts';
import { freePort, tempConfig } from './helpers.ts';

const TOKEN = 'T'.repeat(43);

describe('live events', () => {
  const bus = new ChangeBus();
  let server: Server;
  let base: string;

  before(async () => {
    const port = await freePort();
    const config = await tempConfig({ port });
    server = createApp({ port, publicDir: config.home, token: TOKEN, events: bus }).listen(port, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${port}`;
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it('needs the login cookie like the rest of the API', async () => {
    assert.equal((await fetch(`${base}/api/events`)).status, 401);
  });

  it('streams a change message for each topic published, and lets go of the listener when the page leaves', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { headers: { cookie: `${COOKIE_NAME}=${TOKEN}` }, signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const until = async (pattern: RegExp) => {
      while (!pattern.test(received)) received += decoder.decode((await reader.read()).value);
    };

    await until(/retry: 2000/);
    bus.publish('errors');
    bus.publish('resolver');
    await until(/"topic":"resolver"/);
    assert.match(received, /event: change\ndata: {"topic":"errors"}\n\n/);

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    let delivered = 0;
    const unsubscribe = bus.subscribe(() => delivered++);
    bus.publish('errors'); // would throw on a write to the closed response if the listener were still attached
    unsubscribe();
    assert.equal(delivered, 1);
  });
});
