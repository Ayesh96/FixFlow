# Triage: before and after the fixes

The same 12 situations, replayed against a copy of MacRemote with five bugs added (a removed guard, a typo'd name,
a `None` method call, a missing macOS permission, a hanging command) plus a logged failure and six messages sent on purpose.
Real Sentry SDK, real Errorflow, a fake GitHub (nothing reached a real repo), and `osascript`/`pmset` replaced by stubs.

Each case was run four ways, before and after the fixes:

| | rules only | with the model (qwen2.5-coder:7b) |
|---|---|---|
| **Current MacRemote Sentry settings** (`dsn` only) | table 1 | table 3 |
| **Richer settings** (`attach_stacktrace`, `environment`, `release`, a `service` tag) | table 2 | table 4 |

Raw results are kept in [`triage-results/`](triage-results/) (`before-*` and `after-*`). Regenerate any table with
`python3 docs/triage-results/compare.py docs/triage-results/before-rich docs/triage-results/after-rich rules`.
Changed cells are **bold**.

## What was fixed

| Problem found | Fix |
|---|---|
| The stack an SDK attaches to a message (`attach_stacktrace`) is in `threads`, which Errorflow ignored, so logged failures were "no stack trace" and never filed | The normalizer reads `threads`; such a message now has a stack, passes the filing gate and names the code that logged it |
| Bot-safe rules only knew JavaScript wording | Python's `NameError`, `'NoneType' object has no attribute`, `'NoneType' object is not subscriptable/iterable/callable` and unbound locals are recognised |
| A missing permission was reported as an ordinary bug | New rule: permission/configuration problems are tagged `infrastructure` and say what to fix, not "change the code" |
| Locals, request and source lines were sent but unused | The triage prompt gets the request and the app frame's locals; the GitHub issue gets the request (method and path only), the source line, and folds library frames |
| Model: `bot-safe` together with `needs-human`; `bot-safe` on log lines; "Don't report it" about real failures; `test-event` on real exceptions; `third-party` on app code | Guardrails on facts the model cannot overrule (see `modelTriager`); each has a test |

Local variables are deliberately **not** put in the GitHub issue (it may be a public repo); the local model sees them.

## 1. Current SDK settings, rules triage

