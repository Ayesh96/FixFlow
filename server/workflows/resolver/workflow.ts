import type { Router } from 'express';
import { HttpError } from '../../errors.ts';
import type { ProjectStore } from '../../projects/store.ts';
import type { AttemptPage, ResolverStatus } from '../../types.ts';
import type { Store as ErrorsStore } from '../errors/store.ts';
import { prefixedLogger, type Logger, type Workflow } from '../types.ts';
import type { Config } from './config.ts';
import { GitHubClient } from './github.ts';
import { StoreIssueSource, type IssueSource } from './issueSource.ts';
import { Scheduler, type RepoSource } from './scheduler.ts';
import { Store } from './store.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface ResolverDeps {
  /** Keeps each project's repository cloned and current; without it every attempt clones from the network. */
  repos?: RepoSource;
  /** Defaults to reading the errors workflow's store; a seam for tests. */
  issueSource?: IssueSource;
  logger?: Logger;
}

/** Reads a non-negative integer query parameter, falling back when absent or malformed. */
function intParam(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : fallback;
  return Math.min(n, max);
}

/**
 * Automated fixes as a dashboard workflow: polls the errors workflow's open issues, lets a model
 * attempt a fix in a throwaway worktree, and opens a pull request when one verifies.
 *
 * It used to be a separate service with its own HTTP listener and admin token, which this
 * dashboard polled and which in turn polled the tracker. Both hops are gone: it reads issues from
 * the errors store directly and serves its two read-only routes on the dashboard's own API, so it
 * no longer listens on a socket at all.
 */
export class ResolverWorkflow implements Workflow {
  readonly id = 'resolver';
  readonly title = 'Resolver';
  private readonly store: Store;
  private readonly scheduler: Scheduler;

  constructor(config: Config, errors: ErrorsStore | null, projects: ProjectStore, deps: ResolverDeps = {}) {
    const logger = deps.logger ?? prefixedLogger('resolver');
    this.store = new Store(config.databasePath);
    const issueSource = deps.issueSource ?? (errors ? new StoreIssueSource(errors) : emptyIssueSource);
    this.scheduler = new Scheduler({
      issueSource,
      // One client per token: each project brings its own, so a project never borrows another's.
      githubFor: (token) => new GitHubClient({ token, apiUrl: config.githubApiUrl }),
      projects,
      ...(deps.repos ? { repos: deps.repos } : {}),
      store: this.store,
      config,
      logger,
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
    this.store.close();
  }

  routes(router: Router): void {
    router.get('/status', (_req, res) => {
      res.json({ ...this.scheduler.status(), stats: this.store.stats() } satisfies ResolverStatus);
    });

    // Runs a cycle now instead of waiting for the next poll. Answers at once; the attempts follow.
    router.post('/run', (_req, res) => {
      if (!this.scheduler.runNow()) throw new HttpError(409, 'A cycle is already running');
      res.status(202).json({ run: 'started' });
    });

    // Tries one error again now, even if the resolver already skipped or failed it, and asks the model not to give up.
    router.post('/issues/:fingerprint/run', async (req, res) => {
      const outcome = await this.scheduler.forceIssue(req.params.fingerprint as string);
      if (outcome === 'unknown') throw new HttpError(404, 'No such error');
      if (outcome === 'busy') throw new HttpError(409, 'This error is already being worked on');
      if (outcome === 'has-pr') throw new HttpError(409, 'This error already has a pull request open');
      if (outcome === 'unavailable') throw new HttpError(409, 'This error has no open GitHub issue to work from');
      res.status(202).json({ run: 'started' });
    });

    router.get('/attempts', (req, res) => {
      const limit = Math.max(1, intParam(req.query.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
      const offset = intParam(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      res.json({ attempts: this.store.listAttempts(limit, offset), limit, offset } satisfies AttemptPage);
    });
  }
}

/** Used when the resolver is enabled but the errors workflow isn't: nothing to poll, so it idles. */
const emptyIssueSource: IssueSource = {
  listIssues: async () => [],
  reportResolverStatus: async () => {},
};
