import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '../../projects/store.ts';
import type { Logger } from '../types.ts';
import { formatRepo, parseRepo, type Config } from './config.ts';
import { attemptFix as defaultAttemptFix } from './fixer.ts';
import { formatPullRequestBody, formatPullRequestTitle } from './format.ts';
import type { GitHubGateway } from './github.ts';
import type { Store } from './store.ts';
import type { IssueSource } from './issueSource.ts';
import type { AttemptStatus, GitHubIssue, PollStatus, RepoRef, TrackedIssue } from './types.ts';

/** Attempts in these states are never retried; every other state is fair game on the next poll. */
const TERMINAL_STATUSES = new Set<AttemptStatus>(['PR_OPEN', 'SKIPPED']);

interface Candidate {
  repo: RepoRef;
  issue: GitHubIssue;
  fingerprintHash: string;
  project: Project;
  /** Already authenticated as this project, so nothing downstream can pick up the wrong token. */
  github: GitHubGateway;
}

/** Keeps a clone of each project's repo up to date; see projects/repos.ts. */
export interface RepoSource {
  ensure(request: { repo: string; branch: string; token: string }): Promise<string>;
}

/** The project database as the scheduler sees it: read a project, and remember a branch learned from GitHub. */
export interface ProjectBranches {
  get(id: string): Project | undefined;
  setBranch(id: string, branch: string): void;
}

