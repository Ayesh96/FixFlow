import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { COOKIE_NAME } from '../server/auth.ts';
import type { Workflow } from '../server/workflows/types.ts';
import { freePort, tempConfig } from './helpers.ts';

const TOKEN = 'T'.repeat(43);
const AUTH = { cookie: `${COOKIE_NAME}=${TOKEN}` };

/** Stands in for a real workflow: one read and one state-changing route. */
const demo: Workflow = {
  id: 'demo',
  title: 'Demo',
  routes(router) {
    router.get('/ping', (_req, res) => void res.json({ ok: true }));
    router.post('/act', (_req, res) => void res.json({ done: true }));
  },
};

describe('HTTP API', () => {
  let server: Server;
  let base: string;
  let host: string;

  before(async () => {
    const port = await freePort();
    const config = await tempConfig({ port });
    server = createApp({ port, publicDir: config.home, token: TOKEN, workflows: [demo] }).listen(port, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    host = `localhost:${port}`;
    base = `http://127.0.0.1:${port}`;
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  // Requests carry the token cookie by default, as the browser does after the one-time login.
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(base + path, { ...init, headers: { ...AUTH, ...init.headers } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

  it('lists its workflows for the UI to build tabs from, and serves their routes under /api/ext/<id>', async () => {
    assert.deepEqual(await (await call('/api/extensions')).json(), { extensions: [{ id: 'demo', title: 'Demo' }] });
    assert.deepEqual(await (await call('/api/ext/demo/ping')).json(), { ok: true });
  });

  it('rejects malformed input and unknown routes', async () => {
    assert.equal((await call('/api/ext/demo/act', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await call('/api/nothing')).status, 404);
  });

  // fetch() refuses to set Host, so use raw http to impersonate a rebound domain.
  const rawStatus = (hostHeader: string) =>
    new Promise<number>((resolve, reject) => {
      const { port } = server.address() as AddressInfo;
      request({ host: '127.0.0.1', port, path: '/api/ext/demo/ping', headers: { host: hostHeader, ...AUTH } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });

  it('blocks DNS-rebinding (unexpected Host) and cross-site state changes', async () => {
    assert.equal(await rawStatus('evil.example.com'), 403);
    assert.equal(await rawStatus(`evil.example.com:${(server.address() as AddressInfo).port}`), 403);
    assert.equal(await rawStatus(host), 200);
    assert.equal((await post('/api/ext/demo/act', {}, { origin: 'https://evil.example.com' })).status, 403);
    assert.equal((await post('/api/ext/demo/act', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post('/api/ext/demo/act', {}, { origin: base, 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal((await call('/api/ext/demo/ping')).status, 200, 'plain same-origin reads still work');
  });

  it('requires the token cookie for every API route', async () => {
    const bare = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers });
    assert.equal((await bare('/api/extensions')).status, 401);
    assert.equal((await bare('/api/ext/demo/ping')).status, 401);
    assert.equal((await bare('/api/ext/demo/ping', { cookie: `${COOKIE_NAME}=wrong` })).status, 401);
    assert.equal((await bare('/api/ext/demo/ping', { cookie: `${COOKIE_NAME}=${TOKEN.slice(0, -1)}` })).status, 401, 'prefix of the token');
    assert.equal((await fetch(base + '/api/ext/demo/act', { method: 'POST' })).status, 401);
    assert.equal((await bare('/api/ext/demo/ping', { cookie: `other=1; ${COOKIE_NAME}=${TOKEN}` })).status, 200, 'token among other cookies');
  });

  it('trades ?token= for an HttpOnly, SameSite=Strict cookie and redirects to a clean URL', async () => {
    const ok = await fetch(`${base}/?token=${TOKEN}`, { redirect: 'manual' });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/');
    const cookie = ok.headers.get('set-cookie') ?? '';
    assert.match(cookie, new RegExp(`^${COOKIE_NAME}=${TOKEN};`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    assert.equal((await fetch(`${base}/?token=nope`, { redirect: 'manual' })).status, 401);
    assert.equal((await fetch(`${base}/?token=`, { redirect: 'manual' })).status, 401);
  });

  it('sends anti-framing, CSP and no-store headers', async () => {
    const res = await call('/api/ext/demo/ping');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const csp = res.headers.get('content-security-policy') ?? '';
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "script-src 'self'", "object-src 'none'"]) assert.ok(csp.includes(directive), directive);
    assert.ok(!/script-src[^;]*unsafe/.test(csp), 'scripts must never be allowed inline or eval');
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS: other origins cannot read responses');
  });
});

describe('published port (container)', () => {
  let server: Server;
  let port: number;
  let published: number;

  before(async () => {
    port = await freePort();
    published = await freePort();
    server = createApp({ port, publicPort: published, publicDir: (await tempConfig()).home, token: TOKEN, workflows: [demo] }).listen(port, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const status = (hostHeader: string) =>
    new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/api/ext/demo/ping', headers: { host: hostHeader, ...AUTH } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });

  it('accepts loopback names on the published port as well as the listening port', async () => {
    for (const name of ['localhost', '127.0.0.1', '[::1]']) {
      assert.equal(await status(`${name}:${published}`), 200, `${name}:${published}`);
      assert.equal(await status(`${name}:${port}`), 200, `${name}:${port}`);
    }
  });

  it('still rejects other names and other ports', async () => {
    assert.equal(await status(`evil.example.com:${published}`), 403);
    assert.equal(await status(`code-akos:${published}`), 403);
    assert.equal(await status('localhost'), 403);
    assert.equal(await status(`localhost:${published + 1 > 65535 ? 1 : published + 1}`), 403);
  });
});
