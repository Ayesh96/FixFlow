---
title: Sentry errors to GitHub issues, automatically
description: FixFlow turns Sentry SDK events into GitHub issues: DSN setup, token permissions, grouping, filing rules, issue contents and count comments.
---

# Sentry errors to GitHub issues

FixFlow receives events from any Sentry SDK and opens one GitHub issue per new error group, without a Sentry account.

## Setup

1. Start FixFlow and open the dashboard link it prints.
2. **Projects → Add project**: `owner/name`, a GitHub token and the branch. FixFlow checks the token and repository with GitHub before saving and clones the repository.
3. Set your SDK's `dsn` to the project's DSN, for example `http://fixflow@localhost:3000/1`. The trailing number is the project id.

## Token permissions

For a fine-grained token on the repository:

| Purpose | Permission |
|---|---|
| Clone, open issues, comment | Contents: read, Issues: read and write |
| Resolver: push a branch, open a pull request | Contents: read and write, Pull requests: read and write |

A project can hold a second token used only by the resolver, so the main token does not need write access to code. If the token cannot push, the GitHub check warns that pull requests will fail; issues still work.

## Grouping

Default key: exception type, the crashing frame's file path (origin, query string and content hashes stripped), and that frame's source line text, or its function name when the SDK sent no source. The message is not used, so `User 42 not found` and `User 7 not found` from the same line are one group, and a line-number shift does not split it.

Without a stack, the key is the message with numbers, UUIDs and hex ids replaced. The SDK's `fingerprint`, including `{{ default }}`, overrides the key. Groups are scoped per project and per `service` tag.

## When an issue is filed

- The group is new, and its first event (or a later one) has a stack trace. A project can opt in to filing stack-less errors too.
- The level is at least `ORCH_ERRORS_MIN_LEVEL` (default `error`). Lower levels are stored and triaged but not filed.
- Filing waits for triage, so the `bot-safe` label can be set at creation. If GitHub fails, the next event retries after a minute.

## Issue contents

- Title: `[Error] <Type>: <message>`.
- A table: environment, platform, level, time, release, server, culprit, request method and path, event id, fingerprint.
- The message, and the stack newest frame first: your own frames with their source line, runs of library frames folded to `… N library frames`, and chained causes as `Caused by:`.
- SDK tags.
- Labels: `ORCH_ERRORS_GITHUB_LABELS`, plus `bot-safe` when triage set it.

Local variables and request bodies are never written to the issue.

When the count reaches 100, 1,000 or 10,000 (`ORCH_ERRORS_COMMENT_THRESHOLDS`), FixFlow comments with the count and last-seen time.

## SDK coverage

The endpoints are the standard `/api/<id>/store/` and `/api/<id>/envelope/`, with gzip, deflate or brotli bodies and CORS for browsers. The [triage test run](TRIAGE-BEFORE-AFTER.md) used a real Sentry SDK in a Python app. Other SDKs use the same endpoints but have not been tested here.
