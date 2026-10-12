# Changelog

## Unreleased

- Triage no longer says the resolver will skip permission, configuration or network errors. The resolver attempts every filed issue, so the suggestion now says to close the GitHub issue to keep it off one.
- What the resolver leaves in your repository says FixFlow instead of ErrorResolver: branches are `fixflow/issue-<n>` (was `errorresolver/issue-<n>`), commits are by `FixFlow <fixflow@localhost>`, and the pull request footer names FixFlow. Pull requests already opened keep their old branch.

## 1.0.0

First public release.

- Sentry-compatible error ingest with grouping, so a repeated error is one issue with a count.
- Triage by a model served through Ollama, DeepSeek or Anthropic, or by built-in rules when no provider is set up.
- One GitHub issue per new error with a stack trace.
- A resolver that attempts a fix in a throwaway worktree, runs your check command and opens a pull request. An attempt is capped at 20 model turns, and a failing issue is retried at most 3 times with a growing wait.
- A dashboard over server-sent events, with per-project tokens stored encrypted.
- Release tarball with the UI prebuilt; runs on Node 24+ with `git` on Linux and macOS.
