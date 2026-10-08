import type { RepoRef } from './types.ts';

export interface CreatedIssue {
  number: number;
  url: string;
}

/** The two GitHub operations the ingest pipeline needs; a seam for tests. */
export interface IssueTracker {
  createIssue(repo: RepoRef, title: string, body: string, extraLabels?: string[]): Promise<CreatedIssue>;
  commentOnIssue(repo: RepoRef, issueNumber: number, body: string): Promise<void>;
}

const REPO_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/;

/** Parses `owner/repo`; null when it isn't shaped like one. */
export function parseRepo(text: string): RepoRef | null {
  const match = REPO_PATTERN.exec(text.trim());
  return match ? { owner: match[1] as string, repo: match[2] as string } : null;
}

export const formatRepo = ({ owner, repo }: RepoRef): string => `${owner}/${repo}`;

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'GitHubError';
  }
}

export interface GitHubClientOptions {
  token: string;
  apiUrl: string;
  labels: string[];
}

const REQUEST_TIMEOUT_MS = 10_000;

export class GitHubClient implements IssueTracker {
  private readonly options: GitHubClientOptions;

  constructor(options: GitHubClientOptions) {
    this.options = options;
  }

  private repoUrl({ owner, repo }: RepoRef): string {
    return `${this.options.apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  async createIssue(repo: RepoRef, title: string, body: string, extraLabels: string[] = []): Promise<CreatedIssue> {
    const payload: Record<string, unknown> = { title, body };
    const labels = [...new Set([...this.options.labels, ...extraLabels])];
    if (labels.length > 0) payload.labels = labels;

    const data = await this.post(`${this.repoUrl(repo)}/issues`, payload);
    const record = data as { number?: unknown; html_url?: unknown } | null;
    if (typeof record?.number !== 'number' || typeof record.html_url !== 'string') {
      throw new GitHubError(502, 'GitHub response is missing "number" or "html_url"');
    }
    return { number: record.number, url: record.html_url };
  }

  async commentOnIssue(repo: RepoRef, issueNumber: number, body: string): Promise<void> {
    await this.post(`${this.repoUrl(repo)}/issues/${issueNumber}/comments`, { body });
  }

  private async post(url: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'error-tracker',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GitHubError(0, `GitHub request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await response.text();
    if (!response.ok) throw new GitHubError(response.status, `GitHub responded ${response.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new GitHubError(502, 'GitHub returned a non-JSON response');
    }
  }
}
