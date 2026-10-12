---
title: "Error triage with Ollama and a local LLM"
description: "How FixFlow triages production errors with a model served by Ollama, DeepSeek or Anthropic: setup, tags, what the model sees, guardrails, and measured results."
---

# Error triage with Ollama

Triage reads each new error group once and records tags, a one-line finding and a suggested next step. Its only effect outside the dashboard is the `bot-safe` GitHub label; the resolver does not use the tags.

## Providers

- **Ollama.** Set `ORCH_OLLAMA_URL=http://localhost:11434`. Triage uses Ollama only when this is set. Model: `ORCH_OLLAMA_MODEL`, default `qwen2.5-coder:7b` (`ollama pull qwen2.5-coder:7b`).
- **DeepSeek / Anthropic.** Set `ORCH_DEEPSEEK_API_KEY` or `ORCH_ANTHROPIC_API_KEY`. Default models: `deepseek-flash`, `claude-haiku-4-5`.
- **Order.** `ORCH_TRIAGE_PROVIDERS`, falling back to `ORCH_LLM_PROVIDERS` (default `ollama,deepseek,anthropic`).

With no provider set up, built-in rules triage every error. With providers set up and all failing, the error is marked `ERRORED`; the rules are not used as a substitute. It can be re-run from the dashboard.

## Tags

| Tag | Set when |
|---|---|
| `bot-safe` | The model says it is a small fix and the stack reaches your own code (or it is a lint finding). Rules: the message matches a known small mistake, such as `Cannot read properties of undefined`, `X is not defined`, `X is not a function`, Python `NameError`, `'NoneType' object has no attribute`, an unbound local, or a lint finding. |
| `needs-human` | Anything that is not `bot-safe` and not a test. |
| `no-stack-trace` | No frames, so there is no culprit to point at. |
| `infrastructure` | Permission or configuration wording (`EACCES`, `permission denied`, `forbidden`, …) or network wording (`ECONNREFUSED`, `ETIMEDOUT`, `503`, `rate limited`, …). |
| `third-party` | The stack has frames, but none of them is in your app's code. |
| `test-event` | A message (not an exception) at `debug`, `info` or `warning` that contains test words such as "test" or "please ignore" and no failure words. |

## What the model sees

The exception type and message, level, platform, environment, `service` tag, request method and path, and up to 8 frames newest first, with source lines and, for your own frames, local variables. It replies in JSON; `small_fix` is defined in the prompt as a thrown exception fixable by about 2 to 5 lines in one place in your code (a missing null check, a typo, a missing import, a wrong variable), or a lint finding.

## Guardrails

The model's answer is corrected where it contradicts facts about the event:

- `bot-safe` requires a stack that reaches your own code, or a lint finding. A log line or a failure inside a library is never `bot-safe`.
- `bot-safe` and `needs-human` are never set together.
- `test-event` is removed from a real exception.
- `third-party` is removed when there is no stack or the stack has an app frame.
- A "don't report it" suggestion on anything not tagged `test-event` is replaced with a neutral one.

## Measured results

Twelve situations were replayed against a copy of a real Python project with five injected bugs, with rules only and with `qwen2.5-coder:7b`, before and after a round of fixes that included these guardrails: [Triage test results](TRIAGE-BEFORE-AFTER.md). That run measures triage only, not fixes.
