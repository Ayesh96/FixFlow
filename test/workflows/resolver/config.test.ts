import assert from 'node:assert/strict';
import { fakeLlm } from '../../llm/fakes.ts';
import { describe, it } from 'node:test';
import { parseDatabaseUrl } from '../../../server/shared/database-url.ts';
import { ConfigError } from '../../../server/shared/errors.ts';
import { formatRepo, parseRepo } from '../../../server/shared/repo.ts';
import { loadConfig, type LoadOptions } from '../../../server/workflows/resolver/config.ts';

const DATA = '/data/test';
const options: LoadOptions = { dataDir: DATA, githubApiUrl: 'https://api.github.com', llm: fakeLlm() };

/** The resolver needs no tracker URL or token: each project brings its own. */
const valid = {};

const load = (env: Record<string, string>, overrides: Partial<LoadOptions> = {}) => loadConfig(env, { ...options, ...overrides });

describe('resolver loadConfig', () => {
  it('is on by default, and returns null only when ORCH_RESOLVER_ENABLED switches it off', () => {
    assert.ok(load({}));
    assert.ok(load({ ORCH_RESOLVER_ENABLED: 'true' }));
    for (const off of ['0', 'false', 'no', 'off']) assert.equal(load({ ORCH_RESOLVER_ENABLED: off }), null, off);
  });

  it('applies defaults', () => {
    const c = load(valid);
    assert.ok(c);
    assert.equal(c.pollIntervalMs, 300_000);
    assert.equal(c.maxConcurrentFixes, 3);
    assert.equal(c.maxAttemptsPerIssue, 3);
    assert.equal(c.databasePath, `${DATA}/resolver.db`);
    assert.equal(c.githubApiUrl, 'https://api.github.com');
    assert.equal(c.retrySkippedAttempts, false);
  });

  it('carries the shared models through', () => {
    const llm = fakeLlm();
    assert.equal(load(valid, { llm })?.llm, llm);
  });

  it('enforces a minimum poll interval', () => {
    assert.throws(
      () => load({ ...valid, ORCH_RESOLVER_POLL_INTERVAL_MS: '1000' }),
      (err: unknown) => err instanceof ConfigError && err.problems.some((p) => p.includes('ORCH_RESOLVER_POLL_INTERVAL_MS')),
    );
  });

  it('reads the attempt limit and rejects one below 1', () => {
    assert.equal(load({ ...valid, ORCH_RESOLVER_MAX_ATTEMPTS: '5' })?.maxAttemptsPerIssue, 5);
    assert.throws(
      () => load({ ...valid, ORCH_RESOLVER_MAX_ATTEMPTS: '0' }),
      (err: unknown) => err instanceof ConfigError && err.problems.some((p) => p.includes('ORCH_RESOLVER_MAX_ATTEMPTS')),
    );
  });

  it('rejects a non-sqlite database location', () => {
    assert.throws(
      () => load({ ...valid, ORCH_RESOLVER_DB: 'postgres://u@h/db' }),
      (err: unknown) => err instanceof ConfigError && err.problems.some((p) => p.includes('ORCH_RESOLVER_DB')),
    );
  });
});

describe('parseRepo / formatRepo', () => {
  it('parses a valid owner/repo', () => {
    assert.deepEqual(parseRepo('acme/app'), { owner: 'acme', repo: 'app' });
  });
  it('rejects text with no slash', () => {
    assert.equal(parseRepo('not-a-repo'), null);
  });
  it('round-trips through formatRepo', () => {
    assert.equal(formatRepo({ owner: 'acme', repo: 'app' }), 'acme/app');
  });
});

describe('parseDatabaseUrl', () => {
  it('accepts file: and sqlite: prefixes and bare paths', () => {
    assert.equal(parseDatabaseUrl('file:./data/resolver.db'), './data/resolver.db');
    assert.equal(parseDatabaseUrl('sqlite://./data/resolver.db'), './data/resolver.db');
    assert.equal(parseDatabaseUrl(':memory:'), ':memory:');
    assert.equal(parseDatabaseUrl('./data/resolver.db'), './data/resolver.db');
  });
  it('rejects other URL schemes', () => {
    assert.equal(parseDatabaseUrl('postgres://u@h/db'), null);
  });
});
