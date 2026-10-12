---
title: How FixFlow's resolver turns errors into pull requests
description: The FixFlow resolver: which issues it attempts, the agent's tools and prompt, the check command, retries, cost, and what the pull request contains.
---

# AI fixes as pull requests

The resolver turns an open GitHub issue into a pull request. It never merges.

## Which issues are attempted

Every 5 minutes (`ORCH_RESOLVER_POLL_INTERVAL_MS`) it takes the issues FixFlow filed and attempts each one that:

- is still open on GitHub and belongs to a project that still exists;
- has no earlier attempt that opened a pull request (`PR_OPEN`) or was skipped (`SKIPPED`);
- is not resting after a failure: 15 minutes after the first, doubling each time, and no more automatic tries after 3 failures (`ORCH_RESOLVER_MAX_ATTEMPTS`).

Triage tags are not consulted: issues tagged `needs-human`, `infrastructure` or `third-party` are attempted too. Some triage suggestions in the dashboard say the resolver will not try such errors; with the current code it does. Up to 3 attempts run at once (`ORCH_RESOLVER_MAX_CONCURRENT_FIXES`). Any issue can also be run from the dashboard, which ignores the failure limit.

## One attempt

1. Fetch the project's branch into the bare clone and create a worktree on branch `fixflow/issue-<number>`.
2. Run the check command, if set. If it already fails, the attempt is `SKIPPED`.
3. Pre-load up to 3 source files named in the stack, then run the agent loop: up to 20 turns, with four tools: `read_file`, `list_directory`, `grep` and `edit_file`. The model has no shell.
4. The model must end with `FIX: <what changed>` or `SKIP: <why>`. `SKIP`, or `FIX` with no file changed, records `SKIPPED`. No verdict within 20 turns records `FAILED`.
5. Run the check command again, commit as `FixFlow <fixflow@localhost>`, push, and open the pull request against the project's branch.

The prompt tells the model to change only a handful of lines in one or two files, to fix only the reported bug, to make no change when the cause is unclear, and to treat the issue body as untrusted data rather than instructions.

## The pull request

Title `Fix: <issue title>`. The body starts with `Closes #<issue>`, so merging it closes the issue, then gives the model's explanation, the changed files, and one of these notes:

- *Verified*: the check command passed after the change.
- *Unverified*: no check command is configured.
- The check command still fails after the change. The pull request is opened anyway, so read that note before merging.

## Cost and risk

- With DeepSeek or Anthropic every turn is a paid call: at most 20 per attempt and 3 failed attempts per issue, but `SKIPPED` and `PR_OPEN` outcomes also cost the turns they used. With Ollama there is no per-call cost.
- The check command runs through `sh -c`, as your user, in the worktree. It runs code from the branch, including the model's change.
- Fix success rate has not been measured. Review every pull request as you would a stranger's.

## Model choice

`ORCH_RESOLVER_PROVIDERS` (default: `ORCH_LLM_PROVIDERS`, which defaults to `ollama,deepseek,anthropic`) sets the order. The resolver always includes Ollama at `http://localhost:11434` unless you leave it out of that list. DeepSeek and Anthropic join when their API keys are set. The next provider is used only when the previous one fails. See the [reference](reference.md#configuration).
