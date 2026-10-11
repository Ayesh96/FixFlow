import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { silentLogger } from '../helpers.ts';
import type { Project } from '../../../server/projects/store.ts';
import { Scheduler } from '../../../server/workflows/resolver/scheduler.ts';
import { Store } from '../../../server/workflows/resolver/store.ts';
import type { Config as ConfigType } from '../../../server/workflows/resolver/config.ts';
import type { GitHubGateway } from '../../../server/workflows/resolver/github.ts';
import type { IssueSource } from '../../../server/workflows/resolver/issueSource.ts';
import type { AttemptFixInput } from '../../../server/workflows/resolver/fixer.ts';
import type { FixOutcome, GitHubIssue, TrackedIssue } from '../../../server/workflows/resolver/types.ts';

const silent = silentLogger();

function makeConfig(overrides: Partial<ConfigType> = {}): ConfigType {
  return {
    githubApiUrl: 'https://api.github.com',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5-coder:7b',
    anthropic: null,
    pollIntervalMs: 300_000,
    maxConcurrentFixes: 3,
    retrySkippedAttempts: false,
    databasePath: ':memory:',
    ...overrides,
  };
}

/** Stands in for the project database; `branches` records every branch the scheduler learned and saved. */
function makeProjects(overrides: Partial<Project> = {}) {
  const project: Project = { id: '1', repo: 'acme/app', branch: 'main', token: 'project-token', resolverToken: null, verifyCommand: null, issuesWithoutStack: false, createdAt: '', ...overrides };
  const branches: [string, string][] = [];
  return {
    branches,
    get: (id: string): Project | undefined => (id === project.id ? project : undefined),
    setBranch: (id: string, branch: string) => {
      branches.push([id, branch]);
      project.branch = branch;
    },
  };
}
const projects = makeProjects();

const tracked = (over: Partial<TrackedIssue> = {}): TrackedIssue => ({
  fingerprintHash: 'fp-1',
  projectId: '1',
  service: null,
  title: 'TypeError: x is undefined',
  firstSeen: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-01-01T00:00:00.000Z',
  count: 1,
  githubIssueNumber: 7,
  githubIssueUrl: 'https://github.com/acme/app/issues/7',
  githubRepo: 'acme/app',
  ...over,
});

const openIssue: GitHubIssue = {
  number: 7,
  title: 'TypeError: x is undefined',
  body: 'stack trace',
  state: 'open',
  htmlUrl: 'https://github.com/acme/app/issues/7',
};

