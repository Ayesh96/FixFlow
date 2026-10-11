---
title: FixFlow: self-hosted Sentry-compatible error tracking with AI fix pull requests
description: FixFlow groups errors from Sentry SDKs, opens a GitHub issue for each new one, and can have a local or hosted model attempt a fix and open a pull request. Runs on one machine with Node and git.
---

# FixFlow

FixFlow is self-hosted, Sentry-compatible error tracking that opens a GitHub issue for each new error and can then try a fix with an AI model, so you get a pull request to review. It runs on your own machine with a local Ollama model, DeepSeek or Anthropic.

Source and releases: [github.com/Ayesh96/FixFlow](https://github.com/Ayesh96/FixFlow).

## What it does

1. **Track.** Errors arrive through a Sentry-compatible endpoint and are grouped, so the same error 2,000 times is one issue with a count.
2. **Triage.** A model, or a rule-based fallback, decides whether the error looks like a small fix.
3. **File.** One GitHub issue per new error with a stack trace.
4. **Resolve.** A model attempts a fix in a throwaway worktree, your check command runs, and a pull request is opened against your branch.

## Quick start

You need Node 24 or newer and git, on Linux or macOS.

```bash
git clone https://github.com/Ayesh96/FixFlow.git && cd FixFlow
npm install
npm start
```

Open the link it prints (`http://localhost:7420/?token=…`) once. Then add a project on the **Projects** tab (repository, GitHub token, branch) and paste the project's DSN, such as `http://fixflow@localhost:3000/1`, into your app's Sentry SDK settings.

Check the receiving side with `curl http://localhost:3000/healthz`, which returns `200`.

## Guides

- [Self-hosted error tracking](self-hosted-error-tracking.md): what runs and where data lives.
- [Sentry alternative](sentry-alternative.md): what it replaces and what it does not.
- [Sentry errors to GitHub issues](sentry-errors-to-github-issues.md): grouping and filing rules.
- [AI fixes as pull requests](ai-bug-fix-pull-requests.md): how the resolver works and where it fails.
- [Local LLM error triage with Ollama](local-llm-error-triage.md): labels and model setup.
- [Reference](reference.md): ports, security and every setting.

## Limits

No performance tracing, session replay, alert rules or multiple users. Windows is untested. Fix quality depends on the model and has not been measured. FixFlow is source-available under the Functional Source License (FSL-1.1-ALv2), which is not an OSI open-source license.
