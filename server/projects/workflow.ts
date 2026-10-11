import { existsSync } from 'node:fs';
import type { Router } from 'express';
import { HttpError } from '../errors.ts';
import type { ChangeBus } from '../events.ts';
import { prefixedLogger, type Logger, type Workflow } from '../workflows/types.ts';
import { inspectRepo, type RepoInspection } from './github.ts';
import type { RepoManager } from './repos.ts';
import { checkProjectInput, ProjectError, type Project, type ProjectPatch, type ProjectStore, type PublicProject } from './store.ts';

/** Where a project's repository clone has got to, for the wizard to show. */
export interface SetupStatus {
  /** `idle`: nothing started (a project from before cloning existed; it clones on its first fix). */
  state: 'idle' | 'working' | 'ready' | 'failed';
  message: string;
  updatedAt: string | null;
}

export interface ProjectsDeps {
  projects: ProjectStore;
  repos: RepoManager;
  githubApiUrl: string;
  /** Where apps send errors, so the wizard can show the address. Null when error tracking is off. */
  ingest: { host: string; port: number; dsnKey: string | null } | null;
  logger?: Logger;
  /** Told when a project or its clone changes, so the dashboard can update without asking. */
  events?: ChangeBus;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const LOOPBACK = new Set(['127.0.0.1', '::1', '0.0.0.0', '::']);

/**
 * The Projects tab's backend: add a repo with the branch to work on and a token, and it checks
 * the token against GitHub, saves it, and clones the repo in the background.
 *
 * It rides on the dashboard's own API, so the same login protects it. The token is only ever
 * accepted here and used by the server; no response contains it.
 */
export class ProjectsWorkflow implements Workflow {
  readonly id = 'projects';
  readonly title = 'Projects';
  private readonly deps: ProjectsDeps;
  private readonly logger: Logger;
  private readonly setups = new Map<string, SetupStatus>();

  constructor(deps: ProjectsDeps) {
    this.deps = deps;
    this.logger = deps.logger ?? prefixedLogger('projects');
  }

  routes(router: Router): void {
    router.get('/', (_req, res) => {
      const { ingest } = this.deps;
      res.json({
        projects: this.deps.projects.listPublic().map((project) => ({ ...project, setup: this.setupOf(project), dsn: this.dsnFor(project.id) })),
        ingest: ingest ? { host: LOOPBACK.has(ingest.host) ? 'localhost' : ingest.host, port: ingest.port } : null,
      });
    });

    // Checks only: nothing is saved. The wizard calls this as the user fills in the form.
    router.post('/check', async (req, res) => {
      res.json(await this.inspect(req.body));
    });

    router.post('/', async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = { repo: asText(body.repo), branch: asText(body.branch), token: asText(body.token), resolverToken: asText(body.resolverToken) || null, verifyCommand: asText(body.verifyCommand) || null, issuesWithoutStack: body.issuesWithoutStack === true };
      this.validate(input);

      const found = await this.inspect(input);
      if (!found.ok) throw new HttpError(422, found.problems[0] ?? 'GitHub did not accept this project', found.fields);

      const project = this.add(input);
      this.startSetup(project);
      res.status(201).json({ project: this.publicOf(project), setup: this.setupOf(project), dsn: this.dsnFor(project.id) });
    });

    // The repo is what a project is, so everything else can change: branch, tokens and the verify command.
    router.patch('/:id', async (req, res) => {
      const project = this.deps.projects.get(req.params.id as string);
      if (!project) throw new HttpError(404, 'No such project');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: ProjectPatch = {};
      if ('branch' in body) patch.branch = asText(body.branch);
      if ('token' in body) patch.token = asText(body.token);
      if ('resolverToken' in body) patch.resolverToken = asText(body.resolverToken) || null;
      if ('verifyCommand' in body) patch.verifyCommand = asText(body.verifyCommand) || null;
      if ('issuesWithoutStack' in body) patch.issuesWithoutStack = body.issuesWithoutStack === true;

      const moves = patch.branch !== undefined && patch.branch.trim() !== project.branch;
      const retokens = patch.token !== undefined && patch.token.trim() !== project.token;
      const repokens = patch.resolverToken !== undefined && patch.resolverToken !== project.resolverToken;
      if (moves || retokens || repokens) await this.checkWithGithub(project, patch, { main: moves || retokens, resolver: repokens });

      const updated = this.change(project.id, patch);
      if (moves || retokens || repokens) this.startSetup(updated);
      res.json({ project: this.publicOf(updated), setup: this.setupOf(updated) });
    });

    // The branches of a saved project's repo, fetched with its own token, for the settings dropdown.
    router.get('/:id/branches', async (req, res) => {
      const project = this.deps.projects.get(req.params.id as string);
      if (!project) throw new HttpError(404, 'No such project');
      const found = await inspectRepo({ token: project.token, apiUrl: this.deps.githubApiUrl, repo: project.repo });
      if (!found.ok) throw new HttpError(422, found.problems[0] ?? 'GitHub did not answer', found.fields);
      res.json({ branches: found.branches, defaultBranch: found.repo.defaultBranch ?? null, truncated: found.branchesTruncated });
    });

    router.post('/:id/retry', (req, res) => {
      const project = this.deps.projects.get(req.params.id as string);
      if (!project) throw new HttpError(404, 'No such project');
      this.startSetup(project);
      res.status(202).json({ setup: this.setupOf(project) });
    });

