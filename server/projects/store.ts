import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { openDatabase } from '../sqlite.ts';
import type { SecretStore } from './secrets.ts';

/** `invalid`: the input cannot be a project. `duplicate`: it clashes with one that exists. */
export class ProjectError extends Error {
  readonly code: 'invalid' | 'duplicate';
  /** The wizard field the problem belongs under, when there is one. */
  readonly field: string | undefined;

  constructor(code: 'invalid' | 'duplicate', message: string, field?: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    this.field = field;
  }
}

/**
 * A repository, the branch to work on, and the token to do it with. One project can have many apps
 * (a repo often runs several), and its id doubles as the Sentry DSN project id apps already report to.
 */
export interface Project {
  id: string;
  /** `owner/name` */
  repo: string;
  /**
   * The branch errors are filed against and fixes are based on. Null only for a project imported from
   * the old environment settings, which never recorded one: it is learned from GitHub on first use.
   */
  branch: string | null;
  token: string;
  /** A separate, usually broader, token for pushing fixes; the main token is used when this is null. */
  resolverToken: string | null;
  /** Run in the project's checkout, through a shell, to check a fix (e.g. `npm ci && npm test`). Null: fixes go out unverified. */
  verifyCommand: string | null;
  /** Errors with no stack trace are always kept here; this also files them on GitHub. Off unless the user asks. */
  issuesWithoutStack: boolean;
  createdAt: string;
}

export interface NewProject {
  repo: string;
  branch: string | null;
  token: string;
  resolverToken?: string | null;
  verifyCommand?: string | null;
  issuesWithoutStack?: boolean;
  /** Only for importing: keeps the id apps already use in their DSN. */
  id?: string;
}

/** What an existing project lets the user change; a field left out stays as it is. */
export interface ProjectPatch {
  branch?: string;
  token?: string;
  /** Null or empty goes back to using the main token. */
  resolverToken?: string | null;
  verifyCommand?: string | null;
  issuesWithoutStack?: boolean;
}

/** What the browser may see: never the token, only enough of it to recognise which one it is. */
export interface PublicProject {
  id: string;
  repo: string;
  branch: string | null;
  tokenHint: string;
  hasResolverToken: boolean;
  verifyCommand: string | null;
  issuesWithoutStack: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  repo: string;
  branch: string | null;
  token_enc: string;
  resolver_token_enc: string | null;
  verify_command: string | null;
  issues_without_stack: number;
  created_at: string;
}

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const ID = /^[A-Za-z0-9_-]+$/;
/** Enough of git's ref rules to keep a branch name from being read as an option or escaping a path. */
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  repo               TEXT NOT NULL,
  branch             TEXT,
  token_enc          TEXT NOT NULL,
  resolver_token_enc TEXT,
  verify_command     TEXT,
  issues_without_stack INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/**
 * Trims and checks what a user typed, throwing a ProjectError that says which part is wrong. It is
 * separate from `add` so the wizard can reject a typo before spending a GitHub request on it.
 */
export function checkProjectInput(input: NewProject): { repo: string; branch: string | null; token: string; resolverToken: string | null; verifyCommand: string | null } {
  const repo = input.repo.trim();
  const branch = input.branch === null ? null : input.branch.trim();
  const token = input.token.trim();
  const resolverToken = input.resolverToken?.trim() || null;
  const verifyCommand = input.verifyCommand?.trim() || null;

  if (!REPO.test(repo)) throw new ProjectError('invalid', 'Repository must look like owner/name, for example acme/web', 'repo');
  if (branch !== null && !BRANCH.test(branch)) throw new ProjectError('invalid', 'Branch name is empty or has characters a branch cannot (spaces, "..", or a leading "-")', 'branch');
  if (token === '') throw new ProjectError('invalid', 'A GitHub token is required', 'token');
  if (input.id !== undefined && !ID.test(input.id)) throw new ProjectError('invalid', 'Project id may only use letters, numbers, - and _');
  return { repo, branch, token, resolverToken, verifyCommand };
}

export class ProjectStore {
  private readonly db: DatabaseSync;
  private readonly secrets: SecretStore;
  private readonly insertStmt: StatementSync;

