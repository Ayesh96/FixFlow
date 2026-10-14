import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildRemoteUrl, cloneBare, fetchBranch } from '../workflows/resolver/git.ts';

export interface RepoManagerOptions {
  /** Where clones live, one folder per repo. */
  dir: string;
  /** Where to clone from. GitHub by default; a test points it at a local repository. */
  remoteUrl?: (repo: string) => string;
}

export interface RepoRequest {
  /** `owner/name` */
  repo: string;
  branch: string;
  token: string;
}

/**
 * Keeps one clone of each project's repository, so the resolver never clones from scratch.
 *
 * The clone is made once, when the project is added, and brought up to date before each fix. It lives
 * in its own folder, never one you work in, so fetching can never
 * disturb work in progress there. It is bare (history only) and shallow, so a repo costs little disk.
 *
 * One clone serves every branch of a repo: `main` and `staging` as two projects share it.
 */
export class RepoManager {
  private readonly dir: string;
  private readonly remoteUrl: (repo: string) => string;
  /** Calls for the same repo queue up, so two projects added together cannot clone into one folder. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: RepoManagerOptions) {
    this.dir = options.dir;
    this.remoteUrl = options.remoteUrl ?? ((repo) => buildRemoteUrl({ owner: repo.split('/')[0] as string, repo: repo.split('/')[1] as string }));
  }

  pathFor(repo: string): string {
    return join(this.dir, ...repo.toLowerCase().split('/'));
  }

  /**
   * Makes sure the repo is cloned with `branch` at its latest commit, and returns the clone's path.
   * Safe to call as often as you like: the first call clones, later ones only fetch.
   */
  ensure({ repo, branch, token }: RepoRequest, onProgress: (message: string) => void = () => {}): Promise<string> {
    return this.locked(repo, async () => {
      const path = this.pathFor(repo);
      if (isClone(path)) {
        onProgress(`Fetching the latest ${branch}`);
        await fetchBranch(path, token, branch);
        return path;
      }

      await rm(path, { recursive: true, force: true }); // a leftover from a crashed run is not a clone
      await mkdir(dirname(path), { recursive: true });
      onProgress(`Cloning ${repo} (${branch})`);
      // Clone beside the destination and move it into place, so a failure never leaves a half-made clone at `path`.
      const partial = `${path}.partial-${randomUUID()}`;
      try {
        await cloneBare(this.remoteUrl(repo), token, partial, branch);
        await rename(partial, path);
      } catch (err) {
        await rm(partial, { recursive: true, force: true });
        throw err;
      }
      return path;
    });
  }

  async remove(repo: string): Promise<void> {
    await this.locked(repo, async () => {
      const path = this.pathFor(repo);
      await rm(path, { recursive: true, force: true });
      // The owner's folder too, once no other repo of theirs is cloned (rmdir refuses a folder that is not empty).
      await rmdir(dirname(path)).catch(() => {});
    });
  }

  private locked<T>(repo: string, task: () => Promise<T>): Promise<T> {
    const key = repo.toLowerCase();
    const run = (this.locks.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}

/** A real bare clone has these; a folder without them is debris. */
function isClone(path: string): boolean {
  return existsSync(join(path, 'HEAD')) && existsSync(join(path, 'objects'));
}