    router.delete('/:id', async (req, res) => {
      const project = this.deps.projects.get(req.params.id as string);
      if (!project) throw new HttpError(404, 'No such project');
      this.deps.projects.remove(project.id);
      this.setups.delete(project.id);
      this.changed();
      // The clone is per repo, shared by every branch of it: only remove it when no other project needs it.
      if (this.deps.projects.findByRepo(project.repo).length === 0) await this.deps.repos.remove(project.repo);
      res.status(204).end();
    });
  }

  /** Validates what was typed, answering with the field that is wrong. */
  private validate(input: { repo: string; branch: string; token: string; resolverToken: string | null; verifyCommand?: string | null; issuesWithoutStack?: boolean }): void {
    try {
      checkProjectInput(input);
    } catch (err) {
      if (err instanceof ProjectError) throw new HttpError(422, err.message, err.field ? { [err.field]: err.message } : undefined);
      throw err;
    }
  }

  private add(input: { repo: string; branch: string; token: string; resolverToken: string | null; verifyCommand?: string | null; issuesWithoutStack?: boolean }): Project {
    try {
      const project = this.deps.projects.add(input);
      this.changed();
      return project;
    } catch (err) {
      if (err instanceof ProjectError) throw new HttpError(err.code === 'duplicate' ? 409 : 422, err.message, err.field ? { [err.field]: err.message } : undefined);
      throw err;
    }
  }

  /** Applies an edit, saying which field is wrong when the store refuses it. */
  private change(id: string, patch: ProjectPatch): Project {
    try {
      const project = this.deps.projects.update(id, patch);
      this.changed();
      return project;
    } catch (err) {
      if (err instanceof ProjectError) throw new HttpError(err.code === 'duplicate' ? 409 : 422, err.message, err.field ? { [err.field]: err.message } : undefined);
      throw err;
    }
  }

  /**
   * Before saving an edit that changes what GitHub is asked: the new branch must exist and the token must reach
   * it, and a new pull-request token must be accepted too, reported under its own field.
   */
  private async checkWithGithub(project: Project, patch: ProjectPatch, check: { main: boolean; resolver: boolean }): Promise<void> {
    const branch = (patch.branch ?? project.branch ?? '').trim();
    const ask = (token: string) => inspectRepo({ token, apiUrl: this.deps.githubApiUrl, repo: project.repo, ...(branch ? { branch } : {}) });

    const fields: Record<string, string> = {};
    if (check.main) Object.assign(fields, (await ask((patch.token ?? project.token).trim())).fields);
    if (check.resolver && patch.resolverToken) {
      const { token, ...rest } = (await ask(patch.resolverToken.trim())).fields;
      Object.assign(fields, rest, token === undefined ? {} : { resolverToken: token });
    }
    const [first] = Object.values(fields);
    if (first !== undefined) throw new HttpError(422, first, fields);
  }

  private async inspect(body: unknown): Promise<RepoInspection> {
    const { repo, branch, token } = (body ?? {}) as Record<string, unknown>;
    const input = { repo: asText(repo), branch: asText(branch), token: asText(token), resolverToken: null };
    // A typo is rejected here, before it costs a GitHub request. The branch is optional for a check: the wizard asks for the repo first.
    this.validate({ ...input, branch: input.branch || 'main' });
    return inspectRepo({ token: input.token.trim(), apiUrl: this.deps.githubApiUrl, repo: input.repo.trim(), ...(input.branch ? { branch: input.branch.trim() } : {}) });
  }

  /** Clones in the background and records how it went; the wizard polls `setup`. */
  private startSetup(project: Project): void {
    if (!project.branch) {
      // Imported from the old settings: no branch to clone yet. It is learned, and cloned, on its first fix.
      this.setups.set(project.id, { state: 'idle', message: 'Will clone on its first fix', updatedAt: new Date().toISOString() });
      this.changed();
      return;
    }
    const update = (state: SetupStatus['state'], message: string): void => {
      this.setups.set(project.id, { state, message, updatedAt: new Date().toISOString() });
      this.changed();
    };
    update('working', 'Starting');
    // The resolver is what reads the clone, so it is cloned with the token the resolver will use.
    this.deps.repos.ensure({ repo: project.repo, branch: project.branch, token: project.resolverToken ?? project.token }, (message) => update('working', message)).then(
      () => update('ready', 'Cloned and up to date'),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn({ project: project.id, repo: project.repo }, `Clone failed: ${message}`);
        update('failed', message);
      },
    );
  }

  /** The projects list changed, and so did the errors view, which is grouped by project. */
  private changed(): void {
    this.deps.events?.publish('projects');
    this.deps.events?.publish('errors');
  }

  private setupOf(project: Pick<Project, 'id' | 'repo'>): SetupStatus {
    const known = this.setups.get(project.id);
    if (known) return known;
    // Not set up in this run (the server restarted since): a clone on disk means it was done before.
    return existsSync(this.deps.repos.pathFor(project.repo))
      ? { state: 'ready', message: 'Cloned', updatedAt: null }
      : { state: 'idle', message: 'Will clone on its first fix', updatedAt: null };
  }

  private publicOf(project: Project): PublicProject {
    return { id: project.id, repo: project.repo, branch: project.branch, tokenHint: project.token.slice(-4), hasResolverToken: project.resolverToken !== null, verifyCommand: project.verifyCommand, issuesWithoutStack: project.issuesWithoutStack, createdAt: project.createdAt };
  }

  private dsnFor(id: string): string | null {
    const { ingest } = this.deps;
    return ingest ? `http://${ingest.dsnKey ?? 'errorflow'}@${LOOPBACK.has(ingest.host) ? 'localhost' : ingest.host}:${ingest.port}/${id}` : null;
  }
}
