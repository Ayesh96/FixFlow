import { BRANCHES_SHOWN_IN_MESSAGE, GITHUB_BRANCH_LIST_SIZE } from '../constants.ts';
export interface InspectRequest {
  token: string;
  apiUrl: string;
  /** `owner/name` */
  repo: string;
  /** When given, also checks that this branch exists. */
  branch?: string;
  timeoutMs?: number;
}

export interface RepoInspection {
  /** True when nothing is wrong. Warnings do not make it false. */
  ok: boolean;
  repo: { found: boolean; private?: boolean; defaultBranch?: string; canPush?: boolean };
  /** Only present when a branch was asked about. */
  branch?: { found: boolean };
  /** The repo's branches, for the wizard to offer, up to one page. */
  branches: string[];
  /** True when the list filled a whole page, so the repo may have branches that are not in it. */
  branchesTruncated: boolean;
  /** What is wrong, as a sentence that says what happened and what to try. */
  problems: string[];
  /** The same problems keyed by the wizard field they belong under, so each shows next to the input to fix. */
  fields: Record<string, string>;
  /** Worth knowing, but it does not stop the project being added. */
  warnings: string[];
}


interface Reply {
  status: number;
  body: unknown;
}

const BRANCH_ACCESS_HINT =
  'A fine-grained token needs Contents access to this repository; for a repository owned by an organization, the organization may also have to approve the token or authorize it for SSO.';

/** GitHub's own reason, e.g. `403: Resource not accessible by personal access token`. It never contains the token. */
function githubSays(reply: Reply): string {
  const message = (reply.body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? `${reply.status}: ${message.trim()}` : `HTTP ${reply.status}`;
}

/**
 * Asks GitHub whether a token can reach a repo and branch, so a typo is caught in the wizard instead of
 * on the first error that fails to open an issue. Never throws, and never puts the token in a message.
 */
export async function inspectRepo({ token, apiUrl, repo, branch, timeoutMs = 10_000 }: InspectRequest): Promise<RepoInspection> {
  const result: RepoInspection = { ok: false, repo: { found: false }, branches: [], branchesTruncated: false, problems: [], fields: {}, warnings: [] };
  const fail = (field: string, message: string): void => {
    result.problems.push(message);
    result.fields[field] = message;
  };
  const base = `${apiUrl.replace(/\/+$/, '')}/repos/${repo}`;

  const get = async (url: string): Promise<Reply | null> => {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'code-akos', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error', // never replay the token to wherever a redirect points
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    } catch {
      return null;
    }
  };

  const found = await get(base);
  if (found === null) {
    fail('repo', `Could not reach GitHub at ${apiUrl}. Check the network connection, and the address if you use GitHub Enterprise.`);
    return result;
  }
  if (found.status === 401) {
    fail('token', 'GitHub rejected this token. It may be mistyped or expired. Generate a new one and paste it again.');
    return result;
  }
  if (found.status !== 200) {
    fail('repo', `GitHub cannot find ${repo} with this token. Check the name, and that the token has access to this repository (a private repo needs a token that includes it).`);
    return result;
  }

  const details = (found.body ?? {}) as { private?: boolean; default_branch?: string; permissions?: { push?: boolean } };
  result.repo = {
    found: true,
    ...(details.private === undefined ? {} : { private: details.private }),
    ...(details.default_branch === undefined ? {} : { defaultBranch: details.default_branch }),
    ...(details.permissions?.push === undefined ? {} : { canPush: details.permissions.push }),
  };
  if (details.permissions?.push === false) {
    result.warnings.push(`This token can read ${repo} but not push to it, so the resolver will not be able to open pull requests. Issues and error tracking still work.`);
  }

  const listed = await get(`${base}/branches?per_page=${GITHUB_BRANCH_LIST_SIZE}`);
  if (listed?.status === 200 && Array.isArray(listed.body)) {
    result.branches = (listed.body as { name?: unknown }[]).flatMap((b) => (typeof b.name === 'string' ? [b.name] : []));
    result.branchesTruncated = result.branches.length >= GITHUB_BRANCH_LIST_SIZE;
  } else {
    // The repo answered but its branches did not. Saying "no such branch" then would send the user hunting for
    // a typo that is not there, so this passes on what GitHub said: a token without Contents access, an
    // organization's SSO or token approval, a rate limit, or the network.
    fail('token', listed === null ? `GitHub found ${repo} but did not answer when asked for its branches. Check the network connection and try again.` : `GitHub found ${repo} but would not list its branches (${githubSays(listed)}). ${BRANCH_ACCESS_HINT}`);
    return result;
  }
  if (result.branches.length === 0) {
    fail('repo', `${repo} has no branches yet. Push a first commit to it, then check again.`);
    return result;
  }

  if (branch !== undefined) {
    const path = branch.split('/').map(encodeURIComponent).join('/'); // a branch may contain slashes
    const exists = await get(`${base}/branches/${path}`);
    if (exists === null || (exists.status !== 200 && exists.status !== 404)) {
      fail('branch', exists === null ? `GitHub did not answer when asked about the branch "${branch}". Check the network connection and try again.` : `GitHub would not say whether ${repo} has a branch called "${branch}" (${githubSays(exists)}).`);
      return result;
    }
    result.branch = { found: exists.status === 200 };
    if (!result.branch.found) {
      const names = result.branches.slice(0, BRANCHES_SHOWN_IN_MESSAGE).join(', ');
      fail('branch', `${repo} has no branch called "${branch}".${names ? ` Branches that exist: ${names}.` : ''} Check the spelling.`);
    }
  }

  result.ok = result.problems.length === 0;
  return result;
}
