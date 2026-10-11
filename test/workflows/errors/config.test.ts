import assert from 'node:assert/strict';
import { fakeLlm } from '../../llm/fakes.ts';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, parseDatabaseUrl, type LoadOptions } from '../../../server/workflows/errors/config.ts';

const DATA = '/data/test';
const options: LoadOptions = { dataDir: DATA, githubApiUrl: 'https://api.github.com', llm: fakeLlm() };

const load = (env: Record<string, string>, overrides: Partial<LoadOptions> = {}) => loadConfig(env, { ...options, ...overrides });

describe('errors loadConfig', () => {
  it('is on by default, and returns null only when switched off, so the tab stays out of the dashboard', () => {
    assert.ok(load({}));
    assert.ok(load({ ORCH_ERRORS_ENABLED: '1' }));
    for (const off of ['0', 'false', 'no', 'off']) assert.equal(load({ ORCH_ERRORS_ENABLED: off }), null, off);
  });

  it('applies defaults', () => {
    const c = load({});
    assert.ok(c);
    assert.equal(c.ingestPort, 3000);
    // Loopback by default: opening it to the network is an explicit choice.
    assert.equal(c.ingestHost, '127.0.0.1');
    assert.equal(c.databasePath, `${DATA}/errors.db`);
    assert.equal(c.github.apiUrl, 'https://api.github.com');
    assert.equal(c.minIssueLevel, 'error');
    assert.deepEqual(c.commentThresholds, [100, 1000, 10000]);
    assert.equal(c.dsnPublicKey, null);
    assert.equal(c.retentionDays, 30);
  });

  it('reports every problem at once', () => {
    assert.throws(
      () => load({ ORCH_ERRORS_INGEST_PORT: 'abc', ORCH_ERRORS_DB: 'postgres://u@h/db', ORCH_ERRORS_MIN_LEVEL: 'loud' }),
      (err: unknown) => err instanceof ConfigError && err.problems.length === 3,
    );
  });

  it('parses optional settings', () => {
    const c = load({
      ORCH_ERRORS_ENABLED: '1',
      ORCH_ERRORS_INGEST_PORT: '8000',
      ORCH_ERRORS_INGEST_HOST: '0.0.0.0',
      ORCH_ERRORS_GITHUB_LABELS: 'bug, sentry',
      ORCH_ERRORS_COMMENT_THRESHOLDS: '10,50',
      ORCH_ERRORS_DSN_PUBLIC_KEY: 'k',
      ORCH_ERRORS_RETENTION_DAYS: '7',
      ORCH_ERRORS_DB: 'file:./data/errors.db',
    });
    assert.ok(c);
    assert.equal(c.ingestPort, 8000);
    assert.equal(c.ingestHost, '0.0.0.0');
    assert.deepEqual(c.github.labels, ['bug', 'sentry']);
    assert.deepEqual(c.commentThresholds, [10, 50]);
    assert.equal(c.dsnPublicKey, 'k');
    assert.equal(c.retentionDays, 7);
    assert.equal(c.databasePath, './data/errors.db');
  });

  it('carries the GitHub address and the models through, and needs no token of its own', () => {
    const llm = fakeLlm();
    const c = load({ ORCH_ERRORS_ENABLED: '1' }, { githubApiUrl: 'https://ghe.example.com/api/v3', llm });
    assert.ok(c);
    assert.equal(c.github.apiUrl, 'https://ghe.example.com/api/v3');
    assert.equal(c.llm, llm);
  });
});

describe('parseDatabaseUrl', () => {
  it('understands sqlite-style locations', () => {
    assert.equal(parseDatabaseUrl('sqlite:///data/app.db'), '/data/app.db');
    assert.equal(parseDatabaseUrl('sqlite://./app.db'), './app.db');
    assert.equal(parseDatabaseUrl('file:./app.db'), './app.db');
    assert.equal(parseDatabaseUrl('file:/data/app.db'), '/data/app.db');
    assert.equal(parseDatabaseUrl(':memory:'), ':memory:');
    assert.equal(parseDatabaseUrl('data/app.db'), 'data/app.db');
    assert.equal(parseDatabaseUrl('postgresql://u:p@h/db'), null);
  });
});
