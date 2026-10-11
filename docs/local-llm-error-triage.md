---
title: Local LLM error triage with Ollama: what FixFlow's labels mean
description: Triage production errors with a local Ollama model: how to enable it in FixFlow, the labels it applies and what each means, how it falls back to rules, and what was measured.
---

# Local LLM error triage with Ollama

Triage decides whether a new error looks like a small, fixable bug or needs a person. FixFlow can use a local Ollama model, DeepSeek or Anthropic, and falls back to built-in rules.

## Enable Ollama

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull qwen2.5-coder:7b` (the default).
2. Start FixFlow with `ORCH_OLLAMA_URL=http://localhost:11434` set. Triage uses Ollama only when this is set. The resolver always tries a local Ollama at that address.
3. Change the model with `ORCH_OLLAMA_MODEL`.

With no model configured, the rule-based triage runs. If models are configured and all fail, the error is recorded as `ERRORED` and can be triaged again.

## Labels

| Label | Meaning |
|---|---|
| `bot-safe` | Looks like a small fix a model could attempt. Added as a GitHub label. |
| `needs-human` | Not an obvious small fix. |
| `no-stack-trace` | Arrived without a stack, so the culprit cannot be located. |
| `infrastructure` | Reads like a permission, configuration, network or service problem. |
| `third-party` | The crash is in code you do not own. |
| `test-event` | Looks like a test message, not a real failure. |

Each result also carries a one-line reason and a suggested next step.

## Guardrails on the model

Some facts cannot be overruled by the model. For example, `bot-safe` is not combined with `needs-human`, and a log line without a stack trace is not called `bot-safe`. Each guardrail has a test.

## What was measured

Twelve replayed situations were run against a copy of a real project with injected bugs, before and after fixes, with rules only and with `qwen2.5-coder:7b`. The tables are in [Triage test results](TRIAGE-BEFORE-AFTER.md). The test covers triage only, not the quality of fixes.
