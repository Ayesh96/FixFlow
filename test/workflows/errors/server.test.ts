import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { createIngestApp } from '../../../server/ingest.ts';
import { ingestRoutes, type EventSink } from '../../../server/workflows/errors/ingestRoutes.ts';
import type { NormalizedEvent } from '../../../server/workflows/errors/types.ts';
import type { Workflow } from '../../../server/workflows/types.ts';
import { listen, type Listening } from '../helpers.ts';
import { envelope, jsEvent, pyEvent } from './fixtures.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Mounts just the ingest routes on the real public app, so the error handling under test is the real one. */
function ingestOnly(sink: EventSink, dsnPublicKey: string | null = null) {
  const workflow: Workflow = {
    id: 'errors',
    title: 'Errors',
    routes: () => {},
    ingestRoutes: (router) => ingestRoutes(router, sink, dsnPublicKey),
  };
  return createIngestApp([workflow]) as NonNullable<ReturnType<typeof createIngestApp>>;
}

describe('HTTP ingestion', () => {
  let server: Listening | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  /** Starts the ingest listener and returns helpers bound to it. */
  async function start(dsnPublicKey: string | null = null) {
    const received: NormalizedEvent[] = [];
    const projectIds: string[] = [];
    server = await listen(
      ingestOnly(
        {
          ingest: (event, projectId) => {
            received.push(event);
            projectIds.push(projectId);
          },
        },
        dsnPublicKey,
      ),
    );
    const base = server.base;
    const post = (path: string, body: string | Buffer, headers: Record<string, string> = {}) =>
      fetch(base + path, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
    return { base, post, received, projectIds };
  }

  it('accepts a legacy JSON store payload and answers {id} with 200', async () => {
    const { post, received } = await start();
    const res = await post('/api/1/store/', JSON.stringify(jsEvent()));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    await tick();
    assert.equal(received.length, 1);
    assert.equal(received[0]?.exceptionType, 'TypeError');
  });

  it('accepts gzip, deflate and brotli encoded bodies and routes without the trailing slash', async () => {
    const { post, received } = await start();
    const json = JSON.stringify(pyEvent());
    for (const [encoding, payload] of [['gzip', gzipSync(json)], ['deflate', deflateSync(json)], ['br', brotliCompressSync(json)]] as const) {
      const res = await post('/api/2/store', payload, { 'content-encoding': encoding });
      assert.equal(res.status, 200, encoding);
    }
    await tick();
    assert.equal(received.length, 3);
  });

  it('extracts only error events from an envelope and ignores other item types', async () => {
    const { post, received } = await start();
    const body = envelope(
      [
        { header: { type: 'session' }, payload: '{"sid":"x"}' },
        { header: { type: 'event' }, payload: JSON.stringify(jsEvent()) },
        { header: { type: 'transaction' }, payload: '{"type":"transaction"}' },
        { header: { type: 'attachment', filename: 'a.bin' }, payload: Buffer.from([0, 10, 255]) },
      ],
      { event_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' },
    );
    const res = await post('/api/1/envelope/', gzipSync(body), { 'content-type': 'application/x-sentry-envelope', 'content-encoding': 'gzip' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    await tick();
    assert.equal(received.length, 1);
  });

  it('accepts browser-style text/plain envelopes', async () => {
    const { post, received } = await start();
    const body = envelope([{ header: { type: 'event' }, payload: JSON.stringify(jsEvent()) }]);
    const res = await post('/api/1/envelope/?sentry_key=k&sentry_version=7', body, { 'content-type': 'text/plain;charset=UTF-8' });
    assert.equal(res.status, 200);
    await tick();
    assert.equal(received.length, 1);
  });

  it('returns 200 before processing runs, and keeps returning 200 if processing fails', async () => {
    server = await listen(
      ingestOnly({
        ingest: () => {
          throw new Error('db down');
        },
      }),
    );
    const res = await fetch(`${server.base}/api/1/store/`, { method: 'POST', body: JSON.stringify(jsEvent()), headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 200);
    await tick(); // the thrown error is caught and logged, not propagated
  });

  it('answers CORS preflights for browser SDKs', async () => {
    const { base } = await start('secret');
    const res = await fetch(`${base}/api/1/envelope/`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(String(res.headers.get('access-control-allow-headers')), /x-sentry-auth/);
  });

  it('enforces the DSN public key when configured', async () => {
    const { post, received } = await start('secret');
    const send = (headers: Record<string, string>, url = '/api/1/store/') => post(url, JSON.stringify(jsEvent()), headers);

    assert.equal((await send({})).status, 401);
    assert.equal((await send({ 'x-sentry-auth': 'Sentry sentry_version=7, sentry_key=wrong' })).status, 401);
    assert.equal((await send({}, '/api/1/store/?sentry_key=nope')).status, 401);
    assert.equal((await send({ 'x-sentry-auth': 'Sentry sentry_version=7, sentry_key=secret, sentry_client=x/1' })).status, 200);
    assert.equal((await send({}, '/api/1/store/?sentry_key=secret')).status, 200);
    await tick();
    assert.equal(received.length, 2);
  });

  it('rejects garbage with 4xx (never 5xx) and does not ingest it', async () => {
    const { base, post, received } = await start();

    assert.equal((await post('/api/1/store/', 'not json')).status, 400);
    assert.equal((await post('/api/1/store/', '[1]')).status, 400);
    assert.equal((await post('/api/1/envelope/', 'garbage')).status, 400);
    assert.equal((await post('/api/1/store/', Buffer.from('not gzip'), { 'content-encoding': 'gzip' })).status, 400);
    assert.equal((await post('/api/1/store/', '{}', { 'content-encoding': 'zstd' })).status, 415);
    assert.equal((await fetch(`${base}/api/1/store/`, { method: 'POST' })).status, 400);
    await tick();
    assert.equal(received.length, 0);
  });

  it('refuses oversized bodies and zip bombs', async () => {
    const { post } = await start();
    const big = await post('/api/1/store/', Buffer.alloc(3 * 1024 * 1024, 0x61));
    assert.equal(big.status, 413);
    const bomb = await post('/api/1/store/', gzipSync(Buffer.alloc(12 * 1024 * 1024, 0x20)), { 'content-encoding': 'gzip' });
    assert.equal(bomb.status, 413);
  });

  it('serves a health check', async () => {
    const { base } = await start();
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok' });
  });

  it('passes the DSN project id from the URL through, for both endpoints', async () => {
    const { post, projectIds } = await start();
    await post('/api/7/store/', JSON.stringify(jsEvent()));
    await post('/api/12/envelope/', envelope([{ header: { type: 'event' }, payload: JSON.stringify(jsEvent()) }]), {
      'content-type': 'application/x-sentry-envelope',
    });
    await tick();
    assert.deepEqual(projectIds, ['7', '12']);
  });

  it('serves nothing but ingest: the dashboard API is not reachable here', async () => {
    const { base } = await start();
    assert.equal((await fetch(`${base}/api/apps`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404);
  });
});