  constructor(path: string, secrets: SecretStore) {
    this.db = openDatabase(path);
    this.db.exec(SCHEMA);
    // Databases made before a setting existed lack its column.
    const columns = this.db.prepare('PRAGMA table_info(projects)').all() as unknown as { name: string }[];
    const addColumn = (name: string, definition: string): void => {
      if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
    };
    addColumn('verify_command', 'TEXT');
    addColumn('issues_without_stack', 'INTEGER NOT NULL DEFAULT 0');
    this.secrets = secrets;
    this.insertStmt = this.db.prepare('INSERT INTO projects (id, repo, branch, token_enc, resolver_token_enc, verify_command, issues_without_stack, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  }

  add(input: NewProject): Project {
    const { repo, branch, token, resolverToken, verifyCommand } = checkProjectInput(input);

    if (input.id !== undefined && this.get(input.id)) throw new ProjectError('duplicate', `A project with id ${input.id} already exists`);
    if (branch !== null && this.findByRepo(repo).some((p) => p.branch === branch)) {
      throw new ProjectError('duplicate', `${repo} on branch ${branch} is already a project`);
    }

    const id = input.id ?? this.nextId();
    const createdAt = new Date().toISOString();
    this.insertStmt.run(id, repo, branch, this.secrets.seal(token), resolverToken === null ? null : this.secrets.seal(resolverToken), verifyCommand, input.issuesWithoutStack ? 1 : 0, createdAt);
    return { id, repo, branch, token, resolverToken, verifyCommand, issuesWithoutStack: input.issuesWithoutStack === true, createdAt };
  }

  get(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? this.toProject(row) : undefined;
  }

  /** Every project with its tokens opened: for the server's own use, never to be sent out. */
  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects').all() as unknown as Row[];
    return rows.map((row) => this.toProject(row)).sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
  }

  listPublic(): PublicProject[] {
    return this.list().map(({ id, repo, branch, token, resolverToken, verifyCommand, issuesWithoutStack, createdAt }) => ({
      id,
      repo,
      branch,
      tokenHint: token.slice(-4),
      hasResolverToken: resolverToken !== null,
      verifyCommand,
      issuesWithoutStack,
      createdAt,
    }));
  }

  findByRepo(repo: string): Project[] {
    return this.list().filter((project) => project.repo === repo);
  }

  setBranch(id: string, branch: string): void {
    if (!BRANCH.test(branch)) throw new ProjectError('invalid', 'Branch name is not valid');
    this.db.prepare('UPDATE projects SET branch = ? WHERE id = ?').run(branch, id);
  }

  /**
   * Changes what a project lets the user change: the branch, the tokens and the verify command. The repo
   * is what the project is, so it stays. A field left out is kept; an empty resolver token or command clears it.
   * Follows the same rules as `add`, so an edit cannot leave a project that adding could not have made.
   */
  update(id: string, patch: ProjectPatch): Project {
    const current = this.get(id);
    if (!current) throw new ProjectError('invalid', 'No such project');

    const branch = patch.branch === undefined ? current.branch : patch.branch.trim();
    const token = patch.token === undefined ? current.token : patch.token.trim();
    const resolverToken = patch.resolverToken === undefined ? current.resolverToken : patch.resolverToken?.trim() || null;
    const verifyCommand = patch.verifyCommand === undefined ? current.verifyCommand : patch.verifyCommand?.trim() || null;
    const issuesWithoutStack = patch.issuesWithoutStack ?? current.issuesWithoutStack;

    if (branch !== null && !BRANCH.test(branch)) throw new ProjectError('invalid', 'Branch name is empty or has characters a branch cannot (spaces, "..", or a leading "-")', 'branch');
    if (token === '') throw new ProjectError('invalid', 'A GitHub token is required', 'token');
    if (branch !== null && this.findByRepo(current.repo).some((p) => p.id !== id && p.branch === branch)) {
      throw new ProjectError('duplicate', `${current.repo} on branch ${branch} is already a project`, 'branch');
    }

    this.db
      .prepare('UPDATE projects SET branch = ?, token_enc = ?, resolver_token_enc = ?, verify_command = ?, issues_without_stack = ? WHERE id = ?')
      .run(branch, this.secrets.seal(token), resolverToken === null ? null : this.secrets.seal(resolverToken), verifyCommand, issuesWithoutStack ? 1 : 0, id);
    return { ...current, branch, token, resolverToken, verifyCommand, issuesWithoutStack };
  }

  remove(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes) > 0;
  }

  /** One-time flags, such as "the old environment settings have been imported". */
  getFlag(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setFlag(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  close(): void {
    this.db.close();
  }

  private nextId(): string {
    const numeric = this.list().map((p) => Number(p.id)).filter(Number.isInteger);
    return String(numeric.length === 0 ? 1 : Math.max(...numeric) + 1);
  }

  private toProject(row: Row): Project {
    return {
      id: row.id,
      repo: row.repo,
      branch: row.branch,
      token: this.secrets.open(row.token_enc),
      resolverToken: row.resolver_token_enc === null ? null : this.secrets.open(row.resolver_token_enc),
      verifyCommand: row.verify_command,
      issuesWithoutStack: row.issues_without_stack === 1,
      createdAt: row.created_at,
    };
  }
}
