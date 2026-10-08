import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { silentLogger } from '../helpers.ts';
import { formatRepo, GitHubError, type CreatedIssue, type IssueTracker } from '../../../server/workflows/errors/github.ts';
import { computeFingerprint, fingerprintScope } from '../../../server/workflows/errors/grouping.ts';
import { Ingestor } from '../../../server/workflows/errors/ingest.ts';
import { Store } from '../../../server/workflows/errors/store.ts';
import type { NormalizedEvent, RepoRef } from '../../../server/workflows/errors/types.ts';
import type { Project } from '../../../server/projects/store.ts';
import { jsEvent, normalized, pyEvent } from './fixtures.ts';

class FakeTracker implements IssueTracker {
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

const P = '1';
/** Stands in for the project database: ids map to repos, and each project has its own token. */
const projectsOf = (map: Map<string, RepoRef>, over: Partial<Project> = {}) => ({
  get: (id: string): Project | undefined => {
    const repo = map.get(id);
    return repo ? { id, repo: formatRepo(repo), branch: 'main', token: `token-${id}`, resolverToken: null, verifyCommand: null, issuesWithoutStack: false, createdAt: '', ...over } : undefined;
  },
});
const fingerprintOf = (e: NormalizedEvent, project = P) => computeFingerprint(e, fingerprintScope(project, e));
const REPO: RepoRef = { owner: 'acme', repo: 'web' };
const log = silentLogger();
let n = 0;
const uniqueEvent = (base: Record<string, unknown> = jsEvent()) => normalized({ ...base, event_id: `evt${(++n).toString().padStart(29, '0')}` });

describe('Ingestor', () => {
  let store: Store;
  let tracker: FakeTracker;
  let ingestor: Ingestor;

  const build = (overrides: Partial<ConstructorParameters<typeof Ingestor>[2]> = {}) => {
    ingestor = new Ingestor(store, () => tracker, { projects: projectsOf(new Map([[P, REPO]])), minIssueLevel: 'error', commentThresholds: [3, 5], retryCooldownMs: 0, ...overrides }, log);
  };

  beforeEach(() => {
    store = new Store(':memory:');
    tracker = new FakeTracker();
    build();
  });

  it('opens exactly one GitHub issue for a new error and records its number and URL', async () => {
    const first = uniqueEvent();
    ingestor.ingest(first, P);
    ingestor.ingest(uniqueEvent(), P); // arrives while the first issue is still being created
    await ingestor.drain();

    assert.equal(tracker.created.length, 1);
    assert.match(tracker.created[0]?.title ?? '', /^\[Error\] TypeError:/);
    const issue = store.getIssue(fingerprintOf(first));
    assert.equal(issue?.count, 2);
    assert.equal(issue?.githubIssueNumber, 101);
    assert.equal(issue?.githubIssueUrl, 'https://github.com/o/r/issues/101');
  });

  it('counts repeats without creating more issues, and tracks first/last seen', async () => {
    const fp = fingerprintOf(uniqueEvent());
    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();
    ingestor.ingest(uniqueEvent(), P);
    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();

    const issue = store.getIssue(fp);
    assert.equal(issue?.count, 3);
    assert.ok((issue?.lastSeen ?? '') >= (issue?.firstSeen ?? 'z'));
    assert.equal(tracker.created.length, 1);
  });

  it('ignores redelivered event_ids (SDK retries)', async () => {
    const event = uniqueEvent();
    ingestor.ingest(event, P);
    ingestor.ingest(event, P);
    await ingestor.drain();
    assert.equal(store.getIssue(fingerprintOf(event))?.count, 1);
  });

  it('opens separate issues for different errors', async () => {
    ingestor.ingest(uniqueEvent(jsEvent()), P);
    ingestor.ingest(uniqueEvent(pyEvent()), P);
    await ingestor.drain();
    assert.equal(tracker.created.length, 2);
  });

  it('comments once when the count hits each threshold', async () => {
    for (let i = 0; i < 6; i++) {
      ingestor.ingest(uniqueEvent(), P);
      await ingestor.drain();
    }
    assert.deepEqual(tracker.comments.map((c) => [c.issue, /\*\*(\d+)\*\*/.exec(c.body)?.[1]]), [[101, '3'], [101, '5']]);
  });

  it('retries a failed creation on the next occurrence instead of losing the issue', async () => {
    tracker.failNextCreates = 1;
    const fp = fingerprintOf(uniqueEvent());
    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();
    assert.equal(store.getIssue(fp)?.githubIssueNumber, null);

    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();
    assert.equal(store.getIssue(fp)?.githubIssueNumber, 101);
    assert.equal(tracker.created.length, 1);
  });

  it('respects the retry cooldown after a failure', async () => {
    build({ retryCooldownMs: 60_000 });
    tracker.failNextCreates = 1;
    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();
    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();
    assert.equal(tracker.created.length, 0);
  });

  it('stores events below the minimum level but does not open issues for them', async () => {
    const warning = uniqueEvent(jsEvent({ level: 'warning' }));
    ingestor.ingest(warning, P);
    await ingestor.drain();
    assert.equal(tracker.created.length, 0);
    assert.equal(store.getIssue(fingerprintOf(warning))?.count, 1);
  });

  it('drops GitHub work, not events, when the queue is full', async () => {
    build({ maxQueuedGithubJobs: 1 });
    tracker.delayMs = 10;
    ingestor.ingest(uniqueEvent(jsEvent()), P);
    const second = uniqueEvent(pyEvent());
    ingestor.ingest(second, P); // queue holds 1 job; this one is dropped
    await ingestor.drain();
    assert.equal(tracker.created.length, 1);
    assert.equal(store.getIssue(fingerprintOf(second))?.count, 1);
  });

  it('prunes old raw events but keeps the issue counters', async () => {
    ingestor.ingest(uniqueEvent(), P);
    await ingestor.drain();
    assert.equal(store.pruneEventsBefore(new Date(Date.now() - 1000)), 0);
    assert.equal(store.pruneEventsBefore(new Date(Date.now() + 1000)), 1);
    assert.equal(store.getIssue(fingerprintOf(uniqueEvent()))?.count, 1);
  });
});

describe('Ingestor with several projects', () => {
  let store: Store;
  let tracker: FakeTracker;
  const web: RepoRef = { owner: 'acme', repo: 'web' };
  const api: RepoRef = { owner: 'acme', repo: 'api' };
  const warnings: unknown[] = [];
  const warnLog = { info() {}, error() {}, warn: (...args: unknown[]) => void warnings.push(args) };

  const build = (projects = new Map([['1', web], ['2', api]])) =>
    new Ingestor(store, () => tracker, { projects: projectsOf(projects), minIssueLevel: 'error', commentThresholds: [2], retryCooldownMs: 0 }, warnLog);

  beforeEach(() => {
    store = new Store(':memory:');
    tracker = new FakeTracker();
    warnings.length = 0;
  });

  it('opens each project\'s issue in its own repo, even for an identical error', async () => {
    const ingestor = build();
    ingestor.ingest(uniqueEvent(), '1');
    ingestor.ingest(uniqueEvent(), '2'); // same stack trace, different project
    await ingestor.drain();

    assert.deepEqual(tracker.created.map((c) => c.repo).sort(), ['acme/api', 'acme/web']);
    const a = store.getIssue(fingerprintOf(uniqueEvent(), '1'));
    const b = store.getIssue(fingerprintOf(uniqueEvent(), '2'));
    assert.notEqual(a?.fingerprintHash, b?.fingerprintHash);
    assert.deepEqual([a?.projectId, a?.githubRepo, a?.count], ['1', 'acme/web', 1]);
    assert.deepEqual([b?.projectId, b?.githubRepo, b?.count], ['2', 'acme/api', 1]);
  });

  it('stores events for unmapped projects without opening issues, warning once', async () => {
    const ingestor = build();
    ingestor.ingest(uniqueEvent(), '99');
    ingestor.ingest(uniqueEvent(), '99');
    await ingestor.drain();

    assert.equal(tracker.created.length, 0);
    assert.equal(store.getIssue(fingerprintOf(uniqueEvent(), '99'))?.count, 2);
    assert.equal(warnings.length, 1);
  });

  it('comments in the repo the issue was opened in, even if the mapping changes later', async () => {
    build().ingest(uniqueEvent(), '1');
    await tracker.settle();
    const remapped = build(new Map([['1', api]])); // project 1 now points elsewhere
    remapped.ingest(uniqueEvent(), '1'); // count reaches the threshold of 2
    await remapped.drain();

    assert.deepEqual(tracker.comments.map((c) => [c.repo, c.issue]), [['acme/web', 101]]);
  });
});

describe('Ingestor stack-trace gate and bot-safe label', () => {
  const setup = (project: Partial<Project> = {}) => {
    const store = new Store(':memory:');
    const tracker = new FakeTracker();
    const ingestor = new Ingestor(store, () => tracker, { projects: projectsOf(new Map([[P, REPO]]), project), minIssueLevel: 'error', commentThresholds: [], retryCooldownMs: 0 }, log);
    return { store, tracker, ingestor };
  };
  const bare = { event_id: '', platform: 'other', level: 'error', exception: { values: [{ type: 'LogError', value: 'dial tcp: i/o timeout' }] } };

  it('stores a frameless event but opens no issue until one arrives with a stack trace', async () => {
    const { store, tracker, ingestor } = setup();
    ingestor.ingest(uniqueEvent(bare), P);
    await ingestor.drain();
    assert.equal(tracker.created.length, 0);
    assert.equal(store.listIssues(10, 0)[0]?.githubIssueNumber, null);

    ingestor.ingest(uniqueEvent({ ...jsEvent(), exception: { values: [{ ...(bare.exception.values[0] as object), stacktrace: { frames: [{ filename: 'a.js', function: 'f', lineno: 1, in_app: true }] } }] } }), P);
    await ingestor.drain();
    assert.equal(tracker.created.length, 1);
    store.close();
  });

  it('files an error with no stack trace on GitHub too when its project asks for that, and still stores every one', async () => {
    const { store, tracker, ingestor } = setup({ issuesWithoutStack: true });
    const event = uniqueEvent(bare);
    ingestor.ingest(event, P);
    ingestor.ingest(uniqueEvent(bare), P);
    await ingestor.drain();

    assert.equal(tracker.created.length, 1, 'one issue however many times it repeats');
    assert.match(tracker.created[0]?.title ?? '', /LogError: dial tcp: i\/o timeout/);
    assert.deepEqual(tracker.created[0]?.labels, [], 'with no stack there is nothing to call a small fix');
    const issue = store.getIssue(fingerprintOf(event));
    assert.equal(issue?.count, 2);
    assert.equal(issue?.githubIssueNumber, 101);
    store.close();
  });

  it('keeps counting a frameless error in the tracker when its project does not want it on GitHub', async () => {
    const { store, tracker, ingestor } = setup({ issuesWithoutStack: false });
    const event = uniqueEvent(bare);
    for (let i = 0; i < 3; i++) ingestor.ingest(uniqueEvent(bare), P);
    ingestor.ingest(event, P);
    await ingestor.drain();
    assert.equal(tracker.created.length, 0);
    assert.equal(store.getIssue(fingerprintOf(event))?.count, 4);
    store.close();
  });

  it('labels small-fix and lint errors bot-safe, and leaves other errors unlabelled', async () => {
    const { store, tracker, ingestor } = setup();
    ingestor.ingest(uniqueEvent(), P); // TypeError: Cannot read properties of undefined, in-app frames
    ingestor.ingest(uniqueEvent(pyEvent()), P); // KeyError
    await ingestor.drain();
    assert.deepEqual(tracker.created.map((c) => c.labels), [['bot-safe'], []]);
    store.close();
  });
});

describe('Ingestor with tagged services', () => {
  it('keeps the same error from two apps as two issues, each remembering its app', async () => {
    const store = new Store(':memory:');
    const tracker = new FakeTracker();
    const ingestor = new Ingestor(store, () => tracker, { projects: projectsOf(new Map([[P, REPO]])), minIssueLevel: 'error', commentThresholds: [2], retryCooldownMs: 0 }, log);
    const from = (service: string) => normalized({ ...jsEvent(), event_id: `svc${(++n).toString().padStart(29, '0')}`, tags: { service } });

    ingestor.ingest(from('smarthome-gateway'), P);
    ingestor.ingest(from('smarthome-go2rtc'), P);
    ingestor.ingest(from('smarthome-gateway'), P);
    await ingestor.drain();

    assert.equal(tracker.created.length, 2);
    const issues = store.listIssues(10, 0);
    assert.deepEqual(issues.map((i) => [i.service, i.count]).sort(), [['smarthome-gateway', 2], ['smarthome-go2rtc', 1]]);
    store.close();
  });

  it('records untagged events with a null service', () => {
    const store = new Store(':memory:');
    const issue = store.recordEvent(normalized(jsEvent()), 'x', 't', '1');
    assert.equal(issue?.service, null);
    store.close();
  });
});


describe('Ingestor with projects from the wizard', () => {
  let store: Store;
  let tracker: FakeTracker;
  const tokensUsed: string[] = [];
  const warnings: unknown[] = [];
  const warnLog = { info() {}, error() {}, warn: (...args: unknown[]) => void warnings.push(args) };

  beforeEach(() => {
    store = new Store(':memory:');
    tracker = new FakeTracker();
    tokensUsed.length = 0;
    warnings.length = 0;
  });

  const build = (map: Map<string, RepoRef>) =>
    new Ingestor(
      store,
      (project) => {
        tokensUsed.push(project.token);
        return tracker;
      },
      { projects: projectsOf(map), minIssueLevel: 'error', commentThresholds: [2], retryCooldownMs: 0 },
      warnLog,
    );

  it("opens each project's issue with that project's own token", async () => {
    const ingestor = build(new Map([['1', { owner: 'acme', repo: 'web' }], ['2', { owner: 'acme', repo: 'api' }]]));
    ingestor.ingest(uniqueEvent(), '1');
    ingestor.ingest(uniqueEvent(), '2');
    await ingestor.drain();
    assert.deepEqual([...tokensUsed].sort(), ['token-1', 'token-2']);
  });

  it('picks up a project added after it started, with no restart', async () => {
    const projects = new Map<string, RepoRef>();
    const ingestor = build(projects);
    ingestor.ingest(uniqueEvent(), '5'); // nobody has added project 5 yet
    await ingestor.drain();
    assert.equal(tracker.created.length, 0);

    projects.set('5', { owner: 'acme', repo: 'late' }); // the wizard adds it
    ingestor.ingest(uniqueEvent(), '5');
    await ingestor.drain();
    assert.deepEqual(tracker.created.map((c) => c.repo), ['acme/late']);
  });

  it('does not try to comment once its project has been deleted, since there is no token left to do it with', async () => {
    const projects = new Map<string, RepoRef>([['1', { owner: 'acme', repo: 'web' }]]);
    const ingestor = build(projects);
    ingestor.ingest(uniqueEvent(), '1');
    await ingestor.drain();

    projects.delete('1');
    ingestor.ingest(uniqueEvent(), '1'); // reaches the comment threshold of 2
    await ingestor.drain();
    assert.equal(tracker.comments.length, 0);
  });
});
