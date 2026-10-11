import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVerify as realRunVerify } from '../../../server/workflows/resolver/verify.ts';
import { attemptFix, parseVerdict, runFixAgent, type FixerDeps } from '../../../server/workflows/resolver/fixer.ts';
import type { Config } from '../../../server/workflows/resolver/config.ts';
import type { AgentVerdict } from '../../../server/workflows/resolver/fixer.ts';
import type { ChatClient, OllamaMessage } from '../../../server/workflows/resolver/ollama-client.ts';
import type { GitHubIssue, RepoRef } from '../../../server/workflows/resolver/types.ts';

const repo: RepoRef = { owner: 'acme', repo: 'app' };
const issue: GitHubIssue = {
  number: 7,
  title: 'TypeError: x is undefined',
  body: 'stack trace',
  state: 'open',
  htmlUrl: 'https://github.com/acme/app/issues/7',
};

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    retrySkippedAttempts: false,
    githubApiUrl: 'https://api.github.com',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5-coder:7b',
    anthropic: null,
    pollIntervalMs: 300_000,
    maxConcurrentFixes: 3,
    databasePath: ':memory:',
    ...overrides,
  };
}

/** What the project gives an attempt: the branch to base the work on, and the token to do it with. */
const input = (over: Record<string, unknown> = {}) => ({ repo, issue, workDir: '/tmp/x', token: 'gh-token', baseBranch: 'main', ...over });

interface Calls {
  cloneRepo: unknown[];
  createBranch: unknown[];
  addWorktree: unknown[];
  removeWorktree: unknown[];
  commitAll: unknown[];
  push: unknown[];
  cleanup: unknown[];
}

function makeDeps(overrides: Partial<FixerDeps> = {}, verdict: AgentVerdict = { kind: 'skip', reason: 'default' }) {
  const calls: Calls = { cloneRepo: [], createBranch: [], addWorktree: [], removeWorktree: [], commitAll: [], push: [], cleanup: [] };
  const deps: FixerDeps = {
    cloneRepo: async (...args) => {
      calls.cloneRepo.push(args);
    },
    createBranch: async (...args) => {
      calls.createBranch.push(args);
    },
    addWorktree: async (...args) => {
      calls.addWorktree.push(args);
    },
    removeWorktree: async (...args) => {
      calls.removeWorktree.push(args);
    },
    hasChanges: async () => false,
    changedFiles: async () => [],
    commitAll: async (...args) => {
      calls.commitAll.push(args);
    },
    push: async (...args) => {
      calls.push.push(args);
    },
    cleanup: async (...args) => {
      calls.cleanup.push(args);
    },
    runVerify: async () => ({ ran: false, passed: false, output: '' }),
    runFixAgent: async () => verdict,
    ...overrides,
  };
  return { deps, calls };
}

describe('parseVerdict', () => {
  it('parses a FIX line', () => {
    assert.deepEqual(parseVerdict('I looked at it.\nFIX: added a null check'), { kind: 'fix', explanation: 'added a null check' });
  });
  it('parses a SKIP line', () => {
    assert.deepEqual(parseVerdict('SKIP: cause is in a dependency'), { kind: 'skip', reason: 'cause is in a dependency' });
  });
  it('is case-insensitive', () => {
    assert.deepEqual(parseVerdict('fix: lowercase works too'), { kind: 'fix', explanation: 'lowercase works too' });
  });
  it('returns null when neither line is present', () => {
    assert.equal(parseVerdict('just some text with no verdict'), null);
  });
  it('reads a SKIP followed by the echoed template as a SKIP, not a FIX', () => {
    const reply = 'SKIP: cannot fix this here\n\nFIX: <one sentence describing what you changed and why it fixes the issue>\nSKIP: <one sentence describing why you could not confidently fix it>';
    assert.deepEqual(parseVerdict(reply), { kind: 'skip', reason: 'cannot fix this here' });
  });
  it('returns null when the only verdict lines are the echoed template', () => {
    assert.equal(parseVerdict('FIX: <one sentence describing what you changed>\nSKIP: <one sentence describing why>'), null);
  });
});

function textClient(content: string): { client: ChatClient; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    client: {
      chat: async (): Promise<OllamaMessage> => {
        calls.push(1);
        return { role: 'assistant', content };
      },
    },
  };
}

function throwingClient(message: string): { client: ChatClient; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    client: {
      chat: async (): Promise<OllamaMessage> => {
        calls.push(1);
        throw new Error(message);
      },
    },
  };
}

