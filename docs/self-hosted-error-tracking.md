---
title: Self-hosted error tracking with FixFlow: what runs and where data lives
description: How FixFlow works as a self-hosted error tracker: one Node process, two loopback ports, SQLite files in one data folder, encrypted GitHub tokens, and what leaves your machine.
---

# Self-hosted error tracking

FixFlow is a single Node process. There is no database server, queue or cache to run. It needs Node 24 or newer (it uses the built-in `node:sqlite`) and git.

## What listens

| | Dashboard | Error ingest |
|---|---|---|
| Default address | `127.0.0.1:7420` | `127.0.0.1:3000` |
| Auth | secret token cookie, `Host` allow-list, `Origin` check | optional `sentry_key` |
| Serves | the UI and API | the Sentry `store` and `envelope` endpoints and `/healthz` |

Both bind to loopback by default, so only apps on the same machine can report errors. To accept errors from other machines, set `ORCH_ERRORS_INGEST_HOST=0.0.0.0` and `ORCH_ERRORS_DSN_PUBLIC_KEY`; the server prints a warning at startup. Put a reverse proxy with TLS in front of it if the traffic crosses a network. FixFlow does not do TLS itself.

## What is stored

Everything lives in one data folder, `~/.fixflow` by default (`ORCH_DATA_DIR`):

- `errors.db`, `resolver.db`, `projects.db`: SQLite files.
- `token`: the dashboard's secret (mode 0600).
- `secret.key`: the key that encrypts GitHub tokens in `projects.db` (AES-256-GCM, mode 0600).
- `repos/`: one shallow clone per repository, used to make fix worktrees.

Raw events older than 30 days are pruned hourly (`ORCH_ERRORS_RETENTION_DAYS`; `0` keeps everything). Issue rows and counters stay.

## What leaves the machine

Only requests to GitHub (issues, clones, pushes, pull requests) and to the model you choose. With a local Ollama model, no code is sent to a model provider. With DeepSeek or Anthropic configured, stack frames and code excerpts go to that provider.

## Backups and upgrades

Copy the data folder. A copied database contains no usable GitHub token without `secret.key`, which sits beside it, so treat the folder like an SSH key directory. Releases are tarballs; unpack a new one and start it against the same data folder.

See the [reference](reference.md) for every setting.
