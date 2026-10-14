import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { inspectRepo } from '../../server/projects/github.ts';
import { startFakeGithub, type FakeGithub } from './fakeGithub.ts';

const TOKEN = 'ghp_secret_value_that_must_never_appear_in_a_message';
const repoBody = { private: true, default_branch: 'main', permissions: { push: true } };

describe('inspectRepo', () => {
  let github: FakeGithub | undefined;
  /** Every fake server a test started, so none is left holding the process open. */
  const started: FakeGithub[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((server) => server.close()));
    github = undefined;
  });

  const run = async (routes: Record<string, { status: number; body?: unknown }>, branch?: string) => {
    github = await startFakeGithub((method, path) => routes[`${method} ${path}`] ?? { status: 404, body: { message: 'Not Found' } });
    started.push(github);
    return inspectRepo({ token: TOKEN, apiUrl: github.url, repo: 'acme/web', ...(branch === undefined ? {} : { branch }) });
  };

  const good = {
    'GET /repos/acme/web': { status: 200, body: repoBody },
    'GET /repos/acme/web/branches?per_page=100': { status: 200, body: [{ name: 'main' }, { name: 'develop' }] },
    'GET /repos/acme/web/branches/main': { status: 200, body: { name: 'main' } },
  };

  it('accepts a repo and branch the token can reach, and offers the default branch and the others as suggestions', async () => {
    const result = await run(good, 'main');
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.equal(result.repo.defaultBranch, 'main');
    assert.deepEqual(result.branches, ['main', 'develop']);
    assert.equal(result.branch?.found, true);
  });

  it('works without a branch, so the wizard can ask for the repo first and offer branches next', async () => {
    const result = await run(good);
    assert.equal(result.ok, true);
    assert.equal(result.branch, undefined);
    assert.deepEqual(result.branches, ['main', 'develop']);
  });

  it('says when the branch list may be incomplete, which is when GitHub filled a whole page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` }));
    const many = await run({ ...good, 'GET /repos/acme/web/branches?per_page=100': { status: 200, body: full } });
    assert.equal(many.branches.length, 100);
    assert.equal(many.branchesTruncated, true);

    const few = await run(good);
    assert.equal(few.branchesTruncated, false);
  });

  it('sends the token to GitHub, as a bearer token, on every request', async () => {
    await run(good, 'main');
    assert.ok(github!.requests.length >= 3);
    assert.ok(github!.requests.every((r) => r.authorization === `Bearer ${TOKEN}`));
  });

  it('says what is wrong when GitHub rejects the token, and what to do about it', async () => {
    const result = await run({ 'GET /repos/acme/web': { status: 401, body: { message: 'Bad credentials' } } });
    assert.equal(result.ok, false);
    assert.match(result.problems[0] ?? '', /token/i);
    assert.match(result.problems[0] ?? '', /expired|mistyped|new one|generate/i);
    assert.deepEqual(Object.keys(result.fields), ['token'], 'shown under the token field');
  });

  it('says so when the repo cannot be found with this token, covering both a typo and a token without access', async () => {
    const result = await run({});
    assert.equal(result.ok, false);
    assert.equal(result.repo.found, false);
    assert.match(result.problems[0] ?? '', /acme\/web/);
    assert.match(result.problems[0] ?? '', /access|name/i);
    assert.deepEqual(Object.keys(result.fields), ['repo'], 'shown under the repository field');
  });

  it('names the branches that do exist when the one asked for does not', async () => {
    const result = await run(
      { 'GET /repos/acme/web': { status: 200, body: repoBody }, 'GET /repos/acme/web/branches?per_page=100': { status: 200, body: [{ name: 'main' }, { name: 'develop' }] } },
      'mian',
    );
    assert.equal(result.ok, false);
    assert.equal(result.branch?.found, false);
    assert.match(result.problems[0] ?? '', /mian/);
    assert.match(result.problems[0] ?? '', /main, develop/);
    assert.deepEqual(Object.keys(result.fields), ['branch'], 'shown under the branch field');
  });

  it('blames the token, not the branch, when the token sees the repo but may not list its branches', async () => {
    const result = await run({ ...good, 'GET /repos/acme/web/branches?per_page=100': { status: 403, body: { message: 'Resource not accessible by personal access token' } } }, 'main');
    assert.equal(result.ok, false);
    assert.match(result.problems[0] ?? '', /403: Resource not accessible by personal access token/, "GitHub's own reason, not a guess");
    assert.deepEqual(Object.keys(result.fields), ['token'], 'shown under the token field');
  });

  it("passes on GitHub's reason when it will not say whether the branch exists, instead of calling it missing", async () => {
    const result = await run({ ...good, 'GET /repos/acme/web/branches/main': { status: 403, body: { message: 'API rate limit exceeded' } } }, 'main');
    assert.equal(result.ok, false);
    assert.match(result.problems[0] ?? '', /API rate limit exceeded/);
    assert.doesNotMatch(result.problems[0] ?? '', /has no branch/);
  });

  it('says so when the repo has no branches yet, instead of calling the branch a typo', async () => {
    const result = await run({ ...good, 'GET /repos/acme/web/branches?per_page=100': { status: 200, body: [] } }, 'main');
    assert.equal(result.ok, false);
    assert.match(result.problems[0] ?? '', /no branches yet/);
    assert.deepEqual(Object.keys(result.fields), ['repo']);
  });

  it('looks up a branch with a slash in its name', async () => {
    const result = await run({ ...good, 'GET /repos/acme/web/branches/release/2': { status: 200, body: { name: 'release/2' } } }, 'release/2');
    assert.equal(result.ok, true);
  });

  it('warns, without blocking, when the token can read the repo but not push to it', async () => {
    const result = await run({ ...good, 'GET /repos/acme/web': { status: 200, body: { ...repoBody, permissions: { push: false } } } }, 'main');
    assert.equal(result.ok, true);
    assert.equal(result.repo.canPush, false);
    assert.match(result.warnings[0] ?? '', /push|pull request/i);
  });

  it('reports GitHub being unreachable, naming the address', async () => {
    const result = await inspectRepo({ token: TOKEN, apiUrl: 'http://127.0.0.1:1', repo: 'acme/web', timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.match(result.problems[0] ?? '', /reach GitHub/i);
    assert.match(result.problems[0] ?? '', /127\.0\.0\.1:1/);
  });

  it('never puts the token in anything it returns', async () => {
    const results = [await run({}), await run({ 'GET /repos/acme/web': { status: 401 } }), await run(good, 'nope')];
    for (const result of results) assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
});
