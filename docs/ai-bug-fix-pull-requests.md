---
title: "AI bug fixes as PRs: a Sentry Seer alternative"
description: "How Code Akos turns production errors into AI fix pull requests with a local or hosted model: what it attempts, what the model can do, cost and safety."
---

# AI bug fixes as pull requests

Code Akos's **resolver** reads each GitHub issue Code Akos filed, asks an AI model to fix the bug in a temporary copy of your repository, runs your tests, and opens the change as a pull request. You review it and decide whether to merge. Code Akos never merges anything itself.

It does a similar job to Sentry's Seer, but it runs on your own computer, works with a model you choose (including a free local model through [Ollama](https://ollama.com)) and has no per-seat price.

## Which issues it works on

Every 5 minutes, the resolver looks at the issues Code Akos filed and attempts each one that:

- is still open on GitHub and belongs to a project that still exists;
- does not already have a pull request from Code Akos, and was not skipped before;
- is not waiting after a failed attempt. It waits 15 minutes after the first failure, then twice as long each time, and stops trying on its own after 3 failures.

Up to 3 issues are worked on at the same time. **Run resolver now** on the Projects page starts a round immediately, and **Try again anyway** on a single error retries it even after it was skipped or reached the failure limit. All of these numbers can be changed in Settings.

!!! warning "Triage tags do not stop the resolver"
    The resolver currently attempts every open issue Code Akos filed, including ones triage tagged `needs-human` or `infrastructure`. With a paid API, each of those attempts costs money. To keep the resolver away from an issue, close it on GitHub.

## What happens in one attempt

1. **Prepare a copy.** Code Akos fetches the latest commit of your project's branch and creates a temporary working copy on a new branch, `code-akos/issue-<number>`.
2. **Check that the tests pass first.** If you set a check command (such as `npm ci && npm test`), it runs now. If it already fails before any change, the issue is skipped, because a fix could not be verified.
3. **Let the model work.** The model gets the issue and up to 3 source files named in the stack trace. It can then use four tools: read a file, list a folder, search the code and edit a file. It has no shell, so it cannot run commands or install anything. It gets up to 20 turns.
4. **Get a verdict.** The model must finish with either `FIX: <what changed>` or `SKIP: <why>`. A skip, or a "fix" that changed no files, is recorded as skipped. Running out of turns without a verdict counts as a failure.
5. **Check again and open the pull request.** The check command runs again, the change is committed as `Code Akos <code-akos@localhost>`, pushed, and opened as a pull request against your branch.

The instructions given to the model ask it to change only a few lines in one or two files, to fix only the reported bug, to make no change when the cause is unclear, and to treat the issue text as data, not as instructions. That last rule matters because error messages can contain text an attacker controls.

## What the pull request contains

- **Title:** `Fix: <issue title>`.
- **Description:** starts with `Closes #<issue>`, so merging it closes the issue. Then the model's explanation of the bug and the fix, and the list of changed files.
- **A verification note**, one of:
    - *Verified:* the check command passed after the change.
    - *Unverified:* no check command is set for this project.
    - *Check still failing:* the command failed after the change. The pull request is still opened so you can see the attempt, but read the note before merging.

## When it decides not to fix

A good fixer knows when not to touch the code. The model is told to make no change unless it can pinpoint the cause in your own code and fix it in a few lines. So the resolver skips an issue when:

- the cause is outside your code, for example another service sending bad data, a database being down or a missing secret;
- the stack trace points into a third-party library rather than your code;
- the model cannot tell what the right fix is;
- your tests were already failing before any change.

The reason is shown in the dashboard under **Why it was skipped**, so even a skipped issue tells you something useful. If you still want a fix, **Try again anyway** runs the resolver once more and tells the model that a person asked for it, so it should make the most reasonable small change, such as handling the failing case, rather than give up. See [using the dashboard](usage.md#when-a-fix-is-skipped) for an example.

## Choosing a model

The resolver tries the providers you set up, in order, and moves to the next one only if a call fails:

| Provider | Cost | Privacy | Default model |
|---|---|---|---|
| Ollama | Free, runs on your computer | Nothing leaves your machine | `qwen2.5-coder:7b` |
| DeepSeek | Paid per call | The issue and source files are sent to DeepSeek | `deepseek-flash` |
| Anthropic | Paid per call | The issue and source files are sent to Anthropic | `claude-haiku-4-5` |

Hosted models are generally stronger at code than a 7-billion-parameter local model. A local model is a good way to start, since it costs nothing to try, and you can add a hosted one later in Settings. The [configuration reference](reference.md#configuration) lists every model setting.

## Cost and risk

- **API cost.** With DeepSeek or Anthropic, every turn is a paid call: up to 20 per attempt and 3 failed attempts per issue. Skipped attempts and successful fixes also cost the turns they used. With Ollama there is no per-call cost.
- **Your check command runs on your computer.** It runs as your user, in the temporary copy, and it runs code from the branch, including the model's change. Only use a command you would run yourself.
- **Fix quality is not measured yet.** How often the fixes are correct has not been measured. Review every pull request as carefully as one from a new contributor.

## Code Akos resolver vs Sentry Seer

| | Code Akos resolver | Sentry Seer |
|---|---|---|
| Where it runs | Your computer or server | Sentry's cloud |
| Model | Your choice: Ollama (local), DeepSeek or Anthropic | Sentry's choice |
| Price | Free with Ollama; API costs with hosted models | $40 per active contributor per month, on a paid Sentry plan |
| Opens pull requests | Yes, for every issue it filed | Yes |
| Tracing and other Sentry data | No, errors only | Yes |

Facts about Seer are from Sentry's documentation and pricing, checked in October 2026.
