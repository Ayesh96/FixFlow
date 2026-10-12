---
title: "FixFlow vs Sentry, GlitchTip and Bugsink"
description: "A lightweight self-hosted Sentry alternative that opens fix pull requests. What it replaces, what it lacks, and a comparison with Sentry, GlitchTip and Bugsink."
---

# A lightweight Sentry alternative

FixFlow takes events from Sentry SDKs, so switching is a DSN change. It covers the error-tracking slice of Sentry and adds automated fix attempts. It is not a full Sentry replacement.

## Covered

- Ingest (`store`, `envelope`; gzip, deflate, brotli; CORS) and grouping, including the SDK's `fingerprint` override.
- One GitHub issue per new group, with a comment at 100, 1,000 and 10,000 events.
- Fix attempts opened as pull requests.

## Not covered

- Performance tracing, profiling, session replay, cron and uptime monitoring.
- Alert rules and notifications other than the GitHub issue itself.
- Search, charts, release health, and source map processing (browser stacks must arrive already readable).
- Users, teams and roles: one dashboard token, meant for one person.

## Comparison

Facts about other tools are from their own docs and repositories, checked in October 2026.

| | FixFlow | Sentry | GlitchTip | Bugsink |
|---|---|---|---|---|
| Self-hosted footprint | 1 Node process, SQLite | Docker Compose, 53 services incl. Kafka, ClickHouse, PostgreSQL, Redis; 4 cores, 16 GB RAM + 16 GB swap minimum | 1 service + PostgreSQL, Valkey optional; 256 MB RAM minimum | 1 container; SQLite, MySQL or PostgreSQL |
| GitHub issues | Created automatically | Manually (Team); from alert rules (Business and up) | Not in its docs | Not in its docs |
| Fix pull requests | Your model | Seer, paid plans, $40 per active contributor per month | No | No |
| Alerts | No | Yes | Email, webhooks | Slack, Discord, Teams, Mattermost, Telegram, webhooks |
| Tracing, replay | No | Yes | Not in its docs | Not in its docs |
| Multi-user | No | Yes | Yes | Yes |
| License | FSL-1.1-ALv2 | FSL-1.1-Apache-2.0 | MIT | Custom |

## Which to pick

- Tracing, replay or alert rules: Sentry.
- A multi-user error tracker on small hardware, without automated fixes: GlitchTip or Bugsink.
- One maintainer who wants errors to become reviewable pull requests on their own hardware: FixFlow.

Start with the [quick start](index.md#quick-start).
