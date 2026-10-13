---
title: "Self-hosted error tracking without Docker"
description: "Code Akos is self-hosted error tracking in one process with SQLite: no Docker, no database server. What it stores, where, and what leaves your machine."
---

# Self-hosted error tracking

Self-hosting your error tracker means your errors, stack traces and source code stay on hardware you control. The catch is usually the setup: most self-hosted trackers need Docker, a database server and a background queue. Code Akos needs none of these. It is a single process that stores everything in SQLite files in one folder, and it runs as a desktop app or on a small server.

This page explains what Code Akos runs, what it stores and exactly what leaves your machine.

## What runs

Code Akos is one Node.js process. The desktop app includes its own copy of Node.js, so you do not install anything except git. There is no database server, no queue and no cache: storage is SQLite, built into Node.js.

The process opens two ports:

| | Dashboard | Ingest |
|---|---|---|
| What it is for | The dashboard you use in the app or a browser | Receiving errors from your apps' Sentry SDKs |
| Default address | `127.0.0.1:7420` | `127.0.0.1:3000` |
| Who can reach it | Only this computer | Only this computer, until you open it up |
| Protection | A secret login token, plus checks that block requests from other websites | An optional access key in the DSN |

Both ports listen only on your own computer (loopback) by default. They are kept apart on purpose: Sentry SDKs, especially in browsers, send errors from other origins without cookies, so the ingest port cannot use the dashboard's protections. Giving it its own port means the dashboard never has to loosen them.

### Receiving errors from other machines

To accept errors from apps on a server or another computer, set **Accept reports from** to **Any machine on the network** in Settings (or `ORCH_ERRORS_INGEST_HOST=0.0.0.0` when running from source). Then:

- set an **access key**, so only your apps can send errors;
- put a reverse proxy with HTTPS (such as Caddy or nginx) in front of the ingest port if errors travel over the internet, because Code Akos itself serves plain HTTP.

## What it stores

Everything lives in one data folder, `~/.code-akos` by default:

| File or folder | Contents |
|---|---|
| `errors.db` | Error groups, individual events and triage results |
| `resolver.db` | Fix attempts and their outcomes |
| `projects.db` | Your projects, with GitHub tokens encrypted (AES-256-GCM) |
| `secret.key` | The key that encrypts those tokens, readable only by you |
| `token` | The dashboard's login secret, readable only by you |
| `repos/` | One lightweight copy of each repository, used to prepare fixes |

Individual events older than 30 days are deleted every hour. Error groups, counts and GitHub links are kept. You can change the number of days in Settings, or set it to `0` to keep everything.

!!! warning "Protect the data folder like your SSH keys"
    A copy of `projects.db` on its own contains no usable token. But `secret.key` sits right next to it, so anyone who can read the whole folder can read your tokens. Back it up and protect it as you would `~/.ssh`.

## What leaves your machine

**To GitHub:** creating issues and comments, copying and updating your repository, pushing the branch with a fix and opening the pull request.

**To your model provider, only if you use DeepSeek or Anthropic:**

- for triage: the error message, the request method and path, and up to 8 stack frames with their lines of code and, for your own code, local variable values;
- for fixes: the GitHub issue, up to 3 source files from the stack trace, and any other file the model chooses to read.

**With Ollama on the same computer, nothing goes to a third party.**

!!! note "Local variables"
    Some SDKs, including the Python SDK by default, capture the values of local variables when an error happens. Code Akos never writes them into GitHub issues, but it does show them to the model, because they often explain the bug. If those values can include personal data, use a local model or turn off local variables in your SDK.

Code Akos sends no analytics or telemetry of its own.

## Requirements compared with other trackers

| | What you need to run it |
|---|---|
| Code Akos | The desktop app, or Node.js 24+ and git on a server |
| Sentry (self-hosted) | Docker Compose with 53 services; 4 cores, 16 GB RAM and 16 GB swap |
| GlitchTip | The app plus PostgreSQL; from 256 MB RAM |
| Bugsink | One container; SQLite, MySQL or PostgreSQL |

For features, not just footprint, see the [comparison of Sentry alternatives](sentry-alternative.md).

## Running on a server

The desktop app suits running Code Akos on the computer you develop on. For an always-on Linux server, run it from source with Node.js 24 or newer: see [installation](installation.md#run-code-akos-on-a-server) and [running from source](reference.md#running-from-source). The [security section of the reference](reference.md#security) covers how the dashboard is protected.
