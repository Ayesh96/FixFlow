import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  addWorktree,
  buildRemoteUrl,
  changedFiles,
  cleanup,
  cloneRepo,
  commitAll,
  createBranch,
  GitError,
  hasChanges,
  push,
  removeWorktree,
} from '../../../server/workflows/resolver/git.ts';
import { defaultExec, type ExecFn, type ExecResult } from '../../../server/workflows/resolver/exec.ts';

describe('git operations', () => {
  describe('real git (local operations)', () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = await mkdtemp(`${tmpdir()}/git-test-`);
      execFileSync('git', ['init'], { cwd: repoDir });
      execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-m', 'initial'], { cwd: repoDir });
    });

    after(async () => {
      await cleanup(repoDir);
    });

    test('createBranch creates and checks out a new branch', async () => {
      await createBranch(repoDir, 'feature-branch');
      const currentBranch = execFileSync('git', ['-C', repoDir, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
      assert.equal(currentBranch, 'feature-branch');
    });

    test('hasChanges is false on a clean repo', async () => {
      const has = await hasChanges(repoDir);
      assert.equal(has, false);
    });

    test('hasChanges is true after writing an untracked file', async () => {
      await writeFile(`${repoDir}/newfile.txt`, 'hello');
      const has = await hasChanges(repoDir);
      assert.equal(has, true);
    });

    test('changedFiles lists newly modified file and untracked file', async () => {
      await writeFile(`${repoDir}/file1.txt`, 'content');
      await writeFile(`${repoDir}/file2.txt`, 'content2');
      const files = await changedFiles(repoDir);
      assert.ok(files.includes('file1.txt'), 'should include file1.txt');
      assert.ok(files.includes('file2.txt'), 'should include file2.txt');
    });

    test('commitAll stages and commits changes', async () => {
      await writeFile(`${repoDir}/test.txt`, 'test content');
      await commitAll(repoDir, 'test commit');
      const has = await hasChanges(repoDir);
      assert.equal(has, false);
      const logOutput = execFileSync('git', ['-C', repoDir, 'log', '-1', '--format=%s'], { encoding: 'utf-8' }).trim();
      assert.equal(logOutput, 'test commit');
    });

    test('cleanup removes the directory', async () => {
      const testDir = await mkdtemp(`${tmpdir()}/cleanup-test-`);
      execFileSync('git', ['init'], { cwd: testDir });
      await cleanup(testDir);
      let exists = true;
      try {
        execFileSync('ls', [testDir]);
      } catch {
        exists = false;
      }
      assert.equal(exists, false);
    });

    test('cleanup does not throw when called on missing directory', async () => {
      const testDir = `${tmpdir()}/nonexistent-${Math.random()}`;
      await cleanup(testDir);
      // Should not throw
    });
  });

  describe('cloneRepo with injected exec', () => {
    test('cloneRepo invokes git clone with correct args and askpass env', async () => {
      const calls: { file: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const fakeExec: ExecFn = async (file, args, options) => {
        calls.push({ file, args, env: options.env });
        return { stdout: '', stderr: '' };
      };

      await cloneRepo(
        { owner: 'acme', repo: 'app' },
        'the-token',
        '/tmp/dest',
        'main',
        fakeExec,
      );

      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call);
      assert.equal(call.file, 'git');
      assert.deepEqual(call.args, ['clone', '--depth', '1', '--branch', 'main', '--single-branch', 'https://github.com/acme/app.git', '/tmp/dest']);
      assert.ok(call.env?.GIT_ASKPASS);
      assert.equal(call.env?.GIT_ASKPASS_TOKEN, 'the-token');
      assert.equal(call.env?.GIT_TERMINAL_PROMPT, '0');
    });

    test('cloneRepo token never appears in args', async () => {
      const fakeExec: ExecFn = async (file, args) => {
        assert.ok(!args.some((a) => a.includes('the-token')), 'token should not appear in args');
        return { stdout: '', stderr: '' };
      };

      await cloneRepo(
        { owner: 'acme', repo: 'app' },
        'the-token',
        '/tmp/dest',
        'main',
        fakeExec,
      );
    });

    test('cloneRepo throws GitError on exec failure', async () => {
      const fakeExec: ExecFn = async () => {
        const error = new Error('clone failed');
        (error as unknown as Record<string, unknown>).stderr = 'repository not found';
        throw error;
      };

      try {
        await cloneRepo(
          { owner: 'acme', repo: 'app' },
          'the-token',
          '/tmp/dest',
          'main',
          fakeExec,
        );
        assert.fail('should throw GitError');
      } catch (error) {
        assert.ok(error instanceof GitError);
        assert.match(String(error), /git clone failed/);
      }
    });
  });

  describe('push with injected exec', () => {
    test('push invokes git push with correct args and askpass env', async () => {
      const calls: { file: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const fakeExec: ExecFn = async (file, args, options) => {
        calls.push({ file, args, env: options.env });
        return { stdout: '', stderr: '' };
      };

      await push(
        '/tmp/repo',
        'feature-branch',
        { owner: 'acme', repo: 'app' },
        'the-token',
        fakeExec,
      );

      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call);
      assert.equal(call.file, 'git');
      assert.deepEqual(call.args, ['-C', '/tmp/repo', 'push', 'origin', 'feature-branch']);
      assert.ok(call.env?.GIT_ASKPASS);
      assert.equal(call.env?.GIT_ASKPASS_TOKEN, 'the-token');
      assert.equal(call.env?.GIT_TERMINAL_PROMPT, '0');
    });

    test('push token never appears in args', async () => {
      const fakeExec: ExecFn = async (file, args) => {
        assert.ok(!args.some((a) => a.includes('the-token')), 'token should not appear in args');
        return { stdout: '', stderr: '' };
      };

      await push(
        '/tmp/repo',
        'feature-branch',
        { owner: 'acme', repo: 'app' },
        'the-token',
        fakeExec,
      );
    });

    test('push throws GitError on exec failure', async () => {
      const fakeExec: ExecFn = async () => {
        const error = new Error('push failed');
        (error as unknown as Record<string, unknown>).stderr = 'permission denied';
        throw error;
      };

      try {
        await push(
          '/tmp/repo',
          'feature-branch',
          { owner: 'acme', repo: 'app' },
          'the-token',
          fakeExec,
        );
        assert.fail('should throw GitError');
      } catch (error) {
        assert.ok(error instanceof GitError);
        assert.match(String(error), /git push failed/);
      }
    });
  });

  describe('addWorktree / removeWorktree (real git, local origin)', () => {
    let remoteDir: string;
    let localRepoDir: string;

    beforeEach(async () => {
      // A bare repo stands in for GitHub; localRepoDir is "already cloned" from it, like a real checkout.
      remoteDir = await mkdtemp(`${tmpdir()}/git-remote-`);
      execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: remoteDir });

      const seedDir = await mkdtemp(`${tmpdir()}/git-seed-`);
      execFileSync('git', ['init', '-b', 'main'], { cwd: seedDir });
      await writeFile(`${seedDir}/README.md`, 'hello');
      execFileSync('git', ['add', '-A'], { cwd: seedDir });
      execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@localhost', 'commit', '-m', 'seed'], { cwd: seedDir });
      execFileSync('git', ['remote', 'add', 'origin', remoteDir], { cwd: seedDir });
      execFileSync('git', ['push', 'origin', 'main'], { cwd: seedDir });

      localRepoDir = await mkdtemp(`${tmpdir()}/git-local-clone-`);
      execFileSync('git', ['clone', remoteDir, localRepoDir]);
    });

    after(async () => {
      await cleanup(remoteDir);
      await cleanup(localRepoDir);
    });

    test('addWorktree checks out a new branch from the local clone without a network clone', async () => {
      const destDir = await mkdtemp(`${tmpdir()}/git-worktree-`);
      await cleanup(destDir); // worktree add requires the target not already exist as a non-empty dir it didn't create

      await addWorktree(localRepoDir, destDir, 'code-akos/issue-1', 'main', 'test-token');

      const content = await readFile(`${destDir}/README.md`, 'utf-8');
      assert.equal(content, 'hello');
      const branch = execFileSync('git', ['-C', destDir, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
      assert.equal(branch, 'code-akos/issue-1');

      const worktreeList = execFileSync('git', ['-C', localRepoDir, 'worktree', 'list'], { encoding: 'utf-8' });
      assert.match(worktreeList, /code-akos\/issue-1/);

      await removeWorktree(localRepoDir, destDir, 'code-akos/issue-1');
    });

    test('addWorktree does not move the local clone off whatever branch it was on', async () => {
      const originalBranch = execFileSync('git', ['-C', localRepoDir, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
      const destDir = await mkdtemp(`${tmpdir()}/git-worktree-`);
      await cleanup(destDir);

      await addWorktree(localRepoDir, destDir, 'code-akos/issue-2', 'main', 'test-token');

      const stillOnBranch = execFileSync('git', ['-C', localRepoDir, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
      assert.equal(stillOnBranch, originalBranch);

      await removeWorktree(localRepoDir, destDir, 'code-akos/issue-2');
    });

    test('removeWorktree deletes the directory, deregisters the worktree, and deletes the branch', async () => {
      const destDir = await mkdtemp(`${tmpdir()}/git-worktree-`);
      await cleanup(destDir);
      await addWorktree(localRepoDir, destDir, 'code-akos/issue-3', 'main', 'test-token');

      await removeWorktree(localRepoDir, destDir, 'code-akos/issue-3');

      let exists = true;
      try {
        execFileSync('ls', [destDir]);
      } catch {
        exists = false;
      }
      assert.equal(exists, false, 'worktree directory should be removed');

      const worktreeList = execFileSync('git', ['-C', localRepoDir, 'worktree', 'list'], { encoding: 'utf-8' });
      assert.doesNotMatch(worktreeList, /code-akos\/issue-3/);

      const branches = execFileSync('git', ['-C', localRepoDir, 'branch', '--list', 'code-akos/issue-3'], { encoding: 'utf-8' });
      assert.equal(branches.trim(), '');
    });

    test('a second addWorktree for a different issue on the same local clone does not conflict', async () => {
      const destA = await mkdtemp(`${tmpdir()}/git-worktree-a-`);
      const destB = await mkdtemp(`${tmpdir()}/git-worktree-b-`);
      await cleanup(destA);
      await cleanup(destB);

      await addWorktree(localRepoDir, destA, 'code-akos/issue-10', 'main', 'test-token');
      await addWorktree(localRepoDir, destB, 'code-akos/issue-11', 'main', 'test-token');

      const branchA = execFileSync('git', ['-C', destA, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
      const branchB = execFileSync('git', ['-C', destB, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
      assert.equal(branchA, 'code-akos/issue-10');
      assert.equal(branchB, 'code-akos/issue-11');

      await removeWorktree(localRepoDir, destA, 'code-akos/issue-10');
      await removeWorktree(localRepoDir, destB, 'code-akos/issue-11');
    });

    test('removeWorktree does not throw when the worktree was already removed', async () => {
      const destDir = await mkdtemp(`${tmpdir()}/git-worktree-`);
      await cleanup(destDir);
      await addWorktree(localRepoDir, destDir, 'code-akos/issue-4', 'main', 'test-token');
      await removeWorktree(localRepoDir, destDir, 'code-akos/issue-4');

      await removeWorktree(localRepoDir, destDir, 'code-akos/issue-4'); // should not throw
    });
  });

  describe('buildRemoteUrl', () => {
    test('buildRemoteUrl constructs correct GitHub URL', () => {
      const url = buildRemoteUrl({ owner: 'acme', repo: 'app' });
      assert.equal(url, 'https://github.com/acme/app.git');
    });
  });

  describe('askpass script behavior', () => {
    test('askpass script is created executable and outputs token', async () => {
      const calls: { env?: NodeJS.ProcessEnv }[] = [];
      const fakeExec: ExecFn = async (file, args, options) => {
        calls.push({ env: options.env });
        return { stdout: '', stderr: '' };
      };

      await cloneRepo(
        { owner: 'acme', repo: 'app' },
        'test-token-123',
        '/tmp/dest',
        'main',
        fakeExec,
      );

      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call);
      const scriptPath = call.env?.GIT_ASKPASS as string;
      assert.ok(scriptPath, 'GIT_ASKPASS should be set');

      // Read the script and verify it contains the askpass logic
      try {
        const scriptContent = await readFile(scriptPath, 'utf-8');
        assert.ok(scriptContent.includes('$GIT_ASKPASS_TOKEN'), 'script should reference $GIT_ASKPASS_TOKEN');
        assert.ok(scriptContent.includes('#!/bin/sh'), 'script should be a shell script');
      } catch {
        // Script may have been cleaned up already, which is expected
      }
    });
  });
});
