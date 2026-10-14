import type { Router } from 'express';
import { HttpError } from '../../errors.ts';
import type { ChangeBus } from '../../events.ts';
import type { ProjectStore } from '../../projects/store.ts';
import type { TrackerIssue, TrackerProjectGroup, TrackerStatus } from '../../types.ts';
import { prefixedLogger, type Logger, type Workflow } from '../types.ts';
import type { Config } from './config.ts';
import { GitHubClient } from './github.ts';
import { Ingestor } from './ingest.ts';
import { ingestRoutes } from './ingestRoutes.ts';
import { Rejections } from './rejections.ts';
import { Store } from './store.ts';
import { modelTriager } from './triage.ts';
import { ERRORS_ISSUE_LIST_LIMIT, ERRORS_PRUNE_INTERVAL_MS } from '../../constants.ts';


export interface ErrorsDeps {
  logger?: Logger;
  /** Told when an error appears or changes, so the dashboard can update without asking. */
  events?: ChangeBus;
}

/**
 * Error tracking as a dashboard workflow: a Sentry-compatible ingest endpoint that groups errors
 * and opens one GitHub issue per new one.
 *
 * The store is in-process, so `routes` query it directly. What stays separate is the *ingest
 * listener*: SDKs and browsers must reach it without the dashboard's cookie, so those routes are
 * declared in `ingestRoutes` and mounted on their own socket (see server/ingest.ts).
 */
export class ErrorsWorkflow implements Workflow {
  readonly id = 'errors';
  readonly title = 'Errors';
  readonly store: Store;
  private readonly config: Config;
  private readonly projects: ProjectStore;
  private readonly ingestor: Ingestor;
  private readonly rejections: Rejections;
  private readonly logger: Logger;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Config, projects: ProjectStore, deps: ErrorsDeps = {}) {
    this.config = config;
    this.projects = projects;
    this.logger = deps.logger ?? prefixedLogger('errors');
    this.rejections = new Rejections({ logger: this.logger, onChange: () => deps.events?.publish('errors') });
    this.store = new Store(config.databasePath, () => deps.events?.publish('errors'));
    this.ingestor = new Ingestor(
      this.store,
      // Each project opens its issues with its own token.
      (project) => new GitHubClient({ token: project.token, apiUrl: config.github.apiUrl, labels: config.github.labels }),
      { ...config, projects, triage: config.llm.isAvailable('triage') ? modelTriager(config.llm) : undefined },
      this.logger,
    );
  }

  start(): void {
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), ERRORS_PRUNE_INTERVAL_MS).unref();
  }

  async stop(): Promise<void> {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    await this.ingestor.drain(); // let pending GitHub issues get created
    this.store.close();
  }

  routes(router: Router): void {
    router.get('/issues', (_req, res) => {
      res.json({ issues: this.store.listIssues(ERRORS_ISSUE_LIST_LIMIT, 0) satisfies TrackerIssue[] });
    });

    // The Errors tab: every project with its own errors, then any whose project has been deleted.
    router.get('/projects', (_req, res) => {
      const issues: TrackerIssue[] = this.store.listIssues(ERRORS_ISSUE_LIST_LIMIT, 0);
      const projects = this.projects.list();
      const known = new Set(projects.map((project) => project.id));

      const group = (project: { id: string; repo: string; branch: string | null } | null, mine: TrackerIssue[]): TrackerProjectGroup => ({
        projectId: project?.id ?? null,
        repo: project?.repo ?? null,
        branch: project?.branch ?? null,
        issueCount: mine.length,
        eventCount: mine.reduce((sum, issue) => sum + issue.count, 0),
        lastSeen: mine.reduce<string | null>((latest, issue) => (latest === null || issue.lastSeen > latest ? issue.lastSeen : latest), null),
        issues: mine,
        rejections: this.rejections.summary(project?.id ?? null),
      });
      const groups = projects.map((project) => group(project, issues.filter((issue) => issue.projectId === project.id)));
      // Most recent trouble first; quiet projects follow alphabetically.
      groups.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || (a.repo ?? '').localeCompare(b.repo ?? ''));
      const orphans = issues.filter((issue) => !known.has(issue.projectId));
      res.json({ projects: orphans.length > 0 ? [...groups, group(null, orphans)] : groups });
    });

    // Reads an error again, e.g. after the model was switched on or its prompt changed. Answers at once; the finding follows.
    router.post('/issues/:fingerprint/triage', (req, res) => {
      const outcome = this.ingestor.retriage(req.params.fingerprint as string);
      if (outcome === 'unknown') throw new HttpError(404, 'No such error');
      if (outcome === 'busy') throw new HttpError(409, 'This error is already being triaged');
      if (outcome === 'no-event') throw new HttpError(409, 'The stored events for this error are gone, so there is nothing to read again. It triages again when it next occurs.');
      res.status(202).json({ triage: 'started' });
    });

    // `healthy` is always true: the store is in this process, so there is nothing to be out of reach.
    router.get('/status', (_req, res) => {
      const { issues, events, lastEventAt } = this.store.stats();
      res.json({ healthy: true, issues, events, lastEventAt, reason: null } satisfies TrackerStatus);
    });
  }

  ingestRoutes(router: Router): void {
    ingestRoutes(router, this.ingestor, this.config.dsnPublicKey, this.rejections);
  }

  private prune(): void {
    if (this.config.retentionDays === 0) return;
    try {
      const removed = this.store.pruneEventsBefore(new Date(Date.now() - this.config.retentionDays * 86_400_000));
      if (removed > 0) this.logger.info({ removed }, 'Pruned old events');
    } catch (err) {
      this.logger.error({ err }, 'Event pruning failed');
    }
  }
}
