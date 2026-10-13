import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Project } from '../../../server/projects/store.ts';
import { computeFingerprint, fingerprintScope } from '../../../server/workflows/errors/grouping.ts';
import { Ingestor } from '../../../server/workflows/errors/ingest.ts';
import { Store } from '../../../server/workflows/errors/store.ts';
import type { Triager } from '../../../server/workflows/errors/triage.ts';
import type { RepoRef, TriageResult, TriageTag } from '../../../server/workflows/errors/types.ts';
import { silentLogger } from '../helpers.ts';
import { FakeTracker, P, projectsOf } from './fakes.ts';
import { normalized } from './fixtures.ts';

/**
 * Scenarios for the path an error takes: event → triage record → filing decision → GitHub labels.
 * Each row is one situation, written the way a person would describe it, run through the real Ingestor
 * with the rule-based triage (or a stand-in model where the row says so). docs/TRIAGE-SCENARIOS.md is the readable index.
 *
 * Two questions are asked of every row and are deliberately separate:
 *   triage  - what did we conclude about the error?   (tags, wording)
 *   filing  - did it become a GitHub issue, with what label?
 * Triage only ever annotates. The filing gates (minimum level, stack trace, known project) are unchanged by it.
 */

const REPO: RepoRef = { owner: 'acme', repo: 'web' };
let counter = 0;
const id = () => `sc${(++counter).toString().padStart(30, '0')}`;

type Frame = { filename: string; function: string; lineno: number; in_app: boolean };
const app = (fn: string, file = 'app/service.py', line = 10): Frame => ({ filename: file, function: fn, lineno: line, in_app: true });
const lib = (fn: string, file = 'node_modules/left-pad/index.js', line = 3): Frame => ({ filename: file, function: fn, lineno: line, in_app: false });

/** A plain message, as sent by `capture_message`: no exception, no stack trace. */
const message = (text: string, level = 'info') => () => ({ event_id: id(), platform: 'python', level, message: text });
/** A thrown exception. `frames: []` is an exception that arrived without a stack trace. */
const thrown = (type: string, value: string, frames: Frame[], level = 'error') => () => ({
  event_id: id(),
  platform: 'python',
  level,
  exception: { values: [{ type, value, stacktrace: { frames } }] },
});

/** A message with the stack of the code that logged it, as an SDK sends with `attach_stacktrace`. */
const logged = (text: string, level = 'error', frames: Frame[] = [app('display_sleep', 'main.py', 131)]) => () => ({
  event_id: id(),
  platform: 'python',
  level,
  message: text,
  threads: { values: [{ crashed: false, current: true, stacktrace: { frames } }] },
});

interface Scenario {
  name: string;
  event: () => Record<string, unknown>;
  /** The project's "also file errors without a stack trace" setting. Default off. */
  filesStackless?: boolean;
  /** How many times the same error arrives. Default 1. */
  times?: number;
  /** A stand-in for the model. Default: the built-in rules. */
  triage?: Triager;
  expect: {
    tags: TriageTag[];
    /** Wording triage must (or must not) use. */
    message?: RegExp;
    suggestion?: RegExp;
    /** Became a GitHub issue; the labels it was opened with. `null` = not filed. */
    filed: { labels: string[] } | null;
  };
  /** The project id the event arrives under. Default: a real project. */
  projectId?: string;
}

const model = (tags: TriageTag[], message = 'The model read it.', suggestion = 'The model says so.'): Triager => async () => ({ message, suggestion, tags, source: 'model' }) satisfies TriageResult;

const DONT = /^Don't report it/;
const REPORT = /^Report it/;

