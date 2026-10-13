---
title: "Error triage with Ollama and a local LLM"
description: "How Code Akos uses a local LLM through Ollama, or DeepSeek or Anthropic, to explain production errors, tag them and suggest a fix. Guardrails and test results."
---

# Error triage with Ollama and a local LLM

Triage is the first thing Code Akos does with a new error. A language model reads the error once and records three things: what happened, what to do about it, and tags that sort it (for example, a small fix in your code, or a problem with a server). You see the result in the dashboard, and a small fix gets the `bot-safe` label on its GitHub issue.

You can run triage entirely on your own computer with [Ollama](https://ollama.com), so error details and code never leave your machine. DeepSeek and Anthropic are available too.

## Set up a model

=== "Ollama (local)"

    1. Install [Ollama](https://ollama.com) and start it.
    2. Download the default model:

        ```bash
        ollama pull qwen2.5-coder:7b
        ```

    3. In Code Akos's setup (or **Settings**), switch on **Ollama**, click **Test connection** and pick the model.

    Qwen2.5-Coder 7B is a code-focused model that runs on a typical developer laptop. Any model you have pulled in Ollama appears in the list, so you can choose a larger or smaller one.

=== "DeepSeek or Anthropic (hosted)"

    Switch on the provider in Code Akos's setup and paste an API key. The defaults are `deepseek-flash` and `claude-haiku-4-5`, both fast and inexpensive. Error details are sent to the provider (see [what the model sees](#what-the-model-sees)).

With more than one provider set up, Code Akos uses them in order and falls back to the next if a call fails. With **no** provider set up, Code Akos uses built-in rules instead, which recognise common mistakes by their message. If providers are set up but all of them fail, the error is marked **Couldn't triage** rather than silently handed to the rules, and you can click **Triage again** later.

When running from source, the same choices are made with environment variables: `ORCH_OLLAMA_URL`, `ORCH_OLLAMA_MODEL`, `ORCH_DEEPSEEK_API_KEY`, `ORCH_ANTHROPIC_API_KEY` and `ORCH_TRIAGE_PROVIDERS`. See the [configuration reference](reference.md#configuration).

## What triage records

- **What happened:** a plain explanation, naming the file and line where it went wrong.
- **What to do:** a suggested next step.
- **Tags:** one or more of those below.

| Tag | Meaning |
|---|---|
| `bot-safe` | A small fix in your own code, such as a missing null check, a typo in a name or a missing import. It is the only tag that becomes a GitHub label. |
| `needs-human` | Anything that is not `bot-safe` and not a test: a person should look at it. |
| `infrastructure` | A network, permission or configuration problem, recognised by wording such as `ECONNREFUSED`, `ETIMEDOUT`, `503`, `EACCES` or `permission denied`. |
| `third-party` | The stack trace has frames, but none of them is in your app's code. |
| `no-stack-trace` | There is no stack trace, so there is no culprit line to point at. |
| `test-event` | A message (not an exception) at `debug`, `info` or `warning` level that contains words like "test" or "please ignore" and no failure words. The connection test in the setup guide is one. |

Without a model, the built-in rules give `bot-safe` to messages that match well-known small mistakes: `Cannot read properties of undefined`, `X is not defined`, `X is not a function`, Python's `NameError`, `'NoneType' object has no attribute`, an unbound local variable, and lint findings.

Triage only describes. It does not decide whether an error is filed on GitHub, and the resolver does not currently read the tags; see [which issues are attempted](ai-bug-fix-pull-requests.md#which-issues-it-works-on).

## What the model sees

For each new error group, the model receives:

- the exception type and message, the level, platform and environment, and the `service` tag;
- the request method and path, if the error happened during a request;
- up to 8 stack frames, newest first, with their lines of code and, for frames in your own code, the values of local variables.

It answers in JSON. The instructions define a small fix as a thrown exception that can be fixed with about 2 to 5 lines in one place in your code, or a lint finding.

## Guardrails

Small models sometimes contradict the facts. Code Akos corrects the answer where it disagrees with the event itself:

- `bot-safe` requires a stack trace that reaches your own code (or a lint finding). A log line or a crash inside a library is never `bot-safe`.
- `bot-safe` and `needs-human` are never set together.
- `test-event` is removed from a real exception.
- `third-party` is removed when there is no stack trace, or when the stack includes your own code.
- A suggestion to ignore the error is replaced with a neutral one unless the error is a `test-event`.

## Measured results

Twelve situations were replayed against a copy of a real Python project with five bugs added on purpose, once with the rules only and once with `qwen2.5-coder:7b`, before and after a round of fixes that included these guardrails. The full tables are in [triage test results](TRIAGE-BEFORE-AFTER.md), and each scenario is described in [triage scenarios](TRIAGE-SCENARIOS.md). That test measures triage only, not the quality of fixes.
