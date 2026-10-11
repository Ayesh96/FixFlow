import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApp } from '../../server/app.ts';
import { COOKIE_NAME } from '../../server/auth.ts';
import { RepoManager } from '../../server/projects/repos.ts';
import { SecretStore } from '../../server/projects/secrets.ts';
import { ProjectStore } from '../../server/projects/store.ts';
import { ProjectsWorkflow } from '../../server/projects/workflow.ts';
import { freePort, tempConfig } from '../helpers.ts';
import { silentLogger } from '../workflows/helpers.ts';
import { startFakeGithub, type FakeGithub } from './fakeGithub.ts';

const DASHBOARD_TOKEN = 'T'.repeat(43);
const AUTH = { cookie: `${COOKIE_NAME}=${DASHBOARD_TOKEN}` };
const GITHUB_TOKEN = 'ghp_wizard_token_that_must_never_come_back_out';

const GIT = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' }).trim();

function makeRemote(branches: string[]): string {
  const path = mkdtempSync(join(tmpdir(), 'wizard-remote-'));
  git(path, 'init', '-q', '-b', branches[0] as string);
  writeFileSync(join(path, 'app.txt'), 'v1');
  git(path, 'add', '-A');
  git(path, 'commit', '-q', '-m', 'first');
  for (const extra of branches.slice(1)) git(path, 'branch', extra);
  return `file://${path}`;
}

const repoReply = { status: 200, body: { private: true, default_branch: 'main', permissions: { push: true } } };
const githubRoutes = (branches: string[]): Record<string, { status: number; body?: unknown }> => ({
  'GET /repos/acme/web': repoReply,
  'GET /repos/acme/web/branches?per_page=100': { status: 200, body: branches.map((name) => ({ name })) },
  ...Object.fromEntries(branches.map((name) => [`GET /repos/acme/web/branches/${name}`, { status: 200, body: { name } }])),
});

