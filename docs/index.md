---
title: FixFlow: Sentry-compatible error tracking with AI fix PRs
description: Self-hosted error tracker for Sentry SDKs. Groups errors, files GitHub issues, and has an LLM (Ollama, DeepSeek or Anthropic) open fix pull requests.
---

# FixFlow

FixFlow is self-hosted, Sentry-compatible error tracking. It groups the errors your app's Sentry SDK sends, opens a GitHub issue for each new one, and has an LLM attempt a fix that it opens as a pull request for you to review. The model runs locally through Ollama (default `qwen2.5-coder:7b`) or through the DeepSeek or Anthropic API.

Source and releases: [github.com/Ayesh96/FixFlow](https://github.com/Ayesh96/FixFlow).

## Pipeline

1. **Ingest.** Sentry `store` and `envelope` endpoints on `127.0.0.1:3000`.
2. **Group.** By exception type, crashing file and that frame's source line text.
3. **Triage.** A model, or built-in rules when no provider is set up, tags the error (`bot-safe`, `needs-human`, …).
4. **File.** One GitHub issue per new group that has a stack trace.
5. **Resolve.** For each open issue it filed, the model edits a throwaway worktree, your check command runs before and after, and a pull request is opened against your branch.

The resolver does not read triage tags yet; it attempts every open issue FixFlow filed.

## Quick start

Needs Node 24+ and git, on Linux or macOS.

```bash
git clone https://github.com/Ayesh96/FixFlow.git && cd FixFlow
npm install
npm start
```

The first `npm start` in a terminal runs a short setup: dashboard port, data folder, at least one model (it tests Ollama and verifies API keys, and lists only the models they have), and the error-tracking and resolver settings. It checks the ports are free and runs everything through the server's own config checks before it writes `.env`. Run `npm run setup` to change the settings later; it starts from the current `.env`.

Open the printed `http://localhost:7420/?token=…` link once. Add a project on the **Projects** tab (repository, GitHub token, branch) and set your SDK's `dsn` to the project's DSN, for example `http://fixflow@localhost:3000/1`. From another terminal, `curl http://localhost:3000/healthz` should answer `200`.

## Guides

- [Self-hosted error tracking](self-hosted-error-tracking.md): processes, ports, files, what leaves the machine.
- [Sentry alternative](sentry-alternative.md): what it replaces, and a comparison with Sentry, GlitchTip and Bugsink.
- [Sentry errors to GitHub issues](sentry-errors-to-github-issues.md): grouping, filing rules, issue contents, token permissions.
- [AI fixes as pull requests](ai-bug-fix-pull-requests.md): which issues are attempted, the agent loop, retries, cost.
- [Error triage with Ollama](local-llm-error-triage.md): tags, the prompt's definition of a small fix, guardrails.
- [Reference](reference.md): every setting and the security model.

## Limits

Errors only: no tracing, session replay or alert rules. One user, loopback by default. Windows untested. Fix success rate not measured. Source-available under FSL-1.1-ALv2, not an OSI open-source license.
