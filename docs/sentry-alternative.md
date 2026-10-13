---
title: "Self-hosted Sentry alternatives compared"
description: "Compare self-hosted Sentry alternatives: FixFlow, GlitchTip and Bugsink against Sentry on hardware needs, GitHub issues, AI fixes, alerts and licensing."
---

# Self-hosted Sentry alternatives compared

Sentry is the best-known error tracker, and its SDKs are the standard way for apps to report errors. But running Sentry yourself is a big job, and its AI fixes cost extra. This page compares the self-hosted alternatives that accept the same Sentry SDKs: FixFlow, GlitchTip and Bugsink. Because all of them speak Sentry's protocol, switching between them is a change of one setting (the DSN), not a rewrite.

## Why look for a Sentry alternative?

**Self-hosted Sentry needs a lot of hardware.** Sentry's own self-hosted package is a Docker Compose stack of 53 services, including Kafka, ClickHouse, PostgreSQL and Redis. Its documented minimum is 4 CPU cores, 16 GB of RAM plus 16 GB of swap. That is a lot for a side project or a small team.

**Sentry's AI fixes are a paid add-on.** Seer, Sentry's AI debugger, finds the cause of an error and can open a fix as a pull request, but it is billed at $40 per active contributor per month on top of a paid plan.

**Turning errors into GitHub issues takes setup.** Sentry creates GitHub issues by hand on the Team plan and from alert rules on the Business plan and above.

If what you need is "tell me when my app breaks, and ideally fix it", a lighter tool can do the job.

## Comparison table

Facts about other tools come from their own documentation and repositories, checked in October 2026.

| | FixFlow | Sentry (self-hosted) | GlitchTip | Bugsink |
|---|---|---|---|---|
| Accepts Sentry SDK events | Yes | Yes | Yes | Yes |
| What you run | A desktop app, or one Node.js process, with SQLite | Docker Compose, 53 services | One service plus PostgreSQL (Valkey optional) | One container with SQLite, MySQL or PostgreSQL |
| Minimum hardware | Any computer that runs the desktop app | 4 cores, 16 GB RAM + 16 GB swap | 256 MB RAM (512 MB recommended) | See its docs |
| Creates GitHub issues | Automatically, one per new error | By hand (Team plan) or from alert rules (Business plan and up) | Not in its docs | Not in its docs |
| Opens fix pull requests | Yes, with the model you choose | With Seer, $40 per active contributor per month | No | No |
| Alerts | No (the GitHub issue is the alert) | Yes | Email, webhooks | Slack, Discord, Teams, Mattermost, Telegram, webhooks |
| Performance tracing, session replay | No | Yes | Not in its docs | Not in its docs |
| Multiple users | No | Yes | Yes | Yes |
| License | FSL-1.1-ALv2 (source-available) | FSL-1.1-Apache-2.0 (source-available) | MIT (open source) | Custom (see its repository) |

## Which one should you pick?

**Choose Sentry** if you need performance tracing, session replay, alert rules, release health or accounts for a whole team, and you are happy to pay for sentry.io or run the full stack yourself.

**Choose GlitchTip** if you want an MIT-licensed, multi-user error tracker that runs on small hardware, with email and webhook alerts. It does not create GitHub issues or fixes.

**Choose Bugsink** if you want a lean, single-container tracker for a team, with chat notifications. It also does not create GitHub issues or fixes.

**Choose FixFlow** if you are one developer or a small team on GitHub and want errors turned into GitHub issues and reviewable pull requests automatically, on your own computer, with a model you pick. That includes a free local model through Ollama, so nothing leaves your machine.

## FixFlow vs Sentry in detail

### What FixFlow covers

- **Receiving errors** from any Sentry SDK through the standard `store` and `envelope` endpoints, including compressed requests (gzip, deflate, brotli) and browser SDKs (CORS).
- **Grouping** repeats of the same error by exception type, crashing file and that line's code. The SDK's `fingerprint` setting is respected. See [how grouping works](sentry-errors-to-github-issues.md#how-errors-are-grouped).
- **GitHub issues**, one per new error group, with follow-up comments at 100, 1,000 and 10,000 occurrences.
- **AI triage** that explains each error and tags it, using a local or hosted model. See [error triage with Ollama](local-llm-error-triage.md).
- **AI fix attempts** opened as pull requests, with your test command run before and after. See [AI bug fixes as pull requests](ai-bug-fix-pull-requests.md).

### What FixFlow does not cover

- Performance tracing, profiling, session replay, cron monitoring and uptime checks.
- Alert rules and notifications other than the GitHub issue itself.
- Charts, release health and source map processing. Browser stack traces must arrive readable, for example from an unminified build.
- Users, teams and roles. FixFlow is built for one person.

## Is FixFlow open source?

Not by the strict definition. FixFlow is **source-available** under the Functional Source License (FSL-1.1-ALv2), the same family of license Sentry uses. In practice:

- You can read, run, change and self-host it for free, including inside a company.
- You cannot use it to sell a competing product or service.
- Every release automatically becomes Apache 2.0, a standard open source license, two years after it is published.

If you need an OSI-approved open source license today, GlitchTip (MIT) is the closest match.

## Switching from Sentry to FixFlow

1. [Install FixFlow](installation.md) and add your GitHub repository as a project.
2. Copy the project's DSN, for example `http://fixflow@localhost:3000/1`.
3. Replace the `dsn` in your app's `Sentry.init(...)` call with it. Nothing else in your code changes.

You can also run both for a while by sending the same errors to Sentry and FixFlow from different environments. The [getting started guide](getting-started.md) has the full setup for Python, Node.js and the browser.