export interface SchedulerOptions {
  issueSource: IssueSource;
  /** A GitHub client for one token: each project uses its own. */
  githubFor: (token: string) => GitHubGateway;
  projects: ProjectBranches;
  /** Without it every attempt clones from the network, as before. */
  repos?: RepoSource;
  store: Store;
  config: Config;
  logger: Logger;
  /** Overridable for tests; defaults to the real clone/fix/verify pipeline. */
  attemptFix?: typeof defaultAttemptFix;
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export class Scheduler {
  private readonly issues: IssueSource;
  private readonly githubFor: (token: string) => GitHubGateway;
  private readonly projects: ProjectBranches;
  private readonly repos: RepoSource | undefined;
  private readonly store: Store;
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly attemptFix: typeof defaultAttemptFix;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private lastPollAt: string | null = null;
  private lastPollError: string | null = null;

  constructor(options: SchedulerOptions) {
    this.issues = options.issueSource;
    this.githubFor = options.githubFor;
    this.projects = options.projects;
    this.repos = options.repos;
    this.store = options.store;
    this.config = options.config;
    this.logger = options.logger;
    this.attemptFix = options.attemptFix ?? defaultAttemptFix;
  }

  status(): PollStatus {
    return { lastPollAt: this.lastPollAt, lastPollError: this.lastPollError };
  }

  /** Starts polling immediately, then on `config.pollIntervalMs`. */
  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.config.pollIntervalMs).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pollOnce(): Promise<void> {
    if (this.polling) {
      this.logger.warn('Skipping poll: the previous cycle is still running');
      return;
    }
    this.polling = true;
    try {
      const tracked = await this.issues.listIssues();
      const candidates = await this.selectCandidates(tracked);
      await runWithConcurrency(candidates, this.config.maxConcurrentFixes, (candidate) => this.processCandidate(candidate));
      this.lastPollError = null;
    } catch (err) {
      this.lastPollError = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, 'Poll cycle failed');
    } finally {
      this.lastPollAt = new Date().toISOString();
      this.polling = false;
    }
  }

  private async selectCandidates(tracked: TrackedIssue[]): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const item of tracked) {
      if (!item.githubIssueNumber || !item.githubRepo) continue;
      const repo = parseRepo(item.githubRepo);
      if (!repo) continue;

      // No project means no token to work with (it was deleted after the issue was filed): leave it be.
      const project = this.projects.get(item.projectId);
      if (!project) continue;

      const existing = this.store.getAttempt(item.githubRepo, item.githubIssueNumber);
      if (existing && TERMINAL_STATUSES.has(existing.status) && !this.isRetrySkipped(existing.status)) continue;

      const github = this.githubFor(project.resolverToken ?? project.token);
      let issue: GitHubIssue | null;
      try {
        issue = await github.getIssue(repo, item.githubIssueNumber);
      } catch (err) {
        this.logger.warn({ err, repo: item.githubRepo, issue: item.githubIssueNumber }, 'Could not check issue state; will retry next poll');
        continue;
      }
      if (!issue || issue.state !== 'open') continue;

      candidates.push({ repo, issue, fingerprintHash: item.fingerprintHash, project, github });
    }
    return candidates;
  }

  /** Only SKIPPED is ever re-run, and only when the testing flag is on. PR_OPEN stays blocked: re-running it would open a duplicate PR. */
  private isRetrySkipped(status: AttemptStatus): boolean {
    return this.config.retrySkippedAttempts && status === 'SKIPPED';
  }

  /** Mirrors the outcome onto the issue in the errors workflow's store, for the Errors tab to show. */
  private async reportToTracker(
    fingerprintHash: string,
    repoStr: string,
    issueNumber: number,
    status: Exclude<AttemptStatus, 'PENDING' | 'IN_PROGRESS'>,
    details: { prNumber?: number | null; prUrl?: string | null; reason?: string | null },
  ): Promise<void> {
    try {
      await this.issues.reportResolverStatus(fingerprintHash, status, details);
    } catch (err) {
      this.logger.warn({ err, repo: repoStr, issue: issueNumber }, 'Could not mirror resolver status onto the issue');
    }
  }

  /**
   * The branch to work on is the one the user gave the project. Projects imported from the old
   * settings were never given one, so the first attempt asks GitHub for the repo's default branch
   * and saves it, after which it is the project's branch like any other.
   */
  private async branchFor(project: Project, repo: RepoRef, github: GitHubGateway): Promise<string> {
    if (project.branch) return project.branch;
    const learned = await github.getDefaultBranch(repo);
    this.projects.setBranch(project.id, learned);
    return learned;
  }

  private async processCandidate({ repo, issue, fingerprintHash, project, github }: Candidate): Promise<void> {
    const repoStr = formatRepo(repo);
    this.store.beginAttempt(repoStr, issue.number, fingerprintHash);
    const workDir = join(tmpdir(), 'error-resolver', randomUUID());

    try {
      const token = project.resolverToken ?? project.token;
      const baseBranch = await this.branchFor(project, repo, github);
      // Pull the latest code first. A fix written against stale or missing code is worse than no fix, so a
      // failure here ends the attempt instead of falling back to whatever happens to be on disk.
      const localRepoPath = this.repos ? await this.repos.ensure({ repo: repoStr, branch: baseBranch, token }) : null;
      const outcome = await this.attemptFix({ repo, issue, workDir, token, baseBranch, localRepoPath, verifyCommand: project.verifyCommand }, this.config);

      if (outcome.kind === 'skipped') {
        this.store.recordResult(repoStr, issue.number, 'SKIPPED', { reason: outcome.reason });
        await this.reportToTracker(fingerprintHash, repoStr, issue.number, 'SKIPPED', { reason: outcome.reason });
        this.logger.info({ repo: repoStr, issue: issue.number, reason: outcome.reason }, 'Skipped issue');
        return;
      }
      if (outcome.kind === 'failed') {
        this.store.recordResult(repoStr, issue.number, 'FAILED', { reason: outcome.error });
        await this.reportToTracker(fingerprintHash, repoStr, issue.number, 'FAILED', { reason: outcome.error });
        this.logger.warn({ repo: repoStr, issue: issue.number, error: outcome.error }, 'Fix attempt failed');
        return;
      }

      const pr = await github.createPullRequest(repo, {
        title: formatPullRequestTitle(issue),
        body: formatPullRequestBody(issue, outcome.explanation, outcome.filesChanged, outcome.verifyRan, outcome.verified),
        head: outcome.branchName,
        base: outcome.baseBranch,
      });
      this.store.recordResult(repoStr, issue.number, 'PR_OPEN', { prNumber: pr.number, prUrl: pr.url });
      await this.reportToTracker(fingerprintHash, repoStr, issue.number, 'PR_OPEN', { prNumber: pr.number, prUrl: pr.url });
      this.logger.info({ repo: repoStr, issue: issue.number, pr: pr.url }, 'Opened pull request');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.recordResult(repoStr, issue.number, 'FAILED', { reason: message });
      await this.reportToTracker(fingerprintHash, repoStr, issue.number, 'FAILED', { reason: message });
      this.logger.error({ err, repo: repoStr, issue: issue.number }, 'Unexpected error while processing issue');
    }
  }
}