describe('Scheduler', () => {
  const stores: Store[] = [];
  afterEach(() => {
    stores.splice(0).forEach((s) => s.close());
  });

  const newStore = (): Store => {
    const store = new Store(':memory:');
    stores.push(store);
    return store;
  };

  it('does not touch the issue when there is nothing new to fix (no tracked issues)', async () => {
    const store = newStore();
    const issueSource: IssueSource = { listIssues: async () => [], reportResolverStatus: async () => {} };
    const github: GitHubGateway = {
      getIssue: async () => {
        throw new Error('should not be called');
      },
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => {
        throw new Error('should not be called');
      },
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });
    await scheduler.pollOnce();
    assert.equal(store.stats().total, 0);
    assert.equal(scheduler.status().lastPollError, null);
    assert.ok(scheduler.status().lastPollAt);
  });

  it('skips a tracked issue with no githubIssueNumber (never opened on GitHub)', async () => {
    const store = newStore();
    const issueSource: IssueSource = {
      listIssues: async () => [tracked({ githubIssueNumber: null, githubRepo: null })],
      reportResolverStatus: async () => {},
    };
    let getIssueCalled = false;
    const github: GitHubGateway = {
      getIssue: async () => {
        getIssueCalled = true;
        return openIssue;
      },
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'https://github.com/acme/app/pull/1' }),
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });
    await scheduler.pollOnce();
    assert.equal(getIssueCalled, false);
  });

  it('skips a GitHub issue that is already closed', async () => {
    const store = newStore();
    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    let fixCalled = false;
    const github: GitHubGateway = {
      getIssue: async () => ({ ...openIssue, state: 'closed' }),
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const attemptFix = async (): Promise<FixOutcome> => {
      fixCalled = true;
      return { kind: 'skipped', reason: 'unused' };
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();
    assert.equal(fixCalled, false);
    assert.equal(store.getAttempt('acme/app', 7), null);
  });

  it('does not retry an issue that already has a PR open', async () => {
    const store = newStore();
    store.beginAttempt('acme/app', 7, 'fp-1');
    store.recordResult('acme/app', 7, 'PR_OPEN', { prNumber: 1, prUrl: 'https://github.com/acme/app/pull/1' });

    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    let getIssueCalled = false;
    const github: GitHubGateway = {
      getIssue: async () => {
        getIssueCalled = true;
        return openIssue;
      },
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });
    await scheduler.pollOnce();
    assert.equal(getIssueCalled, false);
  });

  it('does not retry a SKIPPED issue by default', async () => {
    const store = newStore();
    store.beginAttempt('acme/app', 7, 'fp-1');
    store.recordResult('acme/app', 7, 'SKIPPED', { reason: 'unclear' });

    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    let getIssueCalled = false;
    const github: GitHubGateway = {
      getIssue: async () => {
        getIssueCalled = true;
        return openIssue;
      },
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });
    await scheduler.pollOnce();
    assert.equal(getIssueCalled, false);
  });

  it('retries a SKIPPED issue when RETRY_SKIPPED_ATTEMPTS is on, but still never a PR_OPEN one', async () => {
    const store = newStore();
    store.beginAttempt('acme/app', 7, 'fp-1');
    store.recordResult('acme/app', 7, 'SKIPPED', { reason: 'unclear' });
    store.beginAttempt('acme/app', 8, 'fp-2');
    store.recordResult('acme/app', 8, 'PR_OPEN', { prNumber: 1, prUrl: 'https://github.com/acme/app/pull/1' });

    const issueSource: IssueSource = {
      listIssues: async () => [tracked(), tracked({ githubIssueNumber: 8 })],
      reportResolverStatus: async () => {},
    };
    const fetched: number[] = [];
    const github: GitHubGateway = {
      getIssue: async (_repo, number) => {
        fetched.push(number);
        return { ...openIssue, number };
      },
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const attemptFix = async (): Promise<FixOutcome> => ({ kind: 'skipped', reason: 'still unclear' });
    const scheduler = new Scheduler({
      issueSource,
      githubFor: () => github,
      projects,
      store,
      config: makeConfig({ retrySkippedAttempts: true }),
      logger: silent,
      attemptFix,
    });
    await scheduler.pollOnce();
    assert.deepEqual(fetched, [7]);
  });

  it('retries an issue whose previous attempt failed', async () => {
    const store = newStore();
    store.beginAttempt('acme/app', 7, 'fp-1');
    store.recordResult('acme/app', 7, 'FAILED', { reason: 'clone exploded' });

    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'https://github.com/acme/app/pull/1' }),
    };
    let fixCalled = false;
    const attemptFix = async (): Promise<FixOutcome> => {
      fixCalled = true;
      return { kind: 'skipped', reason: 'still cannot fix it' };
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();
    assert.equal(fixCalled, true);
  });

  it('forces a skipped issue to run again, and refuses one that has a pull request', async () => {
    const store = newStore();
    store.beginAttempt('acme/app', 7, 'fp-1');
    store.recordResult('acme/app', 7, 'SKIPPED', { reason: 'not confident' });
    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    const github: GitHubGateway = { getIssue: async () => openIssue, getDefaultBranch: async () => 'main', createPullRequest: async () => ({ number: 1, url: 'x' }) };
    const forced: (boolean | undefined)[] = [];
    const attemptFix = async (input: { force?: boolean }): Promise<FixOutcome> => {
      forced.push(input.force);
      return { kind: 'skipped', reason: 'still no' };
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });

    assert.equal(await scheduler.forceIssue('nope'), 'unknown');
    assert.equal(await scheduler.forceIssue('fp-1'), 'started');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(forced, [true]);

    store.recordResult('acme/app', 7, 'PR_OPEN', { prNumber: 1, prUrl: 'x' });
    assert.equal(await scheduler.forceIssue('fp-1'), 'has-pr');
  });

  it('records SKIPPED without opening a pull request', async () => {
    const store = newStore();
    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    let prCreated = false;
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => {
        prCreated = true;
        return { number: 1, url: 'x' };
      },
    };
    const attemptFix = async (): Promise<FixOutcome> => ({ kind: 'skipped', reason: 'cannot localize' });
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();
    assert.equal(prCreated, false);
    const attempt = store.getAttempt('acme/app', 7);
    assert.equal(attempt?.status, 'SKIPPED');
    assert.equal(attempt?.reason, 'cannot localize');
  });

  it('records FAILED when the fix attempt fails', async () => {
    const store = newStore();
    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const attemptFix = async (): Promise<FixOutcome> => ({ kind: 'failed', error: 'boom' });
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();
    const attempt = store.getAttempt('acme/app', 7);
    assert.equal(attempt?.status, 'FAILED');
    assert.equal(attempt?.reason, 'boom');
  });

  it('opens a pull request and records PR_OPEN on a successful fix', async () => {
    const store = newStore();
    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    const captured: { params: { title: string; body: string; head: string; base: string } | null } = { params: null };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async (_repo, params) => {
        captured.params = params;
        return { number: 42, url: 'https://github.com/acme/app/pull/42' };
      },
    };
    const attemptFix = async (input: AttemptFixInput): Promise<FixOutcome> => ({
      kind: 'fixed',
      explanation: 'added a null check',
      filesChanged: ['src/user.ts'],
      verifyRan: true,
      verified: true,
      branchName: `errorresolver/issue-${input.issue.number}`,
      baseBranch: 'main',
    });
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();

    assert.ok(captured.params);
    assert.equal(captured.params.head, 'errorresolver/issue-7');
    assert.equal(captured.params.base, 'main');
    assert.match(captured.params.body, /Closes #7/);

    const attempt = store.getAttempt('acme/app', 7);
    assert.equal(attempt?.status, 'PR_OPEN');
    assert.equal(attempt?.prNumber, 42);
    assert.equal(attempt?.prUrl, 'https://github.com/acme/app/pull/42');
  });

  it('records FAILED (not crash) when opening the pull request itself throws', async () => {
    const store = newStore();
    const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => {
        throw new Error('GitHub API rejected the PR');
      },
    };
    const attemptFix = async (input: AttemptFixInput): Promise<FixOutcome> => ({
      kind: 'fixed',
      explanation: 'added a null check',
      filesChanged: ['src/user.ts'],
      verifyRan: false,
      verified: false,
      branchName: `errorresolver/issue-${input.issue.number}`,
      baseBranch: 'main',
    });
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();
    const attempt = store.getAttempt('acme/app', 7);
    assert.equal(attempt?.status, 'FAILED');
    assert.match(attempt?.reason ?? '', /GitHub API rejected the PR/);
  });

  it('processes multiple issues without exceeding maxConcurrentFixes', async () => {
    const store = newStore();
    const items = [1, 2, 3, 4, 5].map((n) => tracked({ githubIssueNumber: n, fingerprintHash: `fp-${n}` }));
    const issueSource: IssueSource = { listIssues: async () => items, reportResolverStatus: async () => {} };
    const github: GitHubGateway = {
      getIssue: async (_repo, number) => ({ ...openIssue, number }),
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const attemptFix = async (): Promise<FixOutcome> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { kind: 'skipped', reason: 'test' };
    };
    const scheduler = new Scheduler({
      issueSource,
      githubFor: () => github,
      projects,
      store,
      config: makeConfig({ maxConcurrentFixes: 2 }),
      logger: silent,
      attemptFix,
    });
    await scheduler.pollOnce();
    assert.ok(maxInFlight <= 2, `expected at most 2 concurrent fixes, saw ${maxInFlight}`);
    assert.equal(store.stats().total, 5);
  });

  it('records a poll error without throwing when the tracker is unreachable', async () => {
    const store = newStore();
    const issueSource: IssueSource = {
      listIssues: async () => {
        throw new Error('tracker unreachable');
      },
      reportResolverStatus: async () => {},
    };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });
    await scheduler.pollOnce();
    assert.match(scheduler.status().lastPollError ?? '', /tracker unreachable/);
  });

  it('runs a cycle on demand, and refuses while one is already running', async () => {
    const store = newStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const issueSource: IssueSource = { listIssues: async () => (await gate, []), reportResolverStatus: async () => {} };
    const github: GitHubGateway = { getIssue: async () => openIssue, getDefaultBranch: async () => 'main', createPullRequest: async () => ({ number: 1, url: 'x' }) };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });

    assert.equal(scheduler.runNow(), true);
    assert.equal(scheduler.status().polling, true);
    assert.equal(scheduler.runNow(), false);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduler.status().polling, false);
    assert.ok(scheduler.status().lastPollAt);
  });

  it('skips a poll cycle that starts while the previous one is still running', async () => {
    const store = newStore();
    let listCalls = 0;
    const releaser: { fn: (() => void) | null } = { fn: null };
    const gate = new Promise<void>((resolve) => {
      releaser.fn = resolve;
    });
    const issueSource: IssueSource = {
      listIssues: async () => {
        listCalls += 1;
        if (listCalls === 1) await gate;
        return [];
      },
      reportResolverStatus: async () => {},
    };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent });
    const firstPoll = scheduler.pollOnce();
    await scheduler.pollOnce(); // should return immediately without calling listIssues again
    assert.equal(listCalls, 1);
    releaser.fn?.();
    await firstPoll;
  });

  it('reports the outcome to error-tracker, matching what was recorded locally', async () => {
    const store = newStore();
    const reported: { fingerprintHash: string; status: string; details: unknown }[] = [];
    const issueSource: IssueSource = {
      listIssues: async () => [tracked()],
      reportResolverStatus: async (fingerprintHash, status, details) => {
        reported.push({ fingerprintHash, status, details });
      },
    };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 42, url: 'https://github.com/acme/app/pull/42' }),
    };
    const attemptFix = async (input: AttemptFixInput): Promise<FixOutcome> => ({
      kind: 'fixed',
      explanation: 'added a null check',
      filesChanged: ['src/user.ts'],
      verifyRan: true,
      verified: true,
      branchName: `errorresolver/issue-${input.issue.number}`,
      baseBranch: 'main',
    });
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });
    await scheduler.pollOnce();

    // First that the resolver is working on it, then how it ended.
    assert.deepEqual(reported.map((r) => r.status), ['IN_PROGRESS', 'PR_OPEN']);
    assert.equal(reported[1]?.fingerprintHash, 'fp-1');
    assert.deepEqual(reported[1]?.details, { prNumber: 42, prUrl: 'https://github.com/acme/app/pull/42' });
  });

  it('does not change the recorded attempt when reporting to error-tracker fails', async () => {
    const store = newStore();
    const issueSource: IssueSource = {
      listIssues: async () => [tracked()],
      reportResolverStatus: async () => {
        throw new Error('error-tracker unreachable');
      },
    };
    const github: GitHubGateway = {
      getIssue: async () => openIssue,
      getDefaultBranch: async () => 'main',
      createPullRequest: async () => ({ number: 1, url: 'x' }),
    };
    const attemptFix = async (): Promise<FixOutcome> => ({ kind: 'skipped', reason: 'cannot localize' });
    const scheduler = new Scheduler({ issueSource, githubFor: () => github, projects, store, config: makeConfig(), logger: silent, attemptFix });

    await assert.doesNotReject(scheduler.pollOnce());

    const attempt = store.getAttempt('acme/app', 7);
    assert.equal(attempt?.status, 'SKIPPED');
    assert.equal(attempt?.reason, 'cannot localize');
  });
});