describe('projects routes', () => {
  let github: FakeGithub;
  let server: Server;
  let base: string;
  let store: ProjectStore;
  let repos: RepoManager;
  let remoteUrl: string;
  /** A test can make GitHub answer differently, such as rejecting the token. */
  let override: ((method: string, path: string) => { status: number; body?: unknown }) | null = null;
  const bodies: string[] = [];

  beforeEach(async () => {
    const routes = githubRoutes(['main', 'staging']);
    override = null;
    github = await startFakeGithub((method, path) => override?.(method, path) ?? routes[`${method} ${path}`] ?? { status: 404, body: { message: 'Not Found' } });
    remoteUrl = makeRemote(['main', 'staging']);

    const dir = mkdtempSync(join(tmpdir(), 'wizard-'));
    store = new ProjectStore(join(dir, 'projects.db'), new SecretStore(join(dir, 'secret.key')));
    repos = new RepoManager({ dir: join(dir, 'repos'), remoteUrl: () => remoteUrl });
    const workflow = new ProjectsWorkflow({ projects: store, repos, githubApiUrl: github.url, ingest: { host: '127.0.0.1', port: 3000, dsnKey: null }, logger: silentLogger() });

    const port = await freePort();
    const config = await tempConfig({ port });
    server = createApp({ port, publicDir: config.home, token: DASHBOARD_TOKEN, workflows: [workflow] }).listen(port, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${port}/api/ext/projects`;
  });

  afterEach(async () => {
    // Whatever a response said, it must not contain the token the user typed in.
    for (const body of bodies.splice(0)) assert.ok(!body.includes(GITHUB_TOKEN), 'a response contained the GitHub token');
    server.closeAllConnections();
    server.close();
    store.close();
    await github.close();
  });

  const call = async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: { ...(init.headers ?? AUTH), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    bodies.push(text);
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : {} };
  };
  const create = (over: Record<string, unknown> = {}) => call('', { method: 'POST', body: { repo: 'acme/web', branch: 'main', token: GITHUB_TOKEN, ...over } });
  const listed = async () => (await call('')).json.projects as { id: string; repo: string; branch: string; verifyCommand: string | null; setup: { state: string; message: string } }[];
  const until = async (state: string, id = '1') => {
    for (let i = 0; i < 100; i++) {
      const project = (await listed()).find((p) => p.id === id);
      if (project?.setup.state === state) return project;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`project ${id} never reached "${state}": ${JSON.stringify(await listed())}`);
  };

  it('starts empty, and says where apps should send their errors', async () => {
    const { status, json } = await call('');
    assert.equal(status, 200);
    assert.deepEqual(json.projects, []);
    assert.deepEqual(json.ingest, { host: 'localhost', port: 3000 });
  });

  it('requires the dashboard login like every other route', async () => {
    for (const [path, method] of [['', 'GET'], ['', 'POST'], ['/check', 'POST'], ['/1', 'DELETE']] as const) {
      assert.equal((await call(path, { method, headers: {}, body: method === 'POST' ? {} : undefined })).status, 401, `${method} ${path}`);
    }
  });

  it('checks a token, repo and branch without saving anything', async () => {
    const { status, json } = await call('/check', { method: 'POST', body: { repo: 'acme/web', branch: 'main', token: GITHUB_TOKEN } });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(json.branches, ['main', 'staging']);
    assert.equal(json.repo.defaultBranch, 'main');
    assert.deepEqual(await listed(), []);
    assert.ok(github.requests.every((r) => r.authorization === `Bearer ${GITHUB_TOKEN}`));
  });

  it('adds a project, clones its repo on the branch the user named, and never hands the token back', async () => {
    const { status, json } = await create();
    assert.equal(status, 201);
    assert.deepEqual([json.project.id, json.project.repo, json.project.branch, json.project.tokenHint], ['1', 'acme/web', 'main', GITHUB_TOKEN.slice(-4)]);
    assert.equal(json.dsn, 'http://fixflow@localhost:3000/1');

    await until('ready');
    assert.equal(existsSync(repos.pathFor('acme/web')), true);
    assert.equal(store.get('1')?.token, GITHUB_TOKEN, 'the server keeps it, encrypted, for the resolver to use');
  });

  it('saves the command that checks a fix, and shows it back so it can be edited', async () => {
    const { status, json } = await create({ verifyCommand: ' npm ci && npm test ' });
    assert.equal(status, 201);
    assert.equal(json.project.verifyCommand, 'npm ci && npm test');
    assert.equal(store.get('1')?.verifyCommand, 'npm ci && npm test');
    assert.equal((await listed())[0]?.verifyCommand, 'npm ci && npm test');
  });

  it("changes a project's verify command, and clears it when emptied, leaving the rest alone", async () => {
    await create({ verifyCommand: 'npm test' });

    const changed = await call('/1', { method: 'PATCH', body: { verifyCommand: 'pytest -q' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.project.verifyCommand, 'pytest -q');
    assert.deepEqual([store.get('1')?.repo, store.get('1')?.branch, store.get('1')?.token], ['acme/web', 'main', GITHUB_TOKEN]);

    const cleared = await call('/1', { method: 'PATCH', body: { verifyCommand: '  ' } });
    assert.equal(cleared.json.project.verifyCommand, null);
    assert.equal(store.get('1')?.verifyCommand, null);
  });

  it("moves a project to another branch: checks it with GitHub, saves it, and clones that branch", async () => {
    await create();
    await until('ready');

    const { status, json } = await call('/1', { method: 'PATCH', body: { branch: 'staging' } });
    assert.equal(status, 200);
    assert.equal(json.project.branch, 'staging');
    assert.equal(store.get('1')?.branch, 'staging');
    await until('ready');
    assert.equal(git(repos.pathFor('acme/web'), 'rev-parse', '--verify', 'staging').length, 40);
  });

  it('refuses a branch that does not exist or is already another project, and keeps the old one', async () => {
    await create();
    await create({ branch: 'staging' });

    const missing = await call('/1', { method: 'PATCH', body: { branch: 'mian' } });
    assert.equal(missing.status, 422);
    assert.match(missing.json.fields.branch, /mian/);

    const taken = await call('/1', { method: 'PATCH', body: { branch: 'staging' } });
    assert.equal(taken.status, 409);
    assert.equal(store.get('1')?.branch, 'main');
  });

  it('replaces the token only after GitHub accepts the new one, and never echoes it', async () => {
    await create();
    const NEW = 'ghp_replacement_token_that_must_not_come_back';

    override = (_method, _path) => ({ status: 401, body: { message: 'Bad credentials' } });
    const rejected = await call('/1', { method: 'PATCH', body: { token: NEW } });
    assert.equal(rejected.status, 422);
    assert.match(rejected.json.fields.token, /rejected this token/i);
    assert.equal(store.get('1')?.token, GITHUB_TOKEN);

    override = null;
    const accepted = await call('/1', { method: 'PATCH', body: { token: NEW } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.project.tokenHint, NEW.slice(-4));
    assert.equal(store.get('1')?.token, NEW);
    assert.ok(github.requests.some((r) => r.authorization === `Bearer ${NEW}`), 'the new token was the one checked');
    assert.ok(bodies.every((body) => !body.includes(NEW)), 'no response contained the new token');
  });

  it('sets a separate pull-request token, checking it under its own field, and goes back to one token when emptied', async () => {
    await create();
    const PR = 'ghp_pull_request_token_that_must_not_come_back';

    override = () => ({ status: 401, body: { message: 'Bad credentials' } });
    const rejected = await call('/1', { method: 'PATCH', body: { resolverToken: PR } });
    assert.equal(rejected.status, 422);
    assert.match(rejected.json.fields.resolverToken, /rejected this token/i);
    assert.equal(store.get('1')?.resolverToken, null);

    override = null;
    const set = await call('/1', { method: 'PATCH', body: { resolverToken: PR } });
    assert.equal(set.json.project.hasResolverToken, true);
    assert.equal(store.get('1')?.resolverToken, PR);
    assert.ok(bodies.every((body) => !body.includes(PR)));

    const cleared = await call('/1', { method: 'PATCH', body: { resolverToken: '' } });
    assert.equal(cleared.json.project.hasResolverToken, false);
    assert.equal(store.get('1')?.resolverToken, null);
  });

  it('changes only the verify command without asking GitHub anything', async () => {
    await create();
    const before = github.requests.length;
    await call('/1', { method: 'PATCH', body: { verifyCommand: 'make test' } });
    assert.equal(github.requests.length, before);
  });

  it("lists the branches of a saved project using its own token, for the settings dropdown", async () => {
    await create();
    const { status, json } = await call('/1/branches');
    assert.equal(status, 200);
    assert.deepEqual(json, { branches: ['main', 'staging'], defaultBranch: 'main', truncated: false });
    assert.ok(github.requests.at(-1)?.authorization === `Bearer ${GITHUB_TOKEN}`);

    assert.equal((await call('/99/branches')).status, 404);
    assert.equal((await call('/1/branches', { headers: {} })).status, 401);

    override = () => ({ status: 401, body: { message: 'Bad credentials' } });
    const rejected = await call('/1/branches');
    assert.equal(rejected.status, 422);
    assert.match(rejected.json.error, /rejected this token/i);
  });

  it('chooses at adding, and later changes, whether errors without a stack trace also go to GitHub', async () => {
    const added = await create({ issuesWithoutStack: true });
    assert.equal(added.json.project.issuesWithoutStack, true);
    assert.equal(store.get('1')?.issuesWithoutStack, true);

    const off = await call('/1', { method: 'PATCH', body: { issuesWithoutStack: false } });
    assert.equal(off.json.project.issuesWithoutStack, false);
    assert.equal(store.get('1')?.issuesWithoutStack, false);

    const other = await create({ branch: 'staging' });
    assert.equal(other.json.project.issuesWithoutStack, false, 'off unless asked for');
  });

  it('answers 404 when editing a project that does not exist, and requires the login', async () => {
    assert.equal((await call('/99', { method: 'PATCH', body: { verifyCommand: 'x' } })).status, 404);
    assert.equal((await call('/1', { method: 'PATCH', headers: {}, body: {} })).status, 401);
  });

  it('clones the branch it was told, whatever it is called', async () => {
    await create({ branch: 'staging' });
    await until('ready');
    assert.equal(git(repos.pathFor('acme/web'), 'rev-parse', '--verify', 'staging').length, 40);
  });

  it('refuses a branch that does not exist, saving nothing and cloning nothing, and says which field is wrong', async () => {
    const { status, json } = await create({ branch: 'mian' });
    assert.equal(status, 422);
    assert.match(json.fields.branch, /mian/);
    assert.deepEqual(await listed(), []);
    assert.equal(existsSync(repos.pathFor('acme/web')), false);
  });

  it('refuses what cannot be a repo without spending a GitHub request on it', async () => {
    const { status, json } = await create({ repo: 'not a repo' });
    assert.equal(status, 422);
    assert.match(json.fields.repo, /owner\/name/);
    assert.equal(github.requests.length, 0);
  });

  it('refuses a token GitHub rejects, under the token field, saving and cloning nothing', async () => {
    override = () => ({ status: 401, body: { message: 'Bad credentials' } });
    const { status, json } = await create();
    assert.equal(status, 422);
    assert.match(json.fields.token, /rejected this token/i);
    assert.deepEqual(await listed(), []);
    assert.equal(existsSync(repos.pathFor('acme/web')), false);
  });

  it('refuses the same repo and branch twice, but takes the same repo on another branch', async () => {
    assert.equal((await create()).status, 201);
    const again = await create();
    assert.equal(again.status, 409);
    assert.match(again.json.error, /already/);
    assert.equal((await create({ branch: 'staging' })).status, 201);
    assert.equal((await listed()).length, 2);
  });

  it('keeps the project when the clone fails, says why, and clones again on retry', async () => {
    const good = remoteUrl;
    remoteUrl = 'file:///does/not/exist';
    assert.equal((await create()).status, 201);
    const failed = await until('failed');
    assert.match(failed.setup.message, /clone failed|does not exist|not a git/i);

    remoteUrl = good;
    assert.equal((await call('/1/retry', { method: 'POST', body: {} })).status, 202);
    await until('ready');
    assert.equal(existsSync(repos.pathFor('acme/web')), true);
  });

  it("removes a project and its clone, but keeps the clone while another branch of that repo still needs it", async () => {
    await create();
    await create({ branch: 'staging' });
    await until('ready', '1');
    await until('ready', '2');

    assert.equal((await call('/1', { method: 'DELETE' })).status, 204);
    assert.equal(existsSync(repos.pathFor('acme/web')), true, 'staging still uses it');
    assert.equal((await call('/2', { method: 'DELETE' })).status, 204);
    assert.equal(existsSync(repos.pathFor('acme/web')), false);
    assert.deepEqual(await listed(), []);
    assert.equal((await call('/2', { method: 'DELETE' })).status, 404);
  });
});
