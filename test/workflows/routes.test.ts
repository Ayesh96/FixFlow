import assert from 'node:assert/strict';
import { fakeLlm } from '../llm/fakes.ts';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../server/app.ts';
import { COOKIE_NAME } from '../../server/auth.ts';
import type { AttemptRecord, TrackerIssue, TrackerProjectGroup } from '../../server/types.ts';
import type { Config as ErrorsConfig } from '../../server/workflows/errors/config.ts';
import { ErrorsWorkflow } from '../../server/workflows/errors/workflow.ts';
import type { Config as ResolverConfig } from '../../server/workflows/resolver/config.ts';
import { ResolverWorkflow } from '../../server/workflows/resolver/workflow.ts';
import type { Workflow } from '../../server/workflows/types.ts';
import { SecretStore } from '../../server/projects/secrets.ts';
import { ProjectStore } from '../../server/projects/store.ts';
import { freePort, tempConfig } from '../helpers.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsEvent, normalized } from './errors/fixtures.ts';
import { silentLogger } from './helpers.ts';

const TOKEN = 'T'.repeat(43);
const AUTH = { cookie: `${COOKIE_NAME}=${TOKEN}` };

const errorsConfig = (overrides: Partial<ErrorsConfig> = {}): ErrorsConfig => ({
  ingestPort: 0,
  ingestHost: '127.0.0.1',
  databasePath: ':memory:',
  dsnPublicKey: null,
  github: { apiUrl: 'https://api.github.com', labels: [] },
  minIssueLevel: 'error',
  commentThresholds: [100],
  retentionDays: 30,
  llm: fakeLlm(),
  ...overrides,
});

const resolverConfig = (overrides: Partial<ResolverConfig> = {}): ResolverConfig => ({
  githubApiUrl: 'https://api.github.com',
  llm: fakeLlm(),
  pollIntervalMs: 300_000,
  maxConcurrentFixes: 1,
  maxAttemptsPerIssue: 3,
    maxAgentTurns: 20,
    logDir: '',
    retrySkippedAttempts: false,
  databasePath: ':memory:',
  ...overrides,
});

/** A real project database with one project, as the wizard would have created it. */
function projectStoreWith(repo = 'me/sh'): ProjectStore {
  const dir = mkdtempSync(join(tmpdir(), 'routes-projects-'));
  const store = new ProjectStore(join(dir, 'projects.db'), new SecretStore(join(dir, 'secret.key')));
  store.add({ id: '1', repo, branch: 'main', token: 'ghp_test' });
  return store;
}

/** A minimal normalized event, built through the real normalizer so every field is present. */
const event = (eventId: string, tags: Record<string, string> = {}, timestamp = '2026-01-01T00:00:00.000Z') =>
  normalized({
    event_id: eventId,
    timestamp,
    level: 'error',
    platform: 'node',
    tags,
    exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] },
  });

