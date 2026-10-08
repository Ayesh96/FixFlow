import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { GitHubClient, GitHubError } from '../../../server/workflows/errors/github.ts';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

describe('GitHubClient', () => {
  let server: Server;
  let apiUrl: string;
  const requests: Recorded[] = [];
  let respond: (url: string) => { status: number; body: unknown } = () => ({ status: 201, body: { number: 7, html_url: 'https://github.com/acme/app/issues/7' } });

  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
        const { status, body } = respond(req.url ?? '');
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const repo = { owner: 'acme', repo: 'app' };
  const client = () => new GitHubClient({ token: 'ghp_secret', apiUrl, labels: ['bug', 'sentry'] });

  it('POSTs the issue with auth, labels and API version headers, and parses the result', async () => {
    const created = await client().createIssue(repo, '[Error] X: y', 'body');
    assert.deepEqual(created, { number: 7, url: 'https://github.com/acme/app/issues/7' });

    const req = requests.at(-1);
    assert.equal(req?.method, 'POST');
    assert.equal(req?.url, '/repos/acme/app/issues');
    assert.equal(req?.headers.authorization, 'Bearer ghp_secret');
    assert.equal(req?.headers['x-github-api-version'], '2022-11-28');
    assert.deepEqual(req?.body, { title: '[Error] X: y', body: 'body', labels: ['bug', 'sentry'] });
  });

  it('posts comments to the issue', async () => {
    respond = () => ({ status: 201, body: { id: 1 } });
    await client().commentOnIssue(repo, 7, 'hello');
    assert.equal(requests.at(-1)?.url, '/repos/acme/app/issues/7/comments');
    assert.deepEqual(requests.at(-1)?.body, { body: 'hello' });
  });

  it('targets whichever repo it is given, URL-encoding the parts', async () => {
    respond = () => ({ status: 201, body: { number: 1, html_url: 'https://github.com/x/y/issues/1' } });
    await client().createIssue({ owner: 'other-org', repo: 'my.repo' }, 't', 'b');
    assert.equal(requests.at(-1)?.url, '/repos/other-org/my.repo/issues');
  });

  it('surfaces API failures with the status code', async () => {
    respond = () => ({ status: 403, body: { message: 'Resource not accessible by personal access token' } });
    await assert.rejects(client().createIssue(repo, 't', 'b'), (err: unknown) => err instanceof GitHubError && err.status === 403 && /not accessible/.test(err.message));
  });

  it('rejects malformed success responses', async () => {
    respond = () => ({ status: 201, body: { unexpected: true } });
    await assert.rejects(client().createIssue(repo, 't', 'b'), GitHubError);
  });

  it('wraps network failures', async () => {
    const dead = new GitHubClient({ token: 't', apiUrl: 'http://127.0.0.1:1', labels: [] });
    await assert.rejects(dead.createIssue(repo, 't', 'b'), (err: unknown) => err instanceof GitHubError && err.status === 0);
  });
});
