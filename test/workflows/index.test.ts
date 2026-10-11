import assert from 'node:assert/strict';
import { fakeLlm } from '../llm/fakes.ts';
import { existsSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import type { Config as ErrorsConfig } from '../../server/workflows/errors/config.ts';
import type { Config as ResolverConfig } from '../../server/workflows/resolver/config.ts';
import { loadWorkflows, type LoadedWorkflows } from '../../server/workflows/index.ts';
import { tempConfig } from '../helpers.ts';

const errors = (over: Partial<ErrorsConfig> = {}): ErrorsConfig => ({
  ingestPort: 3000, ingestHost: '127.0.0.1', databasePath: ':memory:', dsnPublicKey: null,
  github: { apiUrl: 'https://api.github.com', labels: [] },
  minIssueLevel: 'error', commentThresholds: [100], retentionDays: 30, llm: fakeLlm(), ...over,
});
const resolver = (): ResolverConfig => ({
  githubApiUrl: 'https://api.github.com', llm: fakeLlm(),
  pollIntervalMs: 300_000, maxConcurrentFixes: 1, retrySkippedAttempts: false, databasePath: ':memory:',
});

describe('loadWorkflows', () => {
  let loaded: LoadedWorkflows | undefined;
  afterEach(async () => {
    await Promise.all((loaded?.workflows ?? []).map((w) => w.stop?.()));
    loaded?.projects.close();
    loaded = undefined;
  });

  it('always offers Projects, so a repo can be added even when errors and the resolver are off', async () => {
    const config = await tempConfig();
    loaded = loadWorkflows(config);
    assert.deepEqual(loaded.workflows.map((w) => w.id), ['projects']);
    assert.equal(existsSync(config.projectsDb), true);
  });

  it('puts Projects first, so the tab for adding a repo comes before the ones that depend on it', async () => {
    loaded = loadWorkflows(await tempConfig({ errors: errors(), resolver: resolver() }));
    assert.deepEqual(loaded.workflows.map((w) => w.id), ['projects', 'errors', 'resolver']);
  });

  it('offers Projects even when only the resolver is on', async () => {
    loaded = loadWorkflows(await tempConfig({ resolver: resolver() }));
    assert.deepEqual(loaded.workflows.map((w) => w.id), ['projects', 'resolver']);
  });

  it('tells the Projects tab where apps send errors, so it can show the DSN, only when error tracking is on', async () => {
    loaded = loadWorkflows(await tempConfig({ errors: errors({ ingestPort: 3456, dsnPublicKey: 'k' }) }));
    const projectsRoute = loaded.workflows[0] as unknown as { deps: { ingest: unknown } };
    assert.deepEqual(projectsRoute.deps.ingest, { host: '127.0.0.1', port: 3456, dsnKey: 'k' });
  });
});
