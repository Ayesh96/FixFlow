import { formatRepo, GitHubError, type CreatedIssue, type IssueTracker } from '../../../server/workflows/errors/github.ts';
import type { RepoRef } from '../../../server/workflows/errors/types.ts';
import type { Project } from '../../../server/projects/store.ts';

export class FakeTracker implements IssueTracker {
  created: { repo: string; title: string; body: string; labels: string[] }[] = [];
  comments: { repo: string; issue: number; body: string }[] = [];
  failNextCreates = 0;
  delayMs = 0;

  async createIssue(repo: RepoRef, title: string, body: string, labels: string[] = []): Promise<CreatedIssue> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNextCreates > 0) {
      this.failNextCreates--;
      throw new GitHubError(500, 'boom');
    }
    this.created.push({ repo: formatRepo(repo), title, body, labels });
    return { number: 100 + this.created.length, url: `https://github.com/o/r/issues/${100 + this.created.length}` };
  }

  /** Lets already-queued fake GitHub calls finish (they resolve on microtasks). */
  settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

  async commentOnIssue(repo: RepoRef, issue: number, body: string): Promise<void> {
    this.comments.push({ repo: formatRepo(repo), issue, body });
  }
}

export const P = '1';
/** Stands in for the project database: ids map to repos, and each project has its own token. */
export const projectsOf = (map: Map<string, RepoRef>, over: Partial<Project> = {}) => ({
  get: (id: string): Project | undefined => {
    const repo = map.get(id);
    return repo ? { id, repo: formatRepo(repo), branch: 'main', token: `token-${id}`, resolverToken: null, verifyCommand: null, issuesWithoutStack: false, createdAt: '', ...over } : undefined;
  },
});
