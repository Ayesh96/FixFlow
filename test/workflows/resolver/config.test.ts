import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, parseDatabaseUrl, parseRepo, formatRepo, type LoadOptions } from '../../../server/workflows/resolver/config.ts';

const DATA = '/data/test';
const options: LoadOptions = { dataDir: DATA, githubApiUrl: 'https://api.github.com', ollama: null, anthropic: null };

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
    assert.equal(c.ollamaModel, 'qwen2.5-coder:7b');
    assert.equal(c.ollamaUrl, 'http://localhost:11434');
    assert.equal(c.databasePath, `${DATA}/resolver.db`);
    assert.equal(c.githubApiUrl, 'https://api.github.com');
    assert.equal(c.anthropic, null);
    assert.equal(c.retrySkippedAttempts, false);
  });

  it('takes the hosted model from the shared Anthropic settings', () => {
    const anthropic = { apiUrl: 'https://api.anthropic.com', apiKey: 'sk-test', model: 'claude-haiku-4-5' };
    assert.deepEqual(load(valid, { anthropic })?.anthropic, anthropic);
  });

  it('takes Ollama from the shared settings', () => {
    const c = load(valid, { ollama: { url: 'http://box:11434', model: 'custom' } });
    assert.ok(c);
    assert.equal(c.ollamaUrl, 'http://box:11434');
    assert.equal(c.ollamaModel, 'custom');
  });

  it('enforces a minimum poll interval', () => {
    assert.throws(
      () => load({ ...valid, ORCH_RESOLVER_POLL_INTERVAL_MS: '1000' }),
      (err: unknown) => err instanceof ConfigError && err.problems.some((p) => p.includes('ORCH_RESOLVER_POLL_INTERVAL_MS')),
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