describe('runFixAgent', () => {
  it('returns the fix verdict on a FIX: line', async () => {
    const { client } = textClient('FIX: added a null check');
    const verdict = await runFixAgent(issue, { cwd: '/tmp/x', client });
    assert.deepEqual(verdict, { kind: 'fix', explanation: 'added a null check' });
  });

  it('returns the skip verdict on a SKIP: line', async () => {
    const { client } = textClient('SKIP: cannot localize it');
    const verdict = await runFixAgent(issue, { cwd: '/tmp/x', client });
    assert.deepEqual(verdict, { kind: 'skip', reason: 'cannot localize it' });
  });

  it('returns an error when the client throws', async () => {
    const { client } = throwingClient('Ollama is not running');
    const verdict = await runFixAgent(issue, { cwd: '/tmp/x', client });
    assert.equal(verdict.kind, 'error');
    assert.match(verdict.kind === 'error' ? verdict.message : '', /Ollama is not running/);
  });

  it('returns an error when no FIX:/SKIP: verdict is ever produced', async () => {
    const { client } = textClient('I think I fixed it, probably.');
    const verdict = await runFixAgent(issue, { cwd: '/tmp/x', client });
    assert.equal(verdict.kind, 'error');
    assert.match(verdict.kind === 'error' ? verdict.message : '', /did not end with a FIX/);
  });

  describe('after an edit landed', () => {
    const editCall = (old: string, replacement: string): OllamaMessage['tool_calls'] => [
      { id: 'c1', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'a.py', old_string: old, new_string: replacement }) } },
    ];
    const scripted = (replies: OllamaMessage[]): ChatClient => ({ chat: async () => replies.shift() ?? { role: 'assistant', content: 'SKIP: out of script' } });
    const repo = async (): Promise<string> => {
      const dir = mkdtempSync(join(tmpdir(), 'fixer-test-'));
      writeFileSync(join(dir, 'a.py'), 'x = out.decode()\n');
      return dir;
    };

    it('returns the FIX announced alongside the edit without another turn', async () => {
      const cwd = await repo();
      const client = scripted([{ role: 'assistant', content: 'FIX: dropped the decode', tool_calls: editCall('out.decode()', 'out') }]);
      assert.deepEqual(await runFixAgent(issue, { cwd, client }), { kind: 'fix', explanation: 'dropped the decode' });
    });

    it('keeps the fix when the model contradicts itself with a SKIP afterwards', async () => {
      const cwd = await repo();
      const client = scripted([
        { role: 'assistant', content: '', tool_calls: editCall('out.decode()', 'out') },
        { role: 'assistant', content: 'SKIP: not reproducible' },
      ]);
      const verdict = await runFixAgent(issue, { cwd, client });
      assert.equal(verdict.kind, 'fix');
      assert.match(verdict.kind === 'fix' ? verdict.explanation : '', /Edited a\.py/);
    });

    it('still skips when the edit itself failed', async () => {
      const cwd = await repo();
      const client = scripted([
        { role: 'assistant', content: 'FIX: tried', tool_calls: editCall('no such text', 'x') },
        { role: 'assistant', content: 'SKIP: could not edit' },
      ]);
      assert.deepEqual(await runFixAgent(issue, { cwd, client }), { kind: 'skip', reason: 'could not edit' });
    });
  });
});

