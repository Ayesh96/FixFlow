# Triage scenarios

What happens to an error between arriving and (maybe) becoming a GitHub issue. The executable version is
[`test/workflows/errors/scenarios.test.ts`](../test/workflows/errors/scenarios.test.ts); this is the index.

## The two questions

Every error is asked two separate things, and they are tested separately:

| | Question | Decided by |
|---|---|---|
| **Triage** | What is this, and what should be done about it? | rules, or the model when `ORCH_OLLAMA_URL` is set |
| **Filing** | Does it become a GitHub issue, and with which label? | three gates, then the `bot-safe` tag |

**Triage only annotates.** It never decides whether an error is filed. The filing gates are:
1. level at or above `ORCH_ERRORS_MIN_LEVEL` (default `error`);
2. a stack trace, unless the project turns on *also file errors without a stack trace*;
3. a project that exists.

The one thing filing takes from triage is the `bot-safe` label, which is what the resolver acts on.

## Scenarios

`filed` is the result by default; "filed*" is the result when the project files stack-less errors.

### 1. Invalid issues: not worth reporting

| Situation | Tags | Suggestion | Filed |
|---|---|---|---|
| Test message at `info` ("errorflow test from MacRemote") | `test-event` `no-stack-trace` | Don't report it | no |
| "hello world ping" at `debug` | `test-event` `no-stack-trace` | Don't report it | no |
| "testing the alert pipeline, please ignore" at `warning` | `test-event` `no-stack-trace` | Don't report it | no |
| "sentry test please ignore" sent as `error` | `no-stack-trace` `needs-human` | Report it only if someone recognises it | no (filed*) |
| "Failed to ping the database" at `info` | `no-stack-trace` `needs-human` | Report it only if someone recognises it | no |
| "Unit test runner crashed in production" at `warning` | `no-stack-trace` `needs-human` | Report it only if someone recognises it | no |

A message is read as a test only if it says so ("test", "please ignore"…), reports no failure, **and** was sent at `debug`, `info` or `warning`.
Anything sent as an error is treated as real.

### 2. Valid issues with no stack trace

| Situation | Tags | Filed |
|---|---|---|
| Exception that arrived without frames | `no-stack-trace` `needs-human` | no; filed* unlabelled |
| Error-level log line ("payment gateway returned 500") | `no-stack-trace` `needs-human` | no; filed* unlabelled |
| Warning-level log line | `no-stack-trace` `needs-human` | no, below the minimum level, even with the setting on |

### 3. Valid issues with a stack trace

| Situation | Tags | Filed |
|---|---|---|
| `TypeError: Cannot read properties of undefined` in app code | `bot-safe` (names the function) | yes, label `bot-safe` |
| `ReferenceError: x is not defined` | `bot-safe` | yes, label `bot-safe` |
| Lint finding (`eslint: … no-unused-vars`) | `bot-safe` | yes, label `bot-safe` |
| Ordinary bug in app code (`KeyError`) | `needs-human` (names file and line) | yes, no label |
| Connection failure (`ECONNREFUSED`) | `infrastructure` `needs-human` | yes, no label |
| Crash that never enters app code | `third-party` `needs-human` | yes, no label |
| Real exception that merely says "test" (`test fixture missing`) | `needs-human` (not a test) | yes, no label |

### 4. Filing gates, independent of triage

| Situation | Triage | Filed |
|---|---|---|
| Bot-safe-looking crash at `warning` | `bot-safe` | no, below the minimum level |
| `fatal` with a stack trace | `needs-human` | yes |
| Reported to a project that was deleted | `needs-human` | no |

### 5. A model in the loop

| Situation | Result |
|---|---|
| Model calls a `TypeError` too big for a bot | tags `needs-human`, filed without the label (overrules the rules) |
| Model promotes a `KeyError` | tags `bot-safe`, filed with the label |
| Model calls an error noise ("Don't report it") | still filed: triage advises, filing decides |
| Model is down, slow, malformed, or leaves out its wording | rules answer (`source: rules`), wording never contradicts the model's verdict |
| Triage throws | status `ERRORED` with the reason; the error is **still filed** |

### 6. Repeats and re-runs

| Situation | Result |
|---|---|
| Same error 3 times | triaged once, one issue, count 3 |
| Error repeats while still being analysed | not triaged twice; filed once when the finding is in |
| **Triage again** on a filed error | finding replaced, not filed a second time |
| **Triage again** on an unfiled error | finding replaced; filed only if it now passes the gates |
| **Triage again** once its events are pruned | refused, with the reason; triages when it next occurs |

## Coverage

| Layer | Where | Covers |
|---|---|---|
| Unit | `triage.test.ts` | each rule, the model's JSON handling and fallbacks |
| Integration | `scenarios.test.ts` | event → triage → filing → labels, through the real `Ingestor` |
| Integration | `ingest.test.ts` | queueing, pending state, failure, re-triage |
| Store / HTTP | `store.test.ts`, `routes.test.ts` | the stored record, the re-triage endpoint |
| UI logic | `lifecycle.test.ts` | stages and the funnel |

**Not covered:** the model's real answers (only stand-ins are tested; its quality needs a hand-labelled set of real errors run against Ollama), and the UI components (no browser or component tests yet).

## Known limits of the rules

- They read the message and the top of the stack. They cannot tell a real `info`-level message that happens to contain "test" from a test.
- A test message sent at `error` is treated as real. That is deliberate (see §1): dismissing a real failure costs more than reading a test.
- `bot-safe` from the rules is a pattern match on a few common messages, not an understanding of the code.