/** The dashboard's host guard checks the Host header against config.port, so it needs its real port. */
async function serveDashboard(workflows: Workflow[] | undefined): Promise<{ server: Server; base: string }> {
  const port = await freePort();
  const config = await tempConfig({ port });
  const server = createApp({ port, publicDir: config.home, token: TOKEN, ...(workflows ? { workflows } : {}) }).listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${port}` };
}

describe('workflow routes', () => {
  let errors: ErrorsWorkflow;
  let resolver: ResolverWorkflow;
  let dashboard: Server;
  let base: string;
  let bare: Server;
  let bareBase: string;

  before(async () => {
    errors = new ErrorsWorkflow(errorsConfig(), projectStoreWith(), { logger: silentLogger() });
    resolver = new ResolverWorkflow(resolverConfig(), errors.store, projectStoreWith(), { logger: silentLogger() });
    ({ server: dashboard, base } = await serveDashboard([errors, resolver]));
    ({ server: bare, base: bareBase } = await serveDashboard(undefined));
  });
  after(async () => {
    for (const server of [dashboard, bare]) {
      server.closeAllConnections();
      server.close();
    }
    resolver.stop();
    await errors.stop();
  });

  const call = (path: string, headers: Record<string, string> = AUTH) => fetch(base + path, { headers });

  it('lists loaded workflows, and none when nothing is configured', async () => {
    assert.deepEqual(await (await call('/api/extensions')).json(), {
      extensions: [
        { id: 'errors', title: 'Errors' },
        { id: 'resolver', title: 'Resolver' },
      ],
    });
    assert.deepEqual(await (await fetch(bareBase + '/api/extensions', { headers: AUTH })).json(), { extensions: [] });
    assert.equal((await fetch(bareBase + '/api/ext/errors/issues', { headers: AUTH })).status, 404);
  });

  it('protects workflow routes with the same token as the rest of the API', async () => {
    for (const path of ['/api/extensions', '/api/ext/errors/issues', '/api/ext/errors/projects', '/api/ext/resolver/status', '/api/ext/resolver/attempts']) {
      assert.equal((await call(path, {})).status, 401, path);
    }
    assert.equal((await call('/api/ext/errors/status', { cookie: `${COOKIE_NAME}=wrong` })).status, 401);
  });

  it('refuses to mount a workflow whose id is not URL-safe', async () => {
    const config = await tempConfig();
    const evil: Workflow = { id: '../admin', title: 'x', routes: () => {} };
    assert.throws(() => createApp({ port: 7420, publicDir: config.home, token: TOKEN, workflows: [evil] }), /Invalid workflow id/);
  });

  it('serves issues straight from the store, with no admin token in the way', async () => {
    errors.store.recordEvent(event('e1'), 'fp-1', '[Error] TypeError: x is undefined', '1');
    const { issues } = (await (await call('/api/ext/errors/issues')).json()) as { issues: TrackerIssue[] };
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.fingerprintHash, 'fp-1');
    assert.equal(issues[0]?.count, 1);
  });

  it('triages an error again on request, and says why when it cannot', async () => {
    const post = (path: string) => fetch(base + path, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await post('/api/ext/errors/issues/nope/triage')).status, 404);

    errors.store.recordEvent(normalized(jsEvent()), 'fp-triage', '[Error] TypeError: x', '1');
    const res = await post('/api/ext/errors/issues/fp-triage/triage');
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { triage: 'started' });
    for (let i = 0; i < 50 && errors.store.getIssue('fp-triage')?.triageStatus !== 'COMPLETED'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(errors.store.getIssue('fp-triage')?.triageStatus, 'COMPLETED');
  });

  it('reports status as healthy with live totals', async () => {
    const status = (await (await call('/api/ext/errors/status')).json()) as { healthy: boolean; issues: number; reason: string | null };
    // Before the merge this could report `healthy: false` when the tracker was unreachable.
    // The store is in-process now, so there is no transport left to fail.
    assert.equal(status.healthy, true);
    assert.equal(status.reason, null);
    assert.ok(status.issues >= 1);
  });

  it('serves resolver status and paginated attempts', async () => {
    const status = (await (await call('/api/ext/resolver/status')).json()) as { stats: { total: number } };
    assert.equal(status.stats.total, 0);

    const page = (await (await call('/api/ext/resolver/attempts?limit=5&offset=0')).json()) as { attempts: AttemptRecord[]; limit: number; offset: number };
    assert.deepEqual([page.limit, page.offset, page.attempts], [5, 0, []]);
  });

  it('clamps the attempts page size and ignores malformed paging parameters', async () => {
    const page = (path: string) => call(path).then((r) => r.json() as Promise<{ limit: number; offset: number }>);
    assert.equal((await page('/api/ext/resolver/attempts?limit=9999')).limit, 200);
    const { limit, offset } = await page('/api/ext/resolver/attempts?limit=abc&offset=xyz');
    assert.deepEqual([limit, offset], [50, 0]);
  });
});

describe('errors workflow grouped by project', () => {
  /** A real project database with several projects, as the wizard would have made them. */
  function projectStoreWithThree(): ProjectStore {
    const dir = mkdtempSync(join(tmpdir(), 'routes-projects-'));
    const store = new ProjectStore(join(dir, 'projects.db'), new SecretStore(join(dir, 'secret.key')));
    store.add({ id: '1', repo: 'me/api', branch: 'main', token: 'ghp_test' });
    store.add({ id: '2', repo: 'me/web', branch: 'staging', token: 'ghp_test' });
    store.add({ id: '3', repo: 'me/quiet', branch: 'main', token: 'ghp_test' });
    return store;
  }

  it('groups issues by the project they were reported to: recent trouble first, quiet projects after, deleted projects last', async () => {
    const errors = new ErrorsWorkflow(errorsConfig(), projectStoreWithThree(), { logger: silentLogger() });
    // Counts come from how many events land on each fingerprint; the project is the DSN id they arrived under.
    const record = (fp: string, projectId: string, service: string | null, at: string, times: number) => {
      for (let i = 0; i < times; i++) {
        errors.store.recordEvent(event(`${fp}-${i}`, service ? { service } : {}, at), fp, `[Error] ${fp}`, projectId, new Date(at));
      }
    };
    record('a', '1', 'gateway', '2026-01-02T00:00:00.000Z', 2);
    record('b', '2', null, '2026-01-05T00:00:00.000Z', 10);
    record('c', '1', 'worker', '2026-01-01T00:00:00.000Z', 1);
    record('d', '99', null, '2026-01-03T00:00:00.000Z', 4); // its project was deleted

    const { server, base } = await serveDashboard([errors]);
    try {
      const { projects } = (await (await fetch(base + '/api/ext/errors/projects', { headers: AUTH })).json()) as { projects: TrackerProjectGroup[] };
      assert.deepEqual(projects.map((g) => g.repo), ['me/web', 'me/api', 'me/quiet', null]);

      const [web, api, quiet, gone] = projects as [TrackerProjectGroup, TrackerProjectGroup, TrackerProjectGroup, TrackerProjectGroup];
      assert.deepEqual([web.projectId, web.branch, web.issueCount, web.eventCount], ['2', 'staging', 1, 10]);
      assert.deepEqual([api.issueCount, api.eventCount, api.issues.map((i) => i.service).sort()], [2, 3, ['gateway', 'worker']]);
      assert.deepEqual([quiet.issueCount, quiet.eventCount, quiet.lastSeen], [0, 0, null]);
      assert.deepEqual([gone.projectId, gone.branch, gone.issueCount, gone.eventCount], [null, null, 1, 4]);
    } finally {
      server.closeAllConnections();
      server.close();
      await errors.stop();
    }
  });

  it('shows a project with no errors yet, and nothing at all when there are no projects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'routes-projects-'));
    const empty = new ProjectStore(join(dir, 'projects.db'), new SecretStore(join(dir, 'secret.key')));
    const errors = new ErrorsWorkflow(errorsConfig(), empty, { logger: silentLogger() });
    const { server, base } = await serveDashboard([errors]);
    try {
      assert.deepEqual(await (await fetch(base + '/api/ext/errors/projects', { headers: AUTH })).json(), { projects: [] });
    } finally {
      server.closeAllConnections();
      server.close();
      await errors.stop();
    }
  });
});
