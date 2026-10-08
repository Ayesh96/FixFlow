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

/** GitHub's largest page. A repo with more branches than this is shown as incomplete, and the user can type the rest. */
const BRANCH_LIST_SIZE = 100;
const SHOWN_IN_MESSAGE = 10;

interface Reply {
  status: number;
  body: unknown;
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
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'errorflow', 'X-GitHub-Api-Version': '2022-11-28' },
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

  const listed = await get(`${base}/branches?per_page=${BRANCH_LIST_SIZE}`);
  if (listed?.status === 200 && Array.isArray(listed.body)) {
    result.branches = (listed.body as { name?: unknown }[]).flatMap((b) => (typeof b.name === 'string' ? [b.name] : []));
    result.branchesTruncated = result.branches.length >= BRANCH_LIST_SIZE;
  }

  if (branch !== undefined) {
    const path = branch.split('/').map(encodeURIComponent).join('/'); // a branch may contain slashes
    const exists = await get(`${base}/branches/${path}`);
    result.branch = { found: exists?.status === 200 };
    if (!result.branch.found) {
      const names = result.branches.slice(0, SHOWN_IN_MESSAGE).join(', ');
      fail('branch', `${repo} has no branch called "${branch}".${names ? ` Branches that exist: ${names}.` : ''} Check the spelling.`);
    }
  }

  result.ok = result.problems.length === 0;
  return result;
}
