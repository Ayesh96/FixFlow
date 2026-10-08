import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { GitHubClient, GitHubError } from '../../../server/workflows/resolver/github.ts';

describe('GitHubClient', () => {
  let server: Server;
  let apiUrl: string;
  const requests: {
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: unknown;
  }[] = [];
  let respond: (req: {
    method: string;
    url: string;
  }) => { status: number; body: unknown };

  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        const { status, body: responseBody } = respond({
          method: req.method ?? '',
          url: req.url ?? '',
        });
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(responseBody));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  const repo = { owner: 'acme', repo: 'app' };
  const client = () => new GitHubClient({ token: 'ghp_secret', apiUrl });

  it('getIssue: found issue - correct URL, auth header, API version header, and mapped result with null body', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        number: 7,
        title: 'Bug in the system',
        body: null,
        state: 'open',
        html_url: 'https://github.com/acme/app/issues/7',
      },
    });

    const result = await client().getIssue(repo, 7);

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert(req !== undefined);
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/repos/acme/app/issues/7');
    assert.equal(req.headers.authorization, 'Bearer ghp_secret');
    assert.equal(req.headers['x-github-api-version'], '2022-11-28');
    assert.deepEqual(result, {
      number: 7,
      title: 'Bug in the system',
      body: '',
      state: 'open',
      htmlUrl: 'https://github.com/acme/app/issues/7',
    });
  });

  it('getIssue: 404 returns null without throwing', async () => {
    requests.length = 0;
    respond = () => ({
      status: 404,
      body: { message: 'Not Found' },
    });

    const result = await client().getIssue(repo, 999);

    assert.equal(result, null);
  });

  it('getIssue: 500 throws GitHubError with status 500', async () => {
    requests.length = 0;
    respond = () => ({
      status: 500,
      body: { message: 'Internal Server Error' },
    });

    await assert.rejects(
      async () => {
        await client().getIssue(repo, 7);
      },
      (err: unknown) => {
        assert(err instanceof GitHubError);
        assert.equal(err.status, 500);
        return true;
      },
    );
  });

  it('getDefaultBranch: returns default_branch value', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        name: 'app',
        default_branch: 'main',
        full_name: 'acme/app',
      },
    });

    const result = await client().getDefaultBranch(repo);

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert(req !== undefined);
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/repos/acme/app');
    assert.equal(result, 'main');
  });

  it('createPullRequest: correct URL, POST method, request body, and mapped result', async () => {
    requests.length = 0;
    respond = () => ({
      status: 201,
      body: {
        number: 123,
        html_url: 'https://github.com/acme/app/pull/123',
        state: 'open',
      },
    });

    const result = await client().createPullRequest(repo, {
      title: 'Fix: resolve issue',
      body: 'This PR fixes the bug',
      head: 'fix-branch',
      base: 'main',
    });

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert(req !== undefined);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/repos/acme/app/pulls');
    assert.deepEqual(req.body, {
      title: 'Fix: resolve issue',
      body: 'This PR fixes the bug',
      head: 'fix-branch',
      base: 'main',
    });
    assert.deepEqual(result, {
      number: 123,
      url: 'https://github.com/acme/app/pull/123',
    });
  });
});