describe('attemptFix', () => {
  it('skips without running the agent when the repo fails verify before any change', async () => {
    let agentCalled = false;
    const { deps, calls } = makeDeps({
      runVerify: async () => ({ ran: true, passed: false, output: 'already red' }),
      runFixAgent: async () => {
        agentCalled = true;
        return { kind: 'skip', reason: 'unused' };
      },
    });
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.equal(outcome.kind, 'skipped');
    assert.equal(agentCalled, false);
    assert.equal(calls.cleanup.length, 1);
  });

  it("checks the repo with the project's own command, run through a shell", async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(workDir, 'marker'), 'x');
    const run = async (verifyCommand: string) => {
      const { deps } = makeDeps({ runVerify: realRunVerify }, { kind: 'skip', reason: 'agent reached' });
      return attemptFix(input({ workDir, verifyCommand }), makeConfig(), deps);
    };

    const failing = await run('test -f marker && test -f missing');
    assert.equal(failing.kind === 'skipped' && failing.reason, 'the repository does not pass its own verify command before any change was made');

    const passing = await run('test -f marker && test ! -f missing');
    assert.equal(passing.kind === 'skipped' && passing.reason, 'agent reached', 'a passing command lets the agent run');
  });

  it('skips when the agent cannot confidently fix it', async () => {
    const { deps, calls } = makeDeps({}, { kind: 'skip', reason: 'stack trace points into a dependency' });
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.deepEqual(outcome, { kind: 'skipped', reason: 'stack trace points into a dependency' });
    assert.equal(calls.commitAll.length, 0);
    assert.equal(calls.push.length, 0);
    assert.equal(calls.cleanup.length, 1);
  });

  it('skips when the agent claims a fix but made no file changes', async () => {
    const { deps, calls } = makeDeps({ hasChanges: async () => false }, { kind: 'fix', explanation: 'did something' });
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.equal(outcome.kind, 'skipped');
    assert.equal(calls.commitAll.length, 0);
    assert.equal(calls.cleanup.length, 1);
  });

  it('reports failed when the agent errors', async () => {
    const { deps, calls } = makeDeps({}, { kind: 'error', message: 'process crashed' });
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.deepEqual(outcome, { kind: 'failed', error: 'process crashed' });
    assert.equal(calls.cleanup.length, 1);
  });

  it('reports failed and still cleans up when cloning throws', async () => {
    const { deps, calls } = makeDeps({
      cloneRepo: async () => {
        throw new Error('clone exploded');
      },
    });
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.deepEqual(outcome, { kind: 'failed', error: 'clone exploded' });
    assert.equal(calls.cleanup.length, 1);
  });

  it('commits, pushes, and reports verified when the fix passes verify', async () => {
    const { deps, calls } = makeDeps(
      {
        hasChanges: async () => true,
        changedFiles: async () => ['src/user.ts'],
        runVerify: async () => ({ ran: true, passed: true, output: 'ok' }),
      },
      { kind: 'fix', explanation: 'added a null check' },
    );
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.deepEqual(outcome, {
      kind: 'fixed',
      explanation: 'added a null check',
      filesChanged: ['src/user.ts'],
      verifyRan: true,
      verified: true,
      branchName: 'errorresolver/issue-7',
      baseBranch: 'main',
    });
    assert.equal(calls.commitAll.length, 1);
    assert.equal(calls.push.length, 1);
    assert.equal(calls.cleanup.length, 1);
  });

  it('still opens with verified: false when the post-fix verify fails', async () => {
    let verifyCalls = 0;
    const { deps, calls } = makeDeps(
      {
        hasChanges: async () => true,
        changedFiles: async () => ['src/user.ts'],
        // First call is the pre-fix check (must pass to proceed); second is post-fix (fails here).
        runVerify: async () => {
          verifyCalls += 1;
          return verifyCalls === 1 ? { ran: true, passed: true, output: 'ok' } : { ran: true, passed: false, output: 'still red' };
        },
      },
      { kind: 'fix', explanation: 'attempted fix' },
    );
    const outcome = await attemptFix(input(), makeConfig(), deps);
    assert.equal(outcome.kind, 'fixed');
    assert.equal(outcome.kind === 'fixed' && outcome.verified, false);
    assert.equal(outcome.kind === 'fixed' && outcome.verifyRan, true);
    // Still committed and pushed — the PR gets opened, flagged as unverified, for a human to judge.
    assert.equal(calls.commitAll.length, 1);
    assert.equal(calls.push.length, 1);
  });

  it("bases the work on the branch the project names, and reports that branch for the pull request", async () => {
    const { deps, calls } = makeDeps(
      { hasChanges: async () => true, changedFiles: async () => ['a.ts'], runVerify: async () => ({ ran: false, passed: false, output: '' }) },
      { kind: 'fix', explanation: 'fixed' },
    );
    const outcome = await attemptFix(input({ baseBranch: 'release/2' }), makeConfig(), deps);
    assert.equal(outcome.kind === 'fixed' && outcome.baseBranch, 'release/2');
    assert.deepEqual(calls.cloneRepo[0], [repo, 'gh-token', '/tmp/x', 'release/2']);
  });

  it('works with master, or any branch name, exactly as given', async () => {
    for (const baseBranch of ['master', 'trunk', 'develop']) {
      const { deps, calls } = makeDeps({}, { kind: 'skip', reason: 'unused' });
      await attemptFix(input({ baseBranch }), makeConfig(), deps);
      assert.equal((calls.cloneRepo[0] as unknown[])[3], baseBranch);
    }
  });

  it("clones, and pushes, with the token it was handed rather than a global one", async () => {
    const { deps, calls } = makeDeps(
      { hasChanges: async () => true, changedFiles: async () => ['a.ts'] },
      { kind: 'fix', explanation: 'fixed' },
    );
    await attemptFix(input({ token: 'this-projects-token' }), makeConfig(), deps);
    assert.equal((calls.cloneRepo[0] as unknown[])[1], 'this-projects-token');
    assert.equal((calls.push[0] as unknown[])[3], 'this-projects-token');
  });

  it("works from the project's managed clone when it is given one, instead of cloning from the network", async () => {
    const { deps, calls } = makeDeps({}, { kind: 'skip', reason: 'unused' });
    await attemptFix(input({ localRepoPath: '/managed/acme/app' }), makeConfig(), deps);
    assert.equal(calls.cloneRepo.length, 0);
    assert.equal(calls.createBranch.length, 0, 'the worktree is created on its branch already');
    assert.deepEqual(calls.addWorktree[0], ['/managed/acme/app', '/tmp/x', 'errorresolver/issue-7', 'main', 'gh-token']);
    assert.deepEqual(calls.removeWorktree[0], ['/managed/acme/app', '/tmp/x', 'errorresolver/issue-7'], 'the worktree is removed afterwards');
    assert.equal(calls.cleanup.length, 0);
  });

  it('falls back to a network clone when it is given no managed clone', async () => {
    const { deps, calls } = makeDeps({}, { kind: 'skip', reason: 'unused' });
    await attemptFix(input(), makeConfig(), deps);

    assert.equal(calls.addWorktree.length, 0);
    assert.equal(calls.removeWorktree.length, 0);
    assert.equal(calls.cloneRepo.length, 1);
    assert.equal(calls.createBranch.length, 1);
    assert.equal(calls.cleanup.length, 1);
  });
});
