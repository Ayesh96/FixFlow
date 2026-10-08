import { chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { defaultExec, type ExecFn } from './exec.ts';
import type { RepoRef } from './types.ts';

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

async function withAskpass<T>(token: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const scriptPath = `${tmpdir()}/${randomUUID()}`;
  try {
    writeFileSync(scriptPath, '#!/bin/sh\nprintf \'%s\' "$GIT_ASKPASS_TOKEN"\n');
    await chmod(scriptPath, 0o700);
    const env = {
      ...process.env,
      GIT_ASKPASS: scriptPath,
      GIT_ASKPASS_TOKEN: token,
      GIT_TERMINAL_PROMPT: '0',
    };
    return await fn(env);
  } finally {
    await rm(scriptPath, { force: true }).catch(() => {
      // Ignore errors during cleanup
    });
  }
}

export function buildRemoteUrl(repo: RepoRef): string {
  return `https://github.com/${repo.owner}/${repo.repo}.git`;
}

export async function cloneRepo(
  repo: RepoRef,
  token: string,
  destDir: string,
  baseBranch: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    await withAskpass(token, async (env) => {
      const remoteUrl = buildRemoteUrl(repo);
      await exec('git', ['clone', '--depth', '1', '--branch', baseBranch, '--single-branch', remoteUrl, destDir], {
        env,
        timeoutMs: 60_000,
      });
    });
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message = `git clone failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message);
  }
}

/**
 * A bare, single-branch, shallow clone: just the history of one branch, no working files. It is a
 * place for `git worktree add` to branch attempts off, not somewhere anyone edits, so it is
 * small and never has uncommitted changes to lose.
 */
export async function cloneBare(
  remoteUrl: string,
  token: string,
  destDir: string,
  branch: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    await withAskpass(token, (env) =>
      exec('git', ['clone', '--bare', '--depth', '1', '--single-branch', '--branch', branch, '--', remoteUrl, destDir], { env, timeoutMs: 120_000 }),
    );
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    throw new GitError(`git clone failed: ${String(stderr).slice(0, 500)}`);
  }
}

/** Brings one branch of a bare clone up to the remote's latest commit, adding the branch if it is new to this clone. */
export async function fetchBranch(
  repoPath: string,
  token: string,
  branch: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    await withAskpass(token, (env) =>
      exec('git', ['-C', repoPath, 'fetch', '--depth', '1', 'origin', `+refs/heads/${branch}:refs/heads/${branch}`], { env, timeoutMs: 120_000 }),
    );
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    throw new GitError(`git fetch of branch ${branch} failed: ${String(stderr).slice(0, 500)}`);
  }
}

/**
 * Creates an isolated working directory off an existing local clone, on a new branch built
 * from the latest `baseBranch` — avoids a fresh network clone when the repo is already checked
 * out locally, while still giving each attempt its own directory. Never touches `localRepoPath`'s
 * own checked-out branch or working tree; only its worktree/branch/ref metadata.
 */
export async function addWorktree(
  localRepoPath: string,
  destDir: string,
  branchName: string,
  baseBranch: string,
  token: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    // A stale branch from a previous failed attempt would block `worktree add -b`; drop it first.
    await exec('git', ['-C', localRepoPath, 'branch', '-D', branchName], { timeoutMs: 15_000 }).catch(() => {});
    await withAskpass(token, (env) =>
      exec('git', ['-C', localRepoPath, 'fetch', 'origin', baseBranch], { timeoutMs: 60_000, env }),
    );
    await exec('git', ['-C', localRepoPath, 'worktree', 'add', '-b', branchName, destDir, 'FETCH_HEAD'], {
      timeoutMs: 30_000,
    });
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message = `git worktree add failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message);
  }
}

/** Removes a worktree created by addWorktree and its branch. Best-effort, like cleanup — never throws. */
export async function removeWorktree(localRepoPath: string, destDir: string, branchName: string, exec: ExecFn = defaultExec): Promise<void> {
  await exec('git', ['-C', localRepoPath, 'worktree', 'remove', '--force', destDir], { timeoutMs: 15_000 }).catch(() => {});
  await exec('git', ['-C', localRepoPath, 'worktree', 'prune'], { timeoutMs: 15_000 }).catch(() => {});
  await exec('git', ['-C', localRepoPath, 'branch', '-D', branchName], { timeoutMs: 15_000 }).catch(() => {});
  await rm(destDir, { recursive: true, force: true }).catch(() => {});
}

export async function createBranch(
  dir: string,
  branchName: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    await exec('git', ['-C', dir, 'checkout', '-b', branchName], {
      cwd: dir,
      timeoutMs: 15_000,
    });
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message = `git checkout -b failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message);
  }
}

export async function hasChanges(dir: string, exec: ExecFn = defaultExec): Promise<boolean> {
  try {
    const result = await exec('git', ['-C', dir, 'status', '--porcelain'], {
      cwd: dir,
      timeoutMs: 15_000,
    });
    return result.stdout.trim().length > 0;
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message = `git status failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message);
  }
}

export async function changedFiles(dir: string, exec: ExecFn = defaultExec): Promise<string[]> {
  try {
    const result = await exec('git', ['-C', dir, 'status', '--porcelain'], {
      cwd: dir,
      timeoutMs: 15_000,
    });
    return result.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3));
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message = `git status failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message);
  }
}

export async function commitAll(
  dir: string,
  message: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    await exec('git', ['-C', dir, 'add', '-A'], {
      cwd: dir,
      timeoutMs: 15_000,
    });
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message_ = `git add -A failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message_);
  }

  try {
    await exec('git', ['-C', dir, '-c', 'user.name=error-resolver', '-c', 'user.email=error-resolver@localhost', 'commit', '-m', message], {
      cwd: dir,
      timeoutMs: 15_000,
    });
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message_ = `git commit failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message_);
  }
}

export async function push(
  dir: string,
  branchName: string,
  repo: RepoRef,
  token: string,
  exec: ExecFn = defaultExec,
): Promise<void> {
  try {
    await withAskpass(token, async (env) => {
      await exec('git', ['-C', dir, 'push', 'origin', branchName], {
        cwd: dir,
        env,
        timeoutMs: 60_000,
      });
    });
  } catch (error) {
    const stderr = (error as Record<string, unknown>)?.stderr ?? '';
    const message = `git push failed: ${String(stderr).slice(0, 500)}`;
    throw new GitError(message);
  }
}

export async function cleanup(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