| Case | Tags before | Tags after | Filing before | Filing after |
|---|---|---|---|---|
| Unknown key (guard removed): KeyError | needs-human | needs-human | FILED | FILED |
| Volume up (typo'd name): NameError | needs-human | **bot-safe** | FILED | **FILED [bot-safe]** |
| Open browser (None.rstrip): AttributeError | needs-human | **bot-safe** | FILED | **FILED [bot-safe]** |
| No Accessibility permission: HTTPException | needs-human | **infrastructure, needs-human** | FILED | **FILED** |
| osascript hangs: TimeoutExpired | infrastructure, needs-human | infrastructure, needs-human | FILED | FILED |
| pmset fails, logged as a message | no-stack-trace, needs-human | no-stack-trace, needs-human | not filed | not filed |
| Test message, info | test-event, no-stack-trace | test-event, no-stack-trace | not filed | not filed |
| 'hello world ping', debug | test-event, no-stack-trace | test-event, no-stack-trace | not filed | not filed |
| 'Failed to ping the database', info | no-stack-trace, needs-human | no-stack-trace, needs-human | not filed | not filed |
| 'sentry test please ignore', sent as error | no-stack-trace, needs-human | no-stack-trace, needs-human | not filed | not filed |
| KeyError at warning level | needs-human | needs-human | not filed | not filed |
| Exception created, never raised | no-stack-trace, needs-human | no-stack-trace, needs-human | not filed | not filed |

3 of 12 cases changed.


## 2. Richer SDK settings, rules triage

| Case | Tags before | Tags after | Filing before | Filing after |
|---|---|---|---|---|
| Unknown key (guard removed): KeyError | needs-human | needs-human | FILED | FILED |
| Volume up (typo'd name): NameError | needs-human | **bot-safe** | FILED | **FILED [bot-safe]** |
| Open browser (None.rstrip): AttributeError | needs-human | **bot-safe** | FILED | **FILED [bot-safe]** |
| No Accessibility permission: HTTPException | needs-human | **infrastructure, needs-human** | FILED | **FILED** |
| osascript hangs: TimeoutExpired | infrastructure, needs-human | infrastructure, needs-human | FILED | FILED |
| pmset fails, logged as a message | no-stack-trace, needs-human | **needs-human** | not filed | **FILED** |
| Test message, info | test-event, no-stack-trace | **test-event** | not filed | **not filed** |
| 'hello world ping', debug | test-event, no-stack-trace | **test-event** | not filed | **not filed** |
| 'Failed to ping the database', info | no-stack-trace, needs-human | **needs-human** | not filed | **not filed** |
| 'sentry test please ignore', sent as error | no-stack-trace, needs-human | **needs-human** | not filed | **FILED** |
| KeyError at warning level | needs-human | needs-human | not filed | not filed |
| Exception created, never raised | no-stack-trace, needs-human | no-stack-trace, needs-human | not filed | not filed |

8 of 12 cases changed.


## 3. Current SDK settings, model triage

| Case | Tags before | Tags after | Filing before | Filing after |
|---|---|---|---|---|
| Unknown key (guard removed): KeyError | bot-safe, needs-human | **bot-safe** | FILED | **FILED** |
| Volume up (typo'd name): NameError | bot-safe, needs-human | **bot-safe, third-party** | FILED | **FILED [bot-safe]** |
| Open browser (None.rstrip): AttributeError | bot-safe, needs-human | **bot-safe** | FILED | **FILED [bot-safe]** |
| No Accessibility permission: HTTPException | infrastructure | **infrastructure, needs-human** | FILED | **FILED** |
| osascript hangs: TimeoutExpired | infrastructure | **infrastructure, needs-human** | FILED | **FILED** |
| pmset fails, logged as a message | infrastructure | **infrastructure, no-stack-trace, needs-human** | not filed | **not filed** |
| Test message, info | test-event, no-stack-trace | test-event, no-stack-trace | not filed | not filed |
| 'hello world ping', debug | test-event, no-stack-trace | **no-stack-trace, test-event** | not filed | **not filed** |
| 'Failed to ping the database', info | infrastructure | **infrastructure, no-stack-trace, needs-human** | not filed | **not filed** |
| 'sentry test please ignore', sent as error | test-event, no-stack-trace | test-event, no-stack-trace | not filed | not filed |
| KeyError at warning level | bot-safe, needs-human | **bot-safe** | not filed | **not filed** |
| Exception created, never raised | needs-human | **needs-human, no-stack-trace** | not filed | **not filed** |

10 of 12 cases changed.


## 4. Richer SDK settings, model triage

| Case | Tags before | Tags after | Filing before | Filing after |
|---|---|---|---|---|
| Unknown key (guard removed): KeyError | bot-safe, needs-human | **bot-safe** | FILED | **FILED** |
| Volume up (typo'd name): NameError | bot-safe, no-stack-trace | **bot-safe, third-party** | FILED | **FILED [bot-safe]** |
| Open browser (None.rstrip): AttributeError | bot-safe, needs-human | **bot-safe** | FILED | **FILED [bot-safe]** |
| No Accessibility permission: HTTPException | infrastructure | **infrastructure, needs-human** | FILED | **FILED** |
| osascript hangs: TimeoutExpired | infrastructure | **infrastructure, needs-human** | FILED | **FILED** |
| pmset fails, logged as a message | no-stack-trace, infrastructure | **infrastructure, needs-human** | not filed | **FILED** |
| Test message, info | test-event, no-stack-trace | test-event, no-stack-trace | not filed | not filed |
| 'hello world ping', debug | test-event, no-stack-trace | **no-stack-trace, test-event** | not filed | **not filed** |
| 'Failed to ping the database', info | infrastructure | **no-stack-trace, needs-human** | not filed | **not filed** |
| 'sentry test please ignore', sent as error | test-event | **test-event** | not filed | **FILED** |
| KeyError at warning level | bot-safe, needs-human | **bot-safe** | not filed | **not filed** |
| Exception created, never raised | test-event, no-stack-trace | **no-stack-trace, third-party, needs-human** | not filed | **not filed** |

11 of 12 cases changed.


## Reading the results

* **Python bugs are now `bot-safe`** (NameError, None-attribute), so the resolver will try them. They were `needs-human` before.
* **The permission error** is now `infrastructure`: "fix the permission", not "report a code bug".
* **The real win needs both halves.** With the current SDK settings the logged `pmset` failure is still lost (no stack). With
  `attach_stacktrace=True` *and* Errorflow reading `threads`, it is filed. Either half alone does nothing.
* **A message sent as `error` that says "test"** is now filed once it carries a stack. That is the deliberate rule (an error is never assumed to be a test); the cost is one issue for a test sent at the wrong level.
* **Model run: `third-party` was over-applied** (to app code, and to an exception with no stack). A guard was added *after* this run and is covered by a unit test; the model tables above show the behaviour before that guard.
* The model results vary slightly between runs; the rules results are deterministic.
