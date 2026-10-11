---
title: Self-hosted error tracking with FixFlow
description: FixFlow runs as one Node process with SQLite: two loopback ports, one data folder, encrypted GitHub tokens. What it stores and what leaves your machine.
---

# Self-hosted error tracking

FixFlow is one Node 24+ process. Storage is SQLite through Node's built-in `node:sqlite`; there is no database server, queue or cache. The only runtime npm dependency is `express`. git is needed for the resolver.

## Listeners

| | Dashboard | Ingest |
|---|---|---|
| Address | `127.0.0.1:7420` (fixed host, `PORT` changes the port) | `127.0.0.1:3000` (`ORCH_ERRORS_INGEST_HOST`, `ORCH_ERRORS_INGEST_PORT`) |
| Auth | token cookie, `Host` allow-list, `Origin`/`Sec-Fetch-Site` check | optional `sentry_key` (`ORCH_ERRORS_DSN_PUBLIC_KEY`) |
| Routes | UI and `/api` | `store`, `envelope`, `/healthz` |

To accept events from other machines, set `ORCH_ERRORS_INGEST_HOST=0.0.0.0` and a DSN key. FixFlow serves plain HTTP, so put a TLS-terminating reverse proxy in front if events cross a network.

## Data folder

`~/.fixflow` by default (`ORCH_DATA_DIR`):

| Path | Contents |
|---|---|
| `errors.db` | groups, events, triage results |
| `resolver.db` | fix attempts |
| `projects.db` | projects; GitHub tokens AES-256-GCM encrypted |
| `secret.key` | the encryption key, mode 0600 |
| `token` | the dashboard secret, mode 0600 |
| `repos/` | one bare, shallow clone per repository |

Raw events older than 30 days are deleted hourly (`ORCH_ERRORS_RETENTION_DAYS`, `0` keeps them). Groups and counts stay.

A copy of `projects.db` alone holds no usable token, but `secret.key` sits beside it. Back up and protect the folder as you would `~/.ssh`.

## What leaves the machine

- **GitHub:** issue creation and comments, clone and fetch, branch push, pull request creation.
- **Model provider, if it is DeepSeek or Anthropic:** for triage, the message, request method and path, and up to 8 stack frames with their source lines and the local variables of your own frames. For fixes, the issue, up to 3 files from the stack that are pre-loaded, and any file the model reads with its tools. With Ollama on the same machine, nothing goes to a third party.

Local variables never go into the GitHub issue, but they do go to the model. If your SDK captures locals (the Python SDK does by default) and they can hold personal data, keep the model local or turn locals off in the SDK.
