import { GITHUB_REQUEST_TIMEOUT_MS } from '../../constants.ts';
import { GitHubError } from '../../shared/errors.ts';
import type { RepoRef } from '../../shared/repo.ts';
import type { CreatedPullRequest, GitHubIssue } from './types.ts';

export interface GitHubClientOptions {
  token: string;
  apiUrl: string;
}

/** The GitHub operations the scheduler and fixer need; a seam for tests. */
export interface GitHubGateway {
  getIssue(repo: RepoRef, number: number): Promise<GitHubIssue | null>;
  getDefaultBranch(repo: RepoRef): Promise<string>;
  createPullRequest(repo: RepoRef, params: { title: string; body: string; head: string; base: string }): Promise<CreatedPullRequest>;
}

export class GitHubClient implements GitHubGateway {
  private readonly options: GitHubClientOptions;

  constructor(options: GitHubClientOptions) {
    this.options = options;
  }

  private repoUrl({ owner, repo }: RepoRef): string {
    return `${this.options.apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  private async request(method: string, url: string, payload?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: 'application/vnd.github+json',
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
          'User-Agent': 'error-resolver',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GitHubError(
        0,
        `GitHub request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let body: string;
    try {
      body = await response.text();
    } catch (err) {
      throw new GitHubError(
        response.status,
        `Failed to read response body: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const preview = body.length > 300 ? body.slice(0, 300) : body;
      throw new GitHubError(response.status, `GitHub API error: ${preview}`);
    }

    try {
      return body ? JSON.parse(body) : null;
    } catch {
      throw new GitHubError(response.status, `Failed to parse JSON response: ${body.slice(0, 100)}`);
    }
  }

  async getIssue(repo: RepoRef, number: number): Promise<GitHubIssue | null> {
    const url = `${this.repoUrl(repo)}/issues/${number}`;
    try {
      const data = await this.request('GET', url);
      return this.mapToGitHubIssue(data);
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async getDefaultBranch(repo: RepoRef): Promise<string> {
    const url = this.repoUrl(repo);
    const data = await this.request('GET', url);
    return this.extractDefaultBranch(data);
  }

  async createPullRequest(
    repo: RepoRef,
    params: { title: string; body: string; head: string; base: string },
  ): Promise<CreatedPullRequest> {
    const url = `${this.repoUrl(repo)}/pulls`;
    const data = await this.request('POST', url, params);
    return this.mapToCreatedPullRequest(data);
  }

  private mapToGitHubIssue(data: unknown): GitHubIssue {
    if (typeof data !== 'object' || data === null) {
      throw new GitHubError(502, 'GitHub issue response is not an object');
    }

    const obj = data as Record<string, unknown>;

    if (
      typeof obj.number !== 'number' ||
      typeof obj.title !== 'string' ||
      typeof obj.state !== 'string' ||
      typeof obj.html_url !== 'string'
    ) {
      throw new GitHubError(502, 'GitHub issue response is missing required fields');
    }

    if (obj.state !== 'open' && obj.state !== 'closed') {
      throw new GitHubError(502, 'GitHub issue response is missing required fields');
    }

    const bodyValue = obj.body;
    const body = bodyValue === null || bodyValue === undefined ? '' : String(bodyValue);

    return {
      number: obj.number,
      title: obj.title,
      body,
      state: obj.state,
      htmlUrl: obj.html_url,
    };
  }

  private extractDefaultBranch(data: unknown): string {
    if (typeof data !== 'object' || data === null) {
      throw new GitHubError(502, 'GitHub repo response is not an object');
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.default_branch !== 'string') {
      throw new GitHubError(502, 'GitHub repo response is missing default_branch field');
    }

    return obj.default_branch;
  }

  private mapToCreatedPullRequest(data: unknown): CreatedPullRequest {
    if (typeof data !== 'object' || data === null) {
      throw new GitHubError(502, 'GitHub pull request response is not an object');
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.number !== 'number' || typeof obj.html_url !== 'string') {
      throw new GitHubError(502, 'GitHub pull request response is missing required fields');
    }

    return {
      number: obj.number,
      url: obj.html_url,
    };
  }
}