const groups: { title: string; scenarios: Scenario[] }[] = [
  {
    title: '1. Invalid issues: not worth reporting',
    scenarios: [
      {
        name: 'a test message at info level is read as a test, and is not filed',
        event: message('code-akos test from MacRemote'),
        expect: { tags: ['test-event', 'no-stack-trace'], message: /test message.*no culprit/i, suggestion: DONT, filed: null },
      },
      {
        name: 'a "hello world" ping at debug level is read as a test, and is not filed',
        event: message('hello world ping', 'debug'),
        expect: { tags: ['test-event', 'no-stack-trace'], suggestion: DONT, filed: null },
      },
      {
        name: 'a test message at warning level is still read as a test',
        event: message('testing the alert pipeline, please ignore', 'warning'),
        expect: { tags: ['test-event', 'no-stack-trace'], suggestion: DONT, filed: null },
      },
      {
        // A deliberate trade: we would rather read a test than dismiss a real failure, so an error-level message is never assumed to be a test.
        name: 'a message that says "test" but was sent as an error is NOT assumed to be a test',
        event: message('sentry test please ignore', 'error'),
        expect: { tags: ['no-stack-trace', 'needs-human'], suggestion: REPORT, filed: null },
      },
      {
        name: 'a message that reports a failure is not a test, even if it says "test" or "ping"',
        event: message('Failed to ping the database', 'info'),
        expect: { tags: ['no-stack-trace', 'needs-human'], suggestion: REPORT, filed: null },
      },
      {
        name: 'a failure that mentions "example" or "unit test" is not a test either',
        event: message('Unit test runner crashed in production', 'warning'),
        expect: { tags: ['no-stack-trace', 'needs-human'], suggestion: REPORT, filed: null },
      },
    ],
  },
  {
    title: '2. Valid issues with no stack trace',
    scenarios: [
      {
        name: 'an exception that arrived without frames is triaged as unlocatable, and is not filed by default',
        event: thrown('ValueError', 'bad input', []),
        expect: { tags: ['no-stack-trace', 'needs-human'], message: /culprit cannot be located/, filed: null },
      },
      {
        name: 'the same exception is filed, unlabelled, when the project asks for stack-less issues',
        event: thrown('ValueError', 'bad input', []),
        filesStackless: true,
        expect: { tags: ['no-stack-trace', 'needs-human'], filed: { labels: [] } },
      },
      {
        name: 'a plain error-level log line is triaged as needing a person, and is not filed by default',
        event: message('payment gateway returned 500', 'error'),
        expect: { tags: ['no-stack-trace', 'needs-human'], message: /nothing in the code can be pointed at/i, suggestion: /stack trace/i, filed: null },
      },
      {
        name: 'the same log line is filed, unlabelled, when the project asks for stack-less issues',
        event: message('payment gateway returned 500', 'error'),
        filesStackless: true,
        expect: { tags: ['no-stack-trace', 'needs-human'], filed: { labels: [] } },
      },
      {
        name: 'a warning-level log line is triaged but is below the minimum level, so is never filed',
        event: message('disk is 91% full', 'warning'),
        filesStackless: true,
        expect: { tags: ['no-stack-trace', 'needs-human'], filed: null },
      },
    ],
  },
  {
    title: '3. Valid issues with a stack trace',
    scenarios: [
      {
        name: 'a null-property crash in app code is bot-safe, names the function, and is filed with the bot-safe label',
        event: thrown('TypeError', "Cannot read properties of undefined (reading 'id')", [app('render'), app('getUserId', 'src/user.js', 42)]),
        expect: { tags: ['bot-safe'], message: /getUserId/, suggestion: /resolver will try it/, filed: { labels: ['bot-safe'] } },
      },
      {
        name: "Python's undefined name (NameError) is bot-safe",
        event: thrown('NameError', "name 'VOLUME_STP' is not defined", [app('volume', 'main.py', 107)]),
        expect: { tags: ['bot-safe'], message: /volume \(main\.py:107\)/, filed: { labels: ['bot-safe'] } },
      },
      {
        name: "Python's None-has-no-attribute (AttributeError) is bot-safe",
        event: thrown('AttributeError', "'NoneType' object has no attribute 'rstrip'", [app('open_target', 'main.py', 120)]),
        expect: { tags: ['bot-safe'], filed: { labels: ['bot-safe'] } },
      },
      {
        name: 'a missing permission is blamed on the environment, is filed, and gets no label',
        event: thrown('HTTPException', 'osascript is not allowed assistive access. (-1719)', [app('run_osascript', 'main.py', 80)]),
        expect: { tags: ['infrastructure', 'needs-human'], message: /permissions or configuration/, suggestion: /Fix the permission or setting/, filed: { labels: [] } },
      },
      {
        name: 'an undefined name is bot-safe',
        event: thrown('ReferenceError', 'fetchUser is not defined', [app('load')]),
        expect: { tags: ['bot-safe'], filed: { labels: ['bot-safe'] } },
      },
      {
        name: 'a lint finding is bot-safe',
        event: thrown('Error', "eslint: 'x' is defined but never used (no-unused-vars)", [app('build')]),
        expect: { tags: ['bot-safe'], filed: { labels: ['bot-safe'] } },
      },
      {
        name: 'an ordinary bug in app code needs a person, is filed, and gets no label',
        event: thrown('KeyError', "'customer_id'", [app('charge', 'billing/charge.py', 88)]),
        expect: { tags: ['needs-human'], message: /charge \(billing\/charge\.py:88\)/, suggestion: /person should look|have a person look/i, filed: { labels: [] } },
      },
      {
        name: 'a connection failure is blamed on infrastructure, is filed, and gets no label',
        event: thrown('Error', 'connect ECONNREFUSED 127.0.0.1:5432', [app('connect', 'db/pool.js', 12)]),
        expect: { tags: ['infrastructure', 'needs-human'], message: /network or service problem/, suggestion: /close the issue so the resolver does not attempt one/, filed: { labels: [] } },
      },
      {
        name: 'a crash that never enters app code is blamed on the library, is filed, and gets no label',
        event: thrown('RangeError', 'Invalid array length', [lib('pad'), lib('run', 'node_modules/left-pad/run.js', 9)]),
        expect: { tags: ['third-party', 'needs-human'], message: /fails inside a library/, filed: { labels: [] } },
      },
      {
        name: 'a real exception that merely says "test" is NOT mistaken for a test message',
        event: thrown('AssertionError', 'test fixture missing', [app('load_fixture', 'app/fixtures.py', 5)]),
        expect: { tags: ['needs-human'], suggestion: REPORT, filed: { labels: [] } },
      },
    ],
  },
  {
    title: '3b. Messages that carry the stack of the code that logged them',
    scenarios: [
      {
        name: 'a logged failure with a stack is a real, fileable issue pointing at the code that logged it',
        event: logged('display sleep failed: pmset returned a non-zero exit code'),
        expect: { tags: ['needs-human'], message: /logged from display_sleep \(main\.py:131\)/, filed: { labels: [] } },
      },
      {
        name: 'a logged permission problem with a stack is blamed on the environment and filed',
        event: logged('osascript is not allowed assistive access'),
        expect: { tags: ['infrastructure', 'needs-human'], filed: { labels: [] } },
      },
      {
        name: 'a test message that came with a stack is still a test, and is not filed',
        event: logged('code-akos test from MacRemote', 'info'),
        expect: { tags: ['test-event'], suggestion: DONT, filed: null },
      },
      {
        name: 'a warning-level logged failure with a stack is triaged but below the minimum level',
        event: logged('display sleep failed', 'warning'),
        expect: { tags: ['needs-human'], filed: null },
      },
    ],
  },
  {
    title: '4. Filing gates, independent of triage',
    scenarios: [
      {
        name: 'a real, bot-safe-looking crash at warning level is triaged but not filed (below the minimum level)',
        event: thrown('TypeError', "Cannot read properties of undefined (reading 'id')", [app('getUserId')], 'warning'),
        expect: { tags: ['bot-safe'], filed: null },
      },
      {
        name: 'a fatal error with a stack trace is filed',
        event: thrown('RuntimeError', 'out of memory', [app('allocate')], 'fatal'),
        expect: { tags: ['needs-human'], filed: { labels: [] } },
      },
      {
        name: 'an error reported to a project that no longer exists is triaged, and not filed',
        event: thrown('KeyError', "'x'", [app('f')]),
        projectId: '99',
        expect: { tags: ['needs-human'], filed: null },
      },
    ],
  },
  {
    title: '5. When a model is in the loop',
    scenarios: [
      {
        name: 'the model can overrule the rules: a TypeError it calls too big is filed without the label',
        event: thrown('TypeError', "Cannot read properties of undefined (reading 'id')", [app('getUserId')]),
        triage: model(['needs-human']),
        expect: { tags: ['needs-human'], message: /The model read it/, filed: { labels: [] } },
      },
      {
        name: 'the model can promote an error the rules would leave to a person',
        event: thrown('KeyError', "'customer_id'", [app('charge')]),
        triage: model(['bot-safe']),
        expect: { tags: ['bot-safe'], filed: { labels: ['bot-safe'] } },
      },
      {
        name: 'a model that calls an error noise still does not stop it being filed',
        event: thrown('ValueError', 'bad', [app('f')]),
        triage: model(['test-event'], 'Looks like a test.', "Don't report it: not a valid issue."),
        expect: { tags: ['test-event'], suggestion: DONT, filed: { labels: [] } },
      },
    ],
  },
  {
    title: '6. Repeats',
    scenarios: [
      {
        name: 'the same error three times is triaged once and filed once',
        event: thrown('KeyError', "'x'", [app('f', 'app/same.py', 1)]),
        times: 3,
        expect: { tags: ['needs-human'], filed: { labels: [] } },
      },
    ],
  },
];

