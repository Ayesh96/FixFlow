import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createIngestApp } from '../../../server/ingest.ts';
import { ingestRoutes } from '../../../server/workflows/errors/ingestRoutes.ts';
import { REJECTIONS_KEPT_PER_PROJECT, REJECTIONS_LOG_INTERVAL_MS, Rejections } from '../../../server/workflows/errors/rejections.ts';
import type { Workflow } from '../../../server/workflows/types.ts';
import { listen, type Listening } from '../helpers.ts';
import { jsEvent } from './fixtures.ts';

describe('Rejections', () => {
  const setup = () => {
    const lines: string[] = [];
    let now = Date.parse('2026-10-14T10:00:00Z');
    const rejections = new Rejections({ logger: { warn: ((m: string) => lines.push(m)) as never }, now: () => now });
    return { rejections, lines, advance: (ms: number) => (now += ms) };
  };

  it('keeps only the last few per project but counts them all', () => {
    const { rejections } = setup();
    for (let i = 0; i < REJECTIONS_KEPT_PER_PROJECT + 3; i++) rejections.record('3', 401, `try ${i}`);
    rejections.record('4', 400, 'other');
    assert.equal(rejections.recent('3').length, REJECTIONS_KEPT_PER_PROJECT);
    assert.equal(rejections.summary('3').count, REJECTIONS_KEPT_PER_PROJECT + 3);
    assert.equal(rejections.summary('3').last?.reason, `try ${REJECTIONS_KEPT_PER_PROJECT + 2}`);
    assert.equal(rejections.summary('4').count, 1);
    assert.deepEqual(rejections.summary('9'), { count: 0, last: null });
  });

  it('logs at most once a minute per project and status', () => {
    const { rejections, lines, advance } = setup();
    rejections.record('3', 401, 'Invalid or missing sentry_key');
    rejections.record('3', 401, 'Invalid or missing sentry_key');
    rejections.record('3', 400, 'Empty request body');
    rejections.record('4', 401, 'Invalid or missing sentry_key');
    assert.deepEqual(lines, [
      'refused an event for project 3: 401 Invalid or missing sentry_key (1 since startup)',
      'refused an event for project 3: 400 Empty request body (3 since startup)',
      'refused an event for project 4: 401 Invalid or missing sentry_key (1 since startup)',
    ]);
    advance(REJECTIONS_LOG_INTERVAL_MS);
    rejections.record('3', 401, 'Invalid or missing sentry_key');
    assert.equal(lines.length, 4);
    assert.match(lines[3] as string, /\(4 since startup\)$/);
  });

  it('logs a refusal with no project without naming one', () => {
    const { rejections, lines } = setup();
    rejections.record(null, 404, 'Not found');
    assert.deepEqual(lines, ['refused an event: 404 Not found (1 since startup)']);
  });

  it('nudges the dashboard once per burst, and again at the end of it', async () => {
    let nudges = 0;
    const rejections = new Rejections({ onChange: () => nudges++ });
    rejections.record('1', 401, 'x');
    rejections.record('1', 401, 'x');
    rejections.record('1', 401, 'x');
    assert.equal(nudges, 1);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    assert.equal(nudges, 2);
  });
});

describe('refusals at the ingest listener', () => {
  let server: Listening | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function start(key: string | null) {
    const rejections = new Rejections();
    const workflow: Workflow = { id: 'errors', title: 'Errors', routes: () => {}, ingestRoutes: (router) => ingestRoutes(router, { ingest: () => {} }, key, rejections) };
    server = await listen(createIngestApp([workflow]) as NonNullable<ReturnType<typeof createIngestApp>>);
    return { rejections, post: (path: string, body = JSON.stringify(jsEvent())) => fetch(server!.base + path, { method: 'POST', body, headers: { 'content-type': 'application/json' } }) };
  }

  it('records a 401 against the project in the URL, and still answers it', async () => {
    const { rejections, post } = await start('secret');
    const res = await post('/api/3/store/');
    assert.equal(res.status, 401);
    assert.deepEqual(rejections.summary('3').last?.status, 401);
    assert.equal(rejections.summary('3').last?.reason, 'Invalid or missing sentry_key');
    assert.equal(rejections.summary('3').count, 1);
  });

  it('records a bad body too, and nothing for a request that is accepted', async () => {
    const { rejections, post } = await start(null);
    assert.equal((await post('/api/2/envelope/', '')).status, 400);
    assert.equal((await post('/api/2/store/')).status, 200);
    assert.equal(rejections.summary('2').count, 1);
    assert.equal(rejections.summary('2').last?.status, 400);
  });
});
