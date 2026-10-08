import type { Project } from '../../projects/store.ts';
import type { Logger } from '../types.ts';
import { BOT_SAFE_LABEL, isBotSafe } from './botsafe.ts';
import { formatIssueBody, formatIssueTitle, formatThresholdComment } from './format.ts';
import { formatRepo, parseRepo, type IssueTracker } from './github.ts';
import { computeFingerprint, fingerprintScope } from './grouping.ts';
import { SerialQueue } from './queue.ts';
import type { Store } from './store.ts';
import type { Triager } from './triage.ts';
import { LEVELS, type IssueRecord, type Level, type NormalizedEvent, type RepoRef } from './types.ts';

/** The project database, read on every event so a project added in the wizard works at once. */
export interface ProjectLookup {
  get(id: string): Project | undefined;
}

/** A GitHub client for one project: each project has its own token. */
export type TrackerFor = (project: Project) => IssueTracker;

export interface IngestOptions {
  /** Which repo, and with which token, each DSN project id reports to. Events for ids not here are stored but open no issues. */
  projects: ProjectLookup;
  minIssueLevel: Level;
  commentThresholds: number[];
  /** Minimum delay before retrying a failed issue creation for the same fingerprint. Default 60s. */
  retryCooldownMs?: number;
  /** Decides the `bot-safe` label for a new issue; defaults to the rule-based heuristic. */
  triage?: Triager;
  /** GitHub jobs allowed to wait before new ones are dropped. Default 500. */
  maxQueuedGithubJobs?: number;
}



/**
 * Persists and groups events synchronously (a few SQLite statements), then hands
 * GitHub side effects to a serial queue so a slow API never backs up ingestion.
 */
export class Ingestor {
  private readonly queue: SerialQueue;
  private readonly inFlight = new Set<string>();
  private readonly retryAfter = new Map<string, number>();
  private readonly warnedProjects = new Set<string>();

  private readonly store: Store;
  private readonly trackerFor: TrackerFor;
  private readonly options: IngestOptions;
  private readonly log: Logger;

  constructor(store: Store, trackerFor: TrackerFor, options: IngestOptions, log: Logger) {
    this.store = store;
    this.trackerFor = trackerFor;
    this.options = options;
    this.log = log;
    this.queue = new SerialQueue(options.maxQueuedGithubJobs ?? 500, (err) => this.log.error({ err }, 'GitHub job failed unexpectedly'));
  }

  ingest(event: NormalizedEvent, projectId: string): void {
    const fingerprint = computeFingerprint(event, fingerprintScope(projectId, event));
    const issue = this.store.recordEvent(event, fingerprint, formatIssueTitle(event), projectId);
    if (!issue) return; // SDK retry of an event we already have

    if (issue.githubIssueNumber === null) {
      this.openIssue(issue, event);
    } else if (this.options.commentThresholds.includes(issue.count)) {
      this.commentOnIssue(issue, issue.githubIssueNumber);
    }
  }

  /** Resolves when all queued GitHub work has finished (graceful shutdown, tests). */
  drain(): Promise<void> {
    return this.queue.drain();
  }

  /**
   * Creates the GitHub issue if none exists yet. Also covers earlier failures: the next
   * matching event retries once the cooldown has passed, so an outage delays issues
   * rather than losing them.
   */
  private openIssue(issue: IssueRecord, event: NormalizedEvent): void {
    const { fingerprintHash } = issue;
    if (LEVELS.indexOf(event.level) < LEVELS.indexOf(this.options.minIssueLevel)) return;
    const project = this.options.projects.get(issue.projectId);
    // A bare log line gives a developer little to act on, so by default it stays in the tracker and waits for an
    // occurrence that carries frames. A project can ask for those on GitHub too.
    if (!event.exceptions.some((exception) => exception.frames.length > 0) && !project?.issuesWithoutStack) return;
    const repo = project ? parseRepo(project.repo) : null;
    if (!project || !repo) {
      if (!this.warnedProjects.has(issue.projectId)) {
        this.warnedProjects.add(issue.projectId);
        this.log.warn({ projectId: issue.projectId }, 'No project with this id; events are stored but no issues are opened (add the project on the Projects tab)');
      }
      return;
    }
    if (this.inFlight.has(fingerprintHash)) return;
    if ((this.retryAfter.get(fingerprintHash) ?? 0) > Date.now()) return;

    this.inFlight.add(fingerprintHash);
    const accepted = this.queue.push(async () => {
      try {
        const botSafe = await (this.options.triage ?? (async (e) => isBotSafe(e)))(event);
        const created = await this.trackerFor(project).createIssue(repo, issue.title, formatIssueBody(event, fingerprintHash), botSafe ? [BOT_SAFE_LABEL] : []);
        this.store.setGithubIssue(fingerprintHash, created.number, created.url, formatRepo(repo));
        this.retryAfter.delete(fingerprintHash);
        this.log.info({ fingerprint: fingerprintHash, repo: formatRepo(repo), issue: created.number }, 'Opened GitHub issue');
      } catch (err) {
        this.retryAfter.set(fingerprintHash, Date.now() + (this.options.retryCooldownMs ?? 60_000));
        this.log.error({ err, fingerprint: fingerprintHash }, 'Failed to open GitHub issue');
      } finally {
        this.inFlight.delete(fingerprintHash);
      }
    });
    if (!accepted) {
      this.inFlight.delete(fingerprintHash);
      this.log.warn({ fingerprint: fingerprintHash }, 'GitHub queue full; issue creation deferred to the next occurrence');
    }
  }

  private commentOnIssue(issue: IssueRecord, issueNumber: number): void {
    // The repo the issue was opened in, not today's mapping, which may have changed since.
    const repo = issue.githubRepo ? parseRepo(issue.githubRepo) : null;
    if (!repo) return;
    // The token belongs to the project; if it was deleted there is nothing to comment with.
    const project = this.options.projects.get(issue.projectId);
    if (!project) return;
    const accepted = this.queue.push(async () => {
      try {
        await this.trackerFor(project).commentOnIssue(repo, issueNumber, formatThresholdComment(issue.count, issue.lastSeen));
      } catch (err) {
        this.log.error({ err, issue: issueNumber }, 'Failed to comment on GitHub issue');
      }
    });
    if (!accepted) this.log.warn({ issue: issueNumber }, 'GitHub queue full; threshold comment dropped');
  }
}