describe('Triage scenarios', () => {
  for (const group of groups) {
    describe(group.title, () => {
      for (const s of group.scenarios) {
        it(s.name, async () => {
          const store = new Store(':memory:');
          const tracker = new FakeTracker();
          let triageRuns = 0;
          const counting: Triager | undefined = s.triage && (async (e) => (triageRuns++, s.triage!(e)));
          const projects = projectsOf(new Map([[P, REPO]]), { issuesWithoutStack: s.filesStackless === true } satisfies Partial<Project>);
          const ingestor = new Ingestor(store, () => tracker, { projects, minIssueLevel: 'error', commentThresholds: [], retryCooldownMs: 0, triage: counting }, silentLogger());

          const raw = s.event();
          const times = s.times ?? 1;
          const first = normalized(raw);
          for (let i = 0; i < times; i++) ingestor.ingest(normalized({ ...raw, event_id: i === 0 ? raw.event_id : id() }), s.projectId ?? P);
          await ingestor.drain();

          const issue = store.getIssue(computeFingerprint(first, fingerprintScope(s.projectId ?? P, first)));
          assert.ok(issue, 'the error is always tracked');
          assert.equal(issue.count, times);

          // Triage: every error gets a finding, filed or not.
          assert.equal(issue.triageStatus, 'COMPLETED');
          assert.deepEqual(issue.triageTags, s.expect.tags);
          if (s.expect.message) assert.match(issue.triageMessage ?? '', s.expect.message);
          if (s.expect.suggestion) assert.match(issue.triageSuggestion ?? '', s.expect.suggestion);
          assert.equal(issue.triageSource, s.triage ? 'model' : 'rules');
          if (s.triage) assert.equal(triageRuns, 1, 'a repeat never re-triages');

          // Filing: separate from the finding.
          if (s.expect.filed === null) {
            assert.equal(tracker.created.length, 0, 'not filed');
            assert.equal(issue.githubIssueNumber, null);
          } else {
            assert.equal(tracker.created.length, 1, 'filed exactly once');
            assert.deepEqual(tracker.created[0]?.labels, s.expect.filed.labels);
            assert.notEqual(issue.githubIssueNumber, null);
          }
        });
      }
    });
  }
});
