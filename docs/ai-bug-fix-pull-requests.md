---
title: Let an AI model open pull requests for production errors: how the FixFlow resolver works
description: How the FixFlow resolver turns a GitHub issue into a pull request: worktree, model turns, check command, retries and limits, and what to expect from the fixes.
---

# AI fixes as pull requests

The resolver is the part of FixFlow that tries to fix an error. It never merges anything; it opens a pull request for you to review.

## What it does for each issue

1. Fetches the latest of your project's branch into its managed clone.
2. Creates a throwaway git worktree and a branch named `errorresolver/issue-<number>`.
3. Runs your check command (if you set one) before any change. If it already fails, the issue is skipped.
4. Lets the model read and edit files through a small set of tools, up to 20 turns.
5. Runs the check command again, pushes the branch and opens a pull request against your branch.

The pull request says what changed, which files, and whether the check passed. Without a check command, or if it fails after the fix, it is marked unverified.

## Limits you should know

- **Retries.** A failed attempt waits 15 minutes, doubling each time, and stops after 3 attempts (`ORCH_RESOLVER_MAX_ATTEMPTS`). Running an issue from the dashboard ignores the limit.
- **Concurrency.** Three fixes at once by default.
- **Cost.** With DeepSeek or Anthropic, each attempt is paid model calls. A local Ollama model has no per-call cost.
- **Quality.** Fix quality depends on the model. The default local model is `qwen2.5-coder:7b`. There is no measured success rate for fixes yet, so review every pull request as you would a stranger's.
- **Execution.** The check command runs through a shell, as you, on your machine. Only set commands you would run yourself.

## Choosing a model

Set `ORCH_LLM_PROVIDERS` (default `ollama,deepseek,anthropic`) to the models to try in order. The first available one is used and the rest are fallbacks. See [local LLM triage](local-llm-error-triage.md) for Ollama setup and the [reference](reference.md) for keys and URLs.
