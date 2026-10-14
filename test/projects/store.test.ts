import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { SecretStore } from '../../server/projects/secrets.ts';
import { ProjectError, ProjectStore } from '../../server/projects/store.ts';

const TOKEN = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaWXYZ';
const RESOLVER_TOKEN = 'ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbQRST';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'projects-'));
  const open = () => new ProjectStore(join(dir, 'projects.db'), new SecretStore(join(dir, 'secret.key')));
  return { dir, open, store: open() };
}

const input = (over: Record<string, unknown> = {}) => ({ repo: 'acme/web', branch: 'main', token: TOKEN, ...over });

describe('ProjectStore', () => {
  it('stores a project and hands the token back to the server, but never to the browser', () => {
    const { store } = setup();
    const added = store.add(input());
    assert.equal(store.get(added.id)?.token, TOKEN);

    const [shown] = store.listPublic();
    assert.deepEqual(shown, { id: added.id, repo: 'acme/web', branch: 'main', tokenHint: 'WXYZ', hasResolverToken: false, verifyCommand: null, issuesWithoutStack: false, createdAt: added.createdAt });
    assert.ok(!JSON.stringify(store.listPublic()).includes(TOKEN));
  });

  it('remembers the command that checks a fix, across a restart, and has none unless one was given', () => {
    const { open, store } = setup();
    const withCommand = store.add(input({ branch: 'main', verifyCommand: 'npm ci && npm test' }));
    const without = store.add(input({ branch: 'staging' }));
    store.close();

    const reopened = open();
    assert.equal(reopened.get(withCommand.id)?.verifyCommand, 'npm ci && npm test');
    assert.equal(reopened.get(without.id)?.verifyCommand, null);
  });

  it('updates the settings a project can change, keeping the rest, and seals a new token like the first', () => {
    const { dir, store } = setup();
    const { id } = store.add(input({ verifyCommand: 'npm test' }));
    const NEW_TOKEN = 'ghp_cccccccccccccccccccccccccccccccc9876';

    const updated = store.update(id, { branch: 'staging', token: NEW_TOKEN, resolverToken: RESOLVER_TOKEN, verifyCommand: ' pytest ' });
    assert.deepEqual([updated.branch, updated.token, updated.resolverToken, updated.verifyCommand], ['staging', NEW_TOKEN, RESOLVER_TOKEN, 'pytest']);
    assert.equal(updated.repo, 'acme/web');
    assert.equal(updated.createdAt, store.get(id)?.createdAt);

    const untouched = store.update(id, {});
    assert.deepEqual([untouched.branch, untouched.token, untouched.resolverToken, untouched.verifyCommand], ['staging', NEW_TOKEN, RESOLVER_TOKEN, 'pytest']);

    const cleared = store.update(id, { resolverToken: null, verifyCommand: null });
    assert.deepEqual([cleared.resolverToken, cleared.verifyCommand], [null, null]);

    for (const file of readdirSync(dir).filter((name) => name !== 'secret.key')) {
      assert.ok(!readFileSync(join(dir, file)).toString('latin1').includes(NEW_TOKEN), `${file} contains the new token`);
    }
  });

  it('refuses an update that would break the rules a new project follows, changing nothing', () => {
    const { store } = setup();
    const main = store.add(input({ branch: 'main' }));
    store.add(input({ branch: 'staging' }));

    assert.throws(() => store.update(main.id, { branch: 'staging' }), (err) => err instanceof ProjectError && err.code === 'duplicate');
    assert.throws(() => store.update(main.id, { branch: 'not valid' }), (err) => err instanceof ProjectError && err.field === 'branch');
    assert.throws(() => store.update(main.id, { token: '  ' }), (err) => err instanceof ProjectError && err.field === 'token');
    assert.throws(() => store.update('99', {}), (err) => err instanceof ProjectError && err.code === 'invalid');
    assert.deepEqual([store.get(main.id)?.branch, store.get(main.id)?.token], ['main', TOKEN]);
  });

  it('keeps errors without a stack trace off GitHub unless the project asks for them, and remembers the choice', () => {
    const { open, store } = setup();
    const quiet = store.add(input({ branch: 'main' }));
    const noisy = store.add(input({ branch: 'staging', issuesWithoutStack: true }));
    assert.equal(quiet.issuesWithoutStack, false);
    assert.equal(noisy.issuesWithoutStack, true);

    assert.equal(store.update(quiet.id, { issuesWithoutStack: true }).issuesWithoutStack, true);
    assert.equal(store.update(quiet.id, {}).issuesWithoutStack, true, 'an edit that leaves it out keeps it');
    assert.equal(store.update(quiet.id, { issuesWithoutStack: false }).issuesWithoutStack, false);
    assert.equal(store.listPublic().find((p) => p.id === noisy.id)?.issuesWithoutStack, true);

    store.close();
    const reopened = open();
    assert.equal(reopened.get(noisy.id)?.issuesWithoutStack, true);
    assert.equal(reopened.get(quiet.id)?.issuesWithoutStack, false);
  });

  it('opens a database made before projects had a verify command, keeping what it holds', () => {
    const { dir } = setup();
    const secrets = new SecretStore(join(dir, 'secret.key'));
    const oldPath = join(dir, 'old.db');
    const old = new DatabaseSync(oldPath);
    old.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, repo TEXT NOT NULL, branch TEXT, token_enc TEXT NOT NULL, resolver_token_enc TEXT, created_at TEXT NOT NULL)');
    old.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)').run('7', 'acme/web', 'main', secrets.seal(TOKEN), null, '2026-01-01T00:00:00.000Z');
    old.close();

    const store = new ProjectStore(oldPath, secrets);
    assert.equal(store.get('7')?.token, TOKEN);
    assert.equal(store.get('7')?.verifyCommand, null);
  });

  it('never writes a token to disk in the clear, in the database or its journal files', () => {
    const { dir, store } = setup();
    store.add(input({ resolverToken: RESOLVER_TOKEN }));
    for (const file of readdirSync(dir).filter((name) => name !== 'secret.key')) {
      const bytes = readFileSync(join(dir, file)).toString('latin1');
      assert.ok(!bytes.includes(TOKEN), `${file} contains the token`);
      assert.ok(!bytes.includes(RESOLVER_TOKEN), `${file} contains the resolver token`);
    }
  });

  it('keeps projects, and can still decrypt their tokens, after a restart', () => {
    const { open, store } = setup();
    const { id } = store.add(input({ resolverToken: RESOLVER_TOKEN }));
    store.close();
    const reopened = open();
    assert.equal(reopened.get(id)?.token, TOKEN);
    assert.equal(reopened.get(id)?.resolverToken, RESOLVER_TOKEN);
    assert.equal(reopened.list().length, 1);
  });

  it('numbers projects 1, 2, 3 so they can be used as Sentry DSN project ids', () => {
    const { store } = setup();
    assert.deepEqual([store.add(input()).id, store.add(input({ repo: 'acme/api' })).id, store.add(input({ repo: 'acme/cli' })).id], ['1', '2', '3']);
  });

  it("never gives a new project a deleted one's id, even after a restart, so its old errors cannot follow", () => {
    const { open, store } = setup();
    const first = store.add(input());
    store.remove(first.id);
    store.close();
    assert.equal(open().add(input({ repo: 'acme/api' })).id, '2');
  });

  it('keeps an explicit id (an imported project keeps the DSN apps already use) and numbers on from it', () => {
    const { store } = setup();
    assert.equal(store.add(input({ id: '37' })).id, '37');
    assert.equal(store.add(input({ repo: 'acme/api' })).id, '38');
    assert.throws(() => store.add(input({ repo: 'acme/other', id: '37' })), (err) => err instanceof ProjectError && err.code === 'duplicate');
  });

  it('allows the same repo on two branches, but not the same repo and branch twice', () => {
    const { store } = setup();
    store.add(input());
    store.add(input({ branch: 'staging' }));
    assert.throws(() => store.add(input()), (err) => err instanceof ProjectError && err.code === 'duplicate');
    assert.equal(store.findByRepo('acme/web').length, 2);
  });

  it('refuses what cannot be a repo, a branch or a token, and says which', () => {
    const { store } = setup();
    const fails = (over: Record<string, unknown>, message: RegExp) =>
      assert.throws(() => store.add(input(over)), (err) => err instanceof ProjectError && err.code === 'invalid' && message.test(err.message));
    fails({ repo: 'not-a-repo' }, /owner\/name/);
    fails({ repo: 'a/b/c' }, /owner\/name/);
    fails({ branch: '' }, /branch/i);
    fails({ branch: 'has space' }, /branch/i);
    fails({ branch: 'a..b' }, /branch/i);
    fails({ branch: '-rf' }, /branch/i);
    fails({ token: '   ' }, /token/i);
    fails({ id: 'no spaces' }, /id/i);
    assert.equal(store.list().length, 0);
  });

  it('accepts branch names that real repos use', () => {
    const { store } = setup();
    for (const [i, branch] of ['main', 'master', 'trunk', 'release/1.2', 'feature/x_y-z', 'v2.0'].entries()) {
      assert.equal(store.add(input({ repo: `acme/r${i}`, branch })).branch, branch);
    }
  });

  it('records a branch learned later (imported projects start without one), and removes projects', () => {
    const { store } = setup();
    const { id } = store.add(input({ branch: null }));
    assert.equal(store.get(id)?.branch, null);
    store.setBranch(id, 'master');
    assert.equal(store.get(id)?.branch, 'master');
    assert.equal(store.remove(id), true);
    assert.equal(store.get(id), undefined);
    assert.equal(store.remove(id), false);
  });
});
