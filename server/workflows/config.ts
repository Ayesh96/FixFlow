/**
 * GitHub settings both workflows need. Before the merge each service parsed its own `GITHUB_TOKEN`
 * and so on; in one process those names would collide, so they are read once here and handed to
 * whichever workflow wants them. The models' settings live in server/llm/config.ts.
 */

type Env = Record<string, string | undefined>;

const trimmed = (env: Env, name: string): string => env[name]?.trim() ?? '';

/**
 * The GitHub API address (GitHub Enterprise has its own). Separate from the token because tokens now
 * belong to projects, but the address is still one setting for the whole install.
 */
export function githubApiUrl(env: Env): string {
  return (trimmed(env, 'ORCH_GITHUB_API_URL') || 'https://api.github.com').replace(/\/+$/, '');
}

/**
 * Where repositories are cloned from, with `{repo}` standing for `owner/name`. GitHub by default; a
 * GitHub Enterprise server (or a local mirror) has its own address. Refused without `{repo}`, since
 * that would clone the same thing for every project.
 */
export function githubCloneUrl(env: Env): string {
  const template = trimmed(env, 'ORCH_GITHUB_CLONE_URL') || 'https://github.com/{repo}.git';
  if (!template.includes('{repo}')) throw new Error(`ORCH_GITHUB_CLONE_URL must contain {repo}, for example https://github.com/{repo}.git (got "${template}")`);
  return template;
}
