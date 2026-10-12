import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkAnthropic,
  checkDeepSeek,
  checkOllama,
  checkPort,
  validateValues,
  validateWithServer,
} from '../scripts/setup-checks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fake Ollama, DeepSeek and Anthropic on one server. Only the key 'sk-good' is accepted. */
function fakeProviders(): Server {
  return createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/tags') return json(200, { models: [{ name: 'qwen2.5-coder:7b' }] });
    if (req.url === '/models') {
      return req.headers.authorization === 'Bearer sk-good'
        ? json(200, { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-pro' }] })
        : json(401, { error: 'bad key' });
    }
    if (req.url === '/v1/models') {
      const ok = req.headers['x-api-key'] === 'sk-good' && req.headers['anthropic-version'] === '2023-06-01';
      return ok ? json(200, { data: [{ id: 'claude-haiku-4-5' }] }) : json(401, { error: 'bad key' });
    }
    json(500, { error: 'boom' });
  });
}

/** A URL where nothing is listening. */
async function closedUrl(): Promise<string> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

describe('setup checks', () => {
  let fake: Server;
  let base: string;

  before(async () => {
    fake = fakeProviders();
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const { port } = fake.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });

  describe('checkPort', () => {
    it('reports a free port as ok', async () => {
      const probe = createNetServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const { port } = probe.address() as AddressInfo;
      await new Promise<void>((resolve) => probe.close(() => resolve()));

      assert.deepEqual(await checkPort(port), { ok: true });
    });

    it('reports a busy port as in use', async () => {
      const busy = createNetServer();
      await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
      const { port } = busy.address() as AddressInfo;
      try {
        assert.deepEqual(await checkPort(port), { ok: false, error: `Port ${port} is already in use` });
      } finally {
        await new Promise<void>((resolve) => busy.close(() => resolve()));
      }
    });

    it('reports an invalid port instead of throwing', async () => {
      const result = await checkPort(70000);
      assert.equal(result.ok, false);
      assert.equal(typeof result.error, 'string');
    });
  });

  describe('checkOllama', () => {
    it('lists the models', async () => {
      assert.deepEqual(await checkOllama(base), { ok: true, models: ['qwen2.5-coder:7b'] });
    });

    it('accepts a URL with trailing slashes', async () => {
      assert.deepEqual(await checkOllama(`${base}///`), { ok: true, models: ['qwen2.5-coder:7b'] });
    });

    it('reports an unreachable server', async () => {
      const url = await closedUrl();
      assert.deepEqual(await checkOllama(url), { ok: false, models: [], error: `Cannot reach Ollama at ${url}` });
    });
  });

  describe('checkDeepSeek', () => {
    it('lists the models for a valid key', async () => {
      assert.deepEqual(await checkDeepSeek('sk-good', base), { ok: true, models: ['deepseek-flash', 'deepseek-pro'] });
    });

    it('rejects a bad key', async () => {
      assert.deepEqual(await checkDeepSeek('sk-bad', base), { ok: false, models: [], error: 'Invalid API key' });
    });

    it('accepts an API URL with a trailing slash', async () => {
      const result = await checkDeepSeek('sk-good', `${base}/`);
      assert.deepEqual(result, { ok: true, models: ['deepseek-flash', 'deepseek-pro'] });
    });

    it('reports an unreachable API', async () => {
      const url = await closedUrl();
      assert.deepEqual(await checkDeepSeek('sk-good', url), {
        ok: false,
        models: [],
        unreachable: true,
        error: `Cannot reach ${url}`,
      });
    });

    it('reports other HTTP errors by status', async () => {
      assert.deepEqual(await checkDeepSeek('sk-good', `${base}/down`), { ok: false, models: [], error: 'HTTP 500' });
    });
  });

  describe('checkAnthropic', () => {
    it('lists the models for a valid key', async () => {
      assert.deepEqual(await checkAnthropic('sk-good', base), { ok: true, models: ['claude-haiku-4-5'] });
    });

    it('rejects a bad key', async () => {
      assert.deepEqual(await checkAnthropic('sk-bad', base), { ok: false, models: [], error: 'Invalid API key' });
    });

    it('accepts an API URL with a trailing slash', async () => {
      assert.deepEqual(await checkAnthropic('sk-good', `${base}/`), { ok: true, models: ['claude-haiku-4-5'] });
    });

    it('reports an unreachable API', async () => {
      const url = await closedUrl();
      assert.deepEqual(await checkAnthropic('sk-good', url), {
        ok: false,
        models: [],
        unreachable: true,
        error: `Cannot reach ${url}`,
      });
    });
  });

  describe('validateValues', () => {
    const good = {
      port: 7420,
      dataDir: '~/.fixflow',
      providerOrder: 'ollama,deepseek',
      useOllama: true,
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'qwen2.5-coder:7b',
      deepseekKey: 'sk-x',
      deepseekModel: 'deepseek-flash',
      anthropicKey: '',
      anthropicModel: 'claude-haiku-4-5',
      errorsEnabled: true,
      ingestPort: 3000,
      ingestHost: '127.0.0.1',
      dsnKey: '',
      githubLabels: 'bug,sentry',
      minLevel: 'error',
      commentThresholds: '100,1000,10000',
      retentionDays: 30,
      resolverEnabled: true,
      pollInterval: 300000,
      maxConcurrent: 3,
      maxAttempts: 3,
      retrySkipped: false,
    };

    it('accepts a good configuration', () => {
      assert.deepEqual(validateValues(good), { errors: {} });
    });

    it('accepts numeric strings', () => {
      assert.deepEqual(
        validateValues({ ...good, port: '7420', ingestPort: '3001', pollInterval: '60000', retentionDays: '0' }),
        { errors: {} },
      );
    });

    it('rejects an out-of-range port', () => {
      assert.ok('port' in validateValues({ ...good, port: 70000 }).errors);
    });

    it('rejects an ingest port equal to the dashboard port', () => {
      assert.ok('ingestPort' in validateValues({ ...good, ingestPort: 7420 }).errors);
    });

    it('rejects an unknown minimum level', () => {
      assert.ok('minLevel' in validateValues({ ...good, minLevel: 'nope' }).errors);
    });

    it('rejects a comment threshold below 2', () => {
      assert.ok('commentThresholds' in validateValues({ ...good, commentThresholds: '100,1' }).errors);
    });

    it('rejects a poll interval below 30 seconds', () => {
      assert.ok('pollInterval' in validateValues({ ...good, pollInterval: 1000 }).errors);
    });

    it('rejects a provider in the order that is not set up', () => {
      assert.ok('providerOrder' in validateValues({ ...good, providerOrder: 'ollama,anthropic' }).errors);
    });

    it('rejects an unknown provider', () => {
      assert.ok('providerOrder' in validateValues({ ...good, providerOrder: 'openai' }).errors);
    });

    it('skips the errors and resolver fields when those workflows are off', () => {
      const off = { ...good, errorsEnabled: false, resolverEnabled: false, ingestPort: 7420, minLevel: 'nope', pollInterval: 1 };
      assert.deepEqual(validateValues(off), { errors: {} });
    });
  });

  describe('validateWithServer', () => {
    const goodEnv = ['PORT=7420', 'ORCH_ERRORS_ENABLED=1', 'ORCH_RESOLVER_ENABLED=1', 'ORCH_ERRORS_MIN_LEVEL=error'].join('\n');

    it('accepts a good configuration', async () => {
      assert.deepEqual(await validateWithServer(goodEnv, ROOT), { ok: true, problems: [] });
    });

    it('reports the server problems for a bad configuration', async () => {
      const result = await validateWithServer(`${goodEnv}\nORCH_ERRORS_MIN_LEVEL=nope\n`, ROOT);
      assert.equal(result.ok, false);
      assert.ok(result.problems.some((p) => p.includes('ORCH_ERRORS_MIN_LEVEL')), JSON.stringify(result.problems));
    });
  });
});
