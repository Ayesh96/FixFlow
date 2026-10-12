import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { addWorktree } from '../../server/workflows/resolver/git.ts';
import { RepoManager } from '../../server/projects/repos.ts';

const GIT = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' }).trim();

/** A real git repository standing in for GitHub: cloned from over file://, so nothing needs the internet. */
function makeRemote(branch = 'main') {
  const path = mkdtempSync(join(tmpdir(), 'remote-'));
  git(path, 'init', '-q', '-b', branch);
  const commit = (file: string, content: string): string => {
    writeFileSync(join(path, file), content);
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '-m', `edit ${file}`);
    return git(path, 'rev-parse', 'HEAD');
  };
  const first = commit('app.txt', 'v1');
  return { path, url: `file://${path}`, commit, first, branch: (name: string) => git(path, 'branch', name) };
}

function setup(remote: { url: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'repos-'));
  const manager = new RepoManager({ dir, remoteUrl: () => remote.url });
  return { dir, manager };
}

const project = (over: Record<string, string> = {}) => ({ repo: 'acme/web', branch: 'main', token: 'ghp_test', ...over });
const tip = (repoPath: string, branch: string): string => git(repoPath, 'rev-parse', branch);

describe('RepoManager', () => {
  it('clones the project repo on the branch the user named, into a folder of its own', async () => {
    const remote = makeRemote('main');
    const { dir, manager } = setup(remote);
    const path = await manager.ensure(project());
    assert.ok(path.startsWith(dir), 'inside its own folder, never the app working directory');
    assert.equal(tip(path, 'main'), remote.first);
  });

  it('works with master, trunk or any other branch name, exactly as given', async () => {
    for (const branch of ['master', 'trunk', 'release/2']) {
      const remote = makeRemote(branch);
      const { manager } = setup(remote);
      const path = await manager.ensure(project({ branch }));
      assert.equal(tip(path, branch), remote.first, branch);
    }
  });

  it('fetches the latest commit on later calls, without cloning again', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    const path = await manager.ensure(project());
    const second = remote.commit('app.txt', 'v2');
    assert.equal(await manager.ensure(project()), path);
    assert.equal(tip(path, 'main'), second);
  });

  it('adds a second branch of the same repo to the same clone (main and staging are two projects)', async () => {
    const remote = makeRemote('main');
    remote.branch('staging');
    const { manager } = setup(remote);
    const path = await manager.ensure(project());
    assert.equal(await manager.ensure(project({ branch: 'staging' })), path);
    assert.equal(tip(path, 'staging'), remote.first);
  });

  it('fails with a message that names the branch when it does not exist, and leaves no half-made clone behind', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    await assert.rejects(manager.ensure(project({ branch: 'nope' })), /nope/);
    assert.equal(existsSync(manager.pathFor('acme/web')), false);
    // and the next attempt, with the right branch, works from a clean slate
    assert.equal(tip(await manager.ensure(project()), 'main'), remote.first);
  });

  it('replaces a leftover folder that is not a real clone, such as one from a crashed earlier run', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    mkdirSync(manager.pathFor('acme/web'), { recursive: true });
    writeFileSync(join(manager.pathFor('acme/web'), 'junk.txt'), 'not a repo');
    const path = await manager.ensure(project());
    assert.equal(tip(path, 'main'), remote.first);
    assert.equal(existsSync(join(path, 'junk.txt')), false);
  });

  it('clones once when asked twice at the same moment', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    const messages: string[] = [];
    const [a, b] = await Promise.all([manager.ensure(project(), (m) => messages.push(m)), manager.ensure(project(), (m) => messages.push(m))]);
    assert.equal(a, b);
    assert.equal(messages.filter((m) => /cloning/i.test(m)).length, 1);
    assert.equal(tip(a, 'main'), remote.first);
  });

  it('reports what it is doing, so a screen can show progress', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    const messages: string[] = [];
    await manager.ensure(project(), (m) => messages.push(m));
    assert.match(messages[0] ?? '', /cloning/i);
    const again: string[] = [];
    await manager.ensure(project(), (m) => again.push(m));
    assert.match(again[0] ?? '', /latest|fetch/i);
  });

  it('gives the resolver a working copy of the newest commit, which is the "pull latest, then try to fix" step', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    const path = await manager.ensure(project());
    remote.commit('app.txt', 'v2-new-upstream');

    const work = join(mkdtempSync(join(tmpdir(), 'work-')), 'attempt');
    await addWorktree(path, work, 'fixflow/issue-7', 'main', 'ghp_test');
    assert.equal(readFileSync(join(work, 'app.txt'), 'utf8'), 'v2-new-upstream');
    assert.equal(git(work, 'branch', '--show-current'), 'fixflow/issue-7');
  });

  it('removes a clone', async () => {
    const remote = makeRemote();
    const { manager } = setup(remote);
    const path = await manager.ensure(project());
    await manager.remove('acme/web');
    assert.equal(existsSync(path), false);
    await manager.remove('acme/web'); // already gone is fine
  });
});
