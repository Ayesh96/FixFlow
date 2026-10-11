---
title: A lightweight Sentry alternative that files issues and proposes fixes
description: What FixFlow replaces in a Sentry setup, what it does not, and how it compares with Sentry, GlitchTip and Bugsink for a small self-hosted project.
---

# A lightweight Sentry alternative

FixFlow accepts events from Sentry SDKs, so you switch by changing the DSN. It is not a full Sentry replacement. This page says where it fits.

## What it replaces

- Receiving and grouping exceptions from your app.
- Filing one GitHub issue per new error, with the stack trace and a count that updates by comment.
- Attempting a fix and opening a pull request.

## What it does not replace

- Performance tracing, profiling and session replay.
- Alert rules, notifications and on-call routing.
- Release health and source map management beyond what the SDK sends.
- Users, teams and roles. FixFlow has one secret token and is meant for one person on one machine.

## Compared with other self-hosted trackers

| | FixFlow | Sentry self-hosted | GlitchTip | Bugsink |
|---|---|---|---|---|
| Takes Sentry SDK events | Yes | Yes | Yes | Yes |
| Footprint | One Node process | Several services | Several services (database, workers) | Single app |
| Opens fix pull requests | Yes, with your model | Seer, a paid Sentry feature | No | No |
| Multi-user | No | Yes | Yes | Yes |
| Scope | Errors only | Errors, tracing, replay and more | Errors, uptime, some performance | Errors only |

The rows for GlitchTip and Bugsink come from their public descriptions. Check their documentation for the current state.

## When to pick which

- You need a team, alerting or tracing: use Sentry or GlitchTip.
- You want a small, low-maintenance tracker with several users: Bugsink or GlitchTip.
- You have a small project, one maintainer, and want errors turned into reviewable pull requests on your own machine: FixFlow.

Start with the [quick start](index.md#quick-start).