describe('Scheduler with projects', () => {
  const stores: Store[] = [];
  afterEach(() => {
    stores.splice(0).forEach((s) => s.close());
  });
  const newStore = (): Store => {
    const store = new Store(':memory:');
    stores.push(store);
    return store;
  };

  const issueSource: IssueSource = { listIssues: async () => [tracked()], reportResolverStatus: async () => {} };

  /** A GitHub whose pull-request calls and default-branch lookups are recorded. */
  function recordingGithub() {
    const record = { tokens: [] as string[], pullRequests: [] as { base: string; head: string }[], defaultBranchAsked: 0 };
    const githubFor = (token: string): GitHubGateway => {
      record.tokens.push(token);
      return {
        getIssue: async () => openIssue,
        getDefaultBranch: async () => {
          record.defaultBranchAsked++;
          return 'master';
        },
        createPullRequest: async (_repo, params) => {
          record.pullRequests.push({ base: params.base, head: params.head });
          return { number: 9, url: 'https://github.com/acme/app/pull/9' };
        },
      };
    };
    return { record, githubFor };
  }

  const fixedOnto = (seen: { input?: unknown }) => async (input: { baseBranch: string; token: string }) => {
    seen.input = input;
    return { kind: 'fixed' as const, explanation: 'x', filesChanged: ['a.ts'], verifyRan: false, verified: false, branchName: 'errorresolver/issue-7', baseBranch: input.baseBranch };
  };

  it("bases the fix on the project's branch and opens the pull request against that same branch", async () => {
    const { record, githubFor } = recordingGithub();
    const seen: { input?: { baseBranch: string } } = {};
    const scheduler = new Scheduler({ issueSource, githubFor, projects: makeProjects({ branch: 'release/2' }), store: newStore(), config: makeConfig(), logger: silent, attemptFix: fixedOnto(seen) });
    await scheduler.pollOnce();
    assert.equal(seen.input?.baseBranch, 'release/2');
    assert.deepEqual(record.pullRequests, [{ base: 'release/2', head: 'errorresolver/issue-7' }]);
    assert.equal(record.defaultBranchAsked, 0, "the user's branch is used as given, GitHub is not asked");
  });

  it("hands the project's verify command to the fix attempt, or none when the project has none", async () => {
    for (const verifyCommand of ['npm ci && npm test', null]) {
      const { githubFor } = recordingGithub();
      const seen: { input?: { verifyCommand?: string | null } } = {};
      const scheduler = new Scheduler({ issueSource, githubFor, projects: makeProjects({ verifyCommand }), store: newStore(), config: makeConfig(), logger: silent, attemptFix: fixedOnto(seen) });
      await scheduler.pollOnce();
      assert.equal(seen.input?.verifyCommand, verifyCommand);
    }
  });

  it("uses the project's resolver token when it has one, and its main token when it does not", async () => {
    for (const [resolverToken, expected] of [['pr-token', 'pr-token'], [null, 'project-token']] as const) {
      const { record, githubFor } = recordingGithub();
      const seen: { input?: { token: string } } = {};
      const scheduler = new Scheduler({ issueSource, githubFor, projects: makeProjects({ resolverToken }), store: newStore(), config: makeConfig(), logger: silent, attemptFix: fixedOnto(seen) });
      await scheduler.pollOnce();
      assert.equal(seen.input?.token, expected);
      assert.ok(record.tokens.every((token) => token === expected), 'GitHub is only ever called with that token');
    }
  });

  it('learns the default branch from GitHub once for an imported project, saves it, and does not ask again', async () => {
    const { record, githubFor } = recordingGithub();
    const lookup = makeProjects({ branch: null });
    const seen: { input?: { baseBranch: string } } = {};
    const failing = async (input: { baseBranch: string }) => {
      seen.input = input;
      return { kind: 'failed' as const, error: 'try again' }; // not terminal, so the next poll tries again
    };
    const scheduler = new Scheduler({ issueSource, githubFor, projects: lookup, store: newStore(), config: makeConfig(), logger: silent, attemptFix: failing });
    await scheduler.pollOnce();
    await scheduler.pollOnce();
    assert.equal(seen.input?.baseBranch, 'master');
    assert.deepEqual(lookup.branches, [['1', 'master']]);
    assert.equal(record.defaultBranchAsked, 1);
  });

  it('leaves an issue alone when its project no longer exists, since there is no token to work with', async () => {
    const { record, githubFor } = recordingGithub();
    let attempted = false;
    const scheduler = new Scheduler({
      issueSource: { listIssues: async () => [tracked({ projectId: '999' })], reportResolverStatus: async () => {} },
      githubFor,
      projects: makeProjects(),
      store: newStore(),
      config: makeConfig(),
      logger: silent,
      attemptFix: async () => {
        attempted = true;
        return { kind: 'skipped', reason: 'x' };
      },
    });
    await scheduler.pollOnce();
    assert.equal(attempted, false);
    assert.equal(record.tokens.length, 0);
  });

  it("works from the project's managed clone, fetched at the project's branch just before the attempt", async () => {
    const { githubFor } = recordingGithub();
    const ensured: unknown[] = [];
    const seen: { input?: { localRepoPath?: string | null } } = {};
    const scheduler = new Scheduler({
      issueSource, githubFor, projects: makeProjects({ branch: 'release/2' }), store: newStore(), config: makeConfig(), logger: silent,
      repos: { ensure: async (request) => (ensured.push(request), '/managed/acme/app') },
      attemptFix: async (input) => {
        seen.input = input;
        return { kind: 'skipped', reason: 'x' };
      },
    });
    await scheduler.pollOnce();
    assert.deepEqual(ensured, [{ repo: 'acme/app', branch: 'release/2', token: 'project-token' }]);
    assert.equal(seen.input?.localRepoPath, '/managed/acme/app');
  });

  it('records a failed attempt, with the reason, when the latest code cannot be fetched', async () => {
    const { githubFor } = recordingGithub();
    const store = newStore();
    let attempted = false;
    const scheduler = new Scheduler({
      issueSource, githubFor, projects: makeProjects(), store, config: makeConfig(), logger: silent,
      repos: { ensure: async () => { throw new Error('git fetch of branch main failed: could not resolve host'); } },
      attemptFix: async () => ((attempted = true), { kind: 'skipped', reason: 'x' }),
    });
    await scheduler.pollOnce();
    assert.equal(attempted, false, 'it does not try to fix stale or missing code');
    const attempt = store.getAttempt('acme/app', 7);
    assert.equal(attempt?.status, 'FAILED');
    assert.match(attempt?.reason ?? '', /could not resolve host/);
  });
});
