---
title: "Sentry errors to GitHub issues, automatically"
description: "FixFlow opens one GitHub issue per new error from your Sentry SDK, with the stack trace and context. No Sentry account needed. Setup, grouping and contents."
---

# Turn Sentry errors into GitHub issues automatically

If your team already works from GitHub issues, errors belong there too. FixFlow receives errors from your app's Sentry SDK and opens one GitHub issue for each new problem, with the stack trace, the lines of code involved and the context needed to fix it. You do not need a Sentry account, alert rules or a paid plan, and repeats of the same error never create duplicate issues.

## Set it up

1. [Install FixFlow](installation.md).
2. Click **Add project** and enter the repository (`owner/name`), a GitHub token and the branch to work on. FixFlow checks the token and the repository with GitHub before saving.
3. Set your SDK's `dsn` to the project's address, for example `http://fixflow@localhost:3000/1`. The number at the end is the project ID.

The [getting started guide](getting-started.md) shows each step with screenshots and code for Python, Node.js and the browser.

## Token permissions

Use a fine-grained personal access token limited to the repository:

| What FixFlow does | Permissions needed |
|---|---|
| Copy the repository, open issues and comment on them | Contents: read; Issues: read and write |
| Push a fix branch and open a pull request | Contents: read and write; Pull requests: read and write |

A project can have a second token used only for pull requests, so the main token never needs write access to your code. If the token cannot push, FixFlow warns you when you add the project. Issues keep working; only pull requests fail.

## How errors are grouped

The same bug can fire thousands of times, and each occurrence carries slightly different details, such as a user ID in the message. FixFlow groups occurrences into one issue using:

- the **exception type**, such as `TypeError`;
- the **file** where it crashed, ignoring the domain, query string and content hashes in browser file names;
- the **line of code** that crashed, using its text rather than its line number, or the function name when the SDK does not send source code.

The message is deliberately left out. `User 42 not found` and `User 7 not found` from the same line are one issue, and adding a line above the bug does not split it into a new one.

An error without a stack trace is grouped by its message, with numbers, UUIDs and hex IDs blanked out. If your SDK sets a `fingerprint` (including `{{ default }}`), that takes priority. Groups are separate per project and per `service` tag, so two apps never share an issue.

## When an issue is opened

An error group gets a GitHub issue when all of these are true:

- **It is new**, and it has a stack trace. A log line without a stack gives a fixer too little to work with, so by default it is kept in FixFlow only. A project can opt in to filing those too.
- **Its level is high enough.** By default `error` and `fatal` are filed; `warning`, `info` and `debug` are stored and triaged but not filed. You can change this in Settings.
- **Triage has finished**, so the `bot-safe` label can be added when the issue is created.

If GitHub cannot be reached, FixFlow tries again on the next event, at most once a minute.

## What the issue contains

- **Title:** `[Error] <Type>: <message>`, for example `[Error] TypeError: Cannot read properties of null (reading 'id')`.
- **A summary table:** environment, platform, level, time, release, server, culprit, request method and path, event ID and fingerprint.
- **The message and the stack trace**, newest frame first. Frames from your own code include their line of code. Runs of library frames are folded into `… N library frames`, and chained exceptions appear as `Caused by:`.
- **Your SDK's tags.**
- **Labels:** any you set in Settings, plus `bot-safe` when triage considers it a small fix.

Local variables and request bodies are never written to the issue, so personal data in them does not end up on GitHub.

## Follow-up comments

When an error keeps happening, FixFlow comments on its issue at 100, 1,000 and 10,000 occurrences with the count and when it was last seen. You can change these numbers in Settings. That way a rare bug and a bug hitting every user look different in your issue list.

## Which SDKs work

FixFlow implements Sentry's standard endpoints (`/api/<id>/store/` and `/api/<id>/envelope/`), with gzip, deflate or brotli compression and CORS for browsers. The [triage test run](TRIAGE-BEFORE-AFTER.md) used the official Python SDK. Other official Sentry SDKs use the same endpoints and are expected to work, but have not been tested yet. If you try one, please [report how it went](https://github.com/Ayesh96/FixFlow/issues).

## From issue to fix

Every issue FixFlow opens is also picked up by its resolver, which tries to fix it and opens a pull request for you to review. See [AI bug fixes as pull requests](ai-bug-fix-pull-requests.md).
