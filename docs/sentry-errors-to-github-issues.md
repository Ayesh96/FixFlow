---
title: Send Sentry errors to GitHub issues automatically with FixFlow
description: How FixFlow turns errors from Sentry SDKs into GitHub issues: the DSN setup, how errors are grouped, when an issue is filed, what it contains and how counts are updated.
---

# Sentry errors to GitHub issues

FixFlow receives events from a Sentry SDK and opens one GitHub issue per new error group.

## Setup

1. Start FixFlow and open the dashboard link it prints.
2. **Projects → Add project**: enter `owner/name`, a GitHub token and the branch to work on. The token and repository are checked with GitHub before saving.
3. Copy the project's DSN (for example `http://fixflow@localhost:3000/1`) into your app's Sentry SDK `dsn` option.

The token needs to create issues in the repository. A separate token can be set for the resolver, which also needs to push branches and open pull requests.

## How errors are grouped

The fingerprint is the exception type plus the crashing file and line, not the message. An error whose text contains changing ids is still one group. Each group has a count and a first and last seen time.

## When an issue is filed

- Only for errors that carry a stack trace. A bare log line gives little to act on.
- Errors without one are kept on the **Errors** tab. A project setting, *Also file errors without a stack trace on GitHub*, files them too.
- Errors below `ORCH_ERRORS_MIN_LEVEL` (default `error`) are not filed.

## What the issue contains

The title and stack trace, the request method and path when the event has one, the source line, and library frames folded away. Local variables are never put in the issue because the repository may be public. They go to the model only.

## Updating the issue

FixFlow comments on the issue when the event count passes 100, 1,000 and 10,000 (`ORCH_ERRORS_COMMENT_THRESHOLDS`). Labels from `ORCH_ERRORS_GITHUB_LABELS` are applied to new issues, plus `bot-safe` when triage thinks the error looks like a small fix.

## Supported SDK traffic

The `store` and `envelope` endpoints, with gzip, deflate or brotli bodies, and CORS so browser SDKs can post. The test run documented in [Triage test results](TRIAGE-BEFORE-AFTER.md) used a real Sentry SDK against a Python app. Other SDKs should work through the same endpoints but have not been tested here.
