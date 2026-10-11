# FixFlow

FixFlow is self-hosted, Sentry-compatible error tracking that opens a GitHub issue for each new error and then tries a fix with an AI model, so you get a pull request to review. It runs on your own machine with a local Ollama model, DeepSeek or Anthropic, and works with the Sentry SDKs your app already uses.

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue)](LICENSE)
[![CI](https://github.com/Ayesh96/FixFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Ayesh96/FixFlow/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Ayesh96/FixFlow)](https://github.com/Ayesh96/FixFlow/releases/latest)
[![Stars](https://img.shields.io/github/stars/Ayesh96/FixFlow?style=flat)](https://github.com/Ayesh96/FixFlow/stargazers)

<!--
DEMO GIF (not recorded yet). To add it: follow docs/launch/demo-recording.md, save the file as
docs/assets/demo.gif, then replace this comment with:
  ![FixFlow: an error arrives, a GitHub issue is filed, a pull request is opened](docs/assets/demo.gif)
-->

## The problem

Your app throws errors in production. Someone has to notice them, group the duplicates, write an issue, find the cause and open a fix. Hosted trackers do the first half well, but the second half is still manual, and self-hosting the full Sentry stack is heavy. FixFlow is one small process that does both halves for small, clear bugs and leaves the decision to merge with you.

## Quick start

You need **Node 24 or newer** and **git**, on Linux or macOS (Windows is not tested).

```bash
git clone https://github.com/Ayesh96/FixFlow.git && cd FixFlow
npm install     # also installs the UI's dependencies
npm start       # builds the UI if it is stale, then serves it
```

It prints a link like `http://localhost:7420/?token=…`. Open it once; your browser remembers it.

Then, in the dashboard:

1. **Projects tab → Add project.** Enter `owner/name`, a GitHub token, and the branch to work on. Optionally add a command that checks a fix, such as `npm ci && npm test`.
2. Copy the project's **error address** (a DSN like `http://fixflow@localhost:3000/1`) into your app's Sentry SDK settings.
3. Trigger an error. It shows up on the **Errors** tab, and a GitHub issue is filed when it has a stack trace.

To check the receiving side without an app, `curl http://localhost:3000/healthz` should return `200`.

No build step is needed if you use a [release tarball](https://github.com/Ayesh96/FixFlow/releases/latest) instead: verify it with `sha256sums.txt`, unpack it, and run `node bin/fixflow.mjs`.

Triage works without any model (a rule-based fallback is used). To let the resolver write fixes, run [Ollama](https://ollama.com) locally, or set `ORCH_DEEPSEEK_API_KEY` or `ORCH_ANTHROPIC_API_KEY`. See the [reference](docs/reference.md#configuration).

## Features

- **Sentry-compatible ingest.** Accepts the Sentry `store` and `envelope` endpoints, including gzip, so you change a DSN and nothing else in your app.
- **Grouping.** Errors are grouped by exception type, crashing file and line, so the same error 2,000 times is one issue with a count.
- **Triage.** A local or hosted model, or a rule-based fallback, labels each error (for example `bot-safe` or `needs-human`) and says why.
- **One GitHub issue per new error**, with the stack trace, and comments at 100, 1,000 and 10,000 events by default.
- **Resolver.** Fetches your branch, lets a model attempt a fix in a throwaway worktree, runs your check command before and after, and opens a pull request. It marks the pull request unverified when the check is missing or fails.

## How it works

```mermaid
flowchart LR
  A[Your app + Sentry SDK] -->|store / envelope| B[FixFlow ingest :3000]
  B --> C[Group by fingerprint]
  C --> D[Triage: model or rules]
  D --> E[GitHub issue]
  E --> F[Resolver: worktree + model + check command]
  F --> G[Pull request on your branch]
```

The dashboard (`127.0.0.1:7420`) and the ingest endpoint (`127.0.0.1:3000`) are two separate sockets in one process. Both listen on loopback by default. Tokens are stored encrypted on disk. The [reference](docs/reference.md) covers the details.

## Compared with alternatives

| | FixFlow | Sentry (hosted or self-hosted) | GlitchTip, Bugsink |
|---|---|---|---|
| Receives Sentry SDK events | Yes | Yes | Yes |
| Opens GitHub issues from errors | Yes, built in | Yes (integration) | Varies; check each project |
| Tries a code fix and opens a pull request | Yes, with your own model | Yes, through Seer, a paid Sentry feature | No |
| Runs on one machine with no extra services | Yes (Node and git) | Heavy; the self-hosted stack needs several services | Lighter than Sentry |
| Performance tracing, session replay, alert rules, release health | **No** | **Yes** | Partial or none |
| Multiple users, teams, roles | **No**, single user on loopback | **Yes** | Yes |
| Quality of the fixes | Depends on the model you give it; no measured success rate yet | Likely better models and context | n/a |

Choose Sentry if you need tracing, alerting, teams or a large SDK and integration ecosystem. Choose GlitchTip or Bugsink if you want a mature, multi-user, self-hosted tracker and do not need automated fixes. Choose FixFlow if you want the loop from error to reviewable pull request on your own machine, for a small project, and you accept that it is young. General coding agents that work from a GitHub issue, such as GitHub's Copilot coding agent, are broader than FixFlow and may give better fixes; FixFlow's difference is the Sentry intake and that a local model can be used.

Triage was measured on 12 replayed situations; see [docs/TRIAGE-BEFORE-AFTER.md](docs/TRIAGE-BEFORE-AFTER.md). Fix quality has not been measured.

## Roadmap

There is no committed roadmap. Known gaps you can help with:

- Windows support (not tested today).
- A measured success rate for the resolver, the way triage has one.
- A container image (none exists yet).

Ideas and bug reports are welcome as [issues](https://github.com/Ayesh96/FixFlow/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits need a DCO sign-off (`git commit -s`). Run `npm run typecheck && npm test` before opening a pull request.

## License

FixFlow is **source-available** under the [Functional Source License, version 1.1](LICENSE) (`FSL-1.1-ALv2`), not an OSI open-source license.

- You may **use, run, modify and self-host it**, including inside a company, for free.
- You may **not** use it to offer a competing commercial product or service.
- Each release converts to the **Apache License 2.0 two years after** it is published.

"FixFlow" is the name of this project; a fork has to use another name. To report a suspected violation, open an issue or contact the maintainer.
