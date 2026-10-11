import type { ExtensionInfo, FieldErrors, TrackerProjectGroup, TrackerIssue, TrackerStatus, AttemptRecord, ResolverStatus, AttemptPage, AttemptStatus, ProjectList, ProjectView, RepoInspection } from '@server/types.ts';

export type { ExtensionInfo, FieldErrors, TrackerProjectGroup, TrackerIssue, TrackerStatus, AttemptRecord, ResolverStatus, AttemptPage, AttemptStatus, ProjectList, ProjectView, RepoInspection, SetupStatus } from '@server/types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly fields: FieldErrors;

  constructor(message: string, status: number, fields: FieldErrors = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

/** What the Add project wizard sends. The token goes to the server once and never comes back. */
export interface ProjectForm {
  repo: string;
  branch: string;
  token: string;
  /** Only when pull requests need a different token from issues. */
  resolverToken?: string;
  /** Run through a shell to check a fix; left out when the project has none. */
  verifyCommand?: string;
  /** Also file errors with no stack trace on GitHub. */
  issuesWithoutStack?: boolean;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) {
    await res.text(); // drain the (empty) body so the browser doesn't report the request as aborted
    return undefined as T;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldErrors };
  if (!res.ok) throw new ApiError(data.error ?? `${res.status} ${res.statusText}`, res.status, data.fields);
  return data as T;
}

export const api = {
  extensions: () => request<{ extensions: ExtensionInfo[] }>('GET', '/api/extensions').then((r) => r.extensions),
  errorTracker: {
    status: () => request<TrackerStatus>('GET', '/api/ext/errors/status'),
    projects: () => request<{ projects: TrackerProjectGroup[] }>('GET', '/api/ext/errors/projects').then((r) => r.projects),
    /** Reads one error again; answers at once, the new finding follows. Rejects if it is already running or its events are gone. */
    retriage: (fingerprintHash: string) => request<{ triage: 'started' }>('POST', `/api/ext/errors/issues/${encodeURIComponent(fingerprintHash)}/triage`, {}),
  },
  projects: {
    list: () => request<ProjectList>('GET', '/api/ext/projects'),
    /** Asks GitHub whether the token can reach the repo (and branch, when given). Saves nothing. */
    check: (form: Pick<ProjectForm, 'repo' | 'token'> & { branch?: string }) => request<RepoInspection>('POST', '/api/ext/projects/check', form),
    create: (form: ProjectForm) => request<{ project: ProjectView; dsn: string | null }>('POST', '/api/ext/projects', form),
    /** Only the settings given change; an empty `resolverToken` or `verifyCommand` clears it. */
    update: (id: string, settings: Partial<Pick<ProjectForm, 'branch' | 'token' | 'resolverToken' | 'verifyCommand' | 'issuesWithoutStack'>>) =>
      request<{ project: ProjectView }>('PATCH', `/api/ext/projects/${encodeURIComponent(id)}`, settings),
    /** The branches of a saved project's repo, using its own token. Rejects when GitHub will not say. */
    branches: (id: string) => request<{ branches: string[]; defaultBranch: string | null; truncated: boolean }>('GET', `/api/ext/projects/${encodeURIComponent(id)}/branches`),
    retry: (id: string) => request<unknown>('POST', `/api/ext/projects/${encodeURIComponent(id)}/retry`, {}),
    remove: (id: string) => request<void>('DELETE', `/api/ext/projects/${encodeURIComponent(id)}`),
  },
  errorResolver: {
    status: () => request<ResolverStatus>('GET', '/api/ext/resolver/status'),
    /** Runs a cycle now; answers at once. Rejects if one is already running. */
    run: () => request<{ run: 'started' }>('POST', '/api/ext/resolver/run', {}),
    /** Tries one error now even if it was skipped or failed before. Answers at once; the outcome follows. */
    runIssue: (fingerprintHash: string) => request<{ run: 'started' }>('POST', `/api/ext/resolver/issues/${encodeURIComponent(fingerprintHash)}/run`, {}),
    attempts: (limit: number = 50, offset: number = 0) =>
      request<AttemptPage>('GET', `/api/ext/resolver/attempts?limit=${limit}&offset=${offset}`),
  },
};
