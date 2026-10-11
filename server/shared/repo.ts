/** A GitHub repository. */
export interface RepoRef {
  owner: string;
  repo: string;
}

const REPO_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/;

/** Parses `owner/repo`; null when it isn't shaped like one. */
export function parseRepo(text: string): RepoRef | null {
  const match = REPO_PATTERN.exec(text.trim());
  return match ? { owner: match[1] as string, repo: match[2] as string } : null;
}

export const formatRepo = ({ owner, repo }: RepoRef): string => `${owner}/${repo}`;
