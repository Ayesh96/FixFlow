# Changelog

## 1.0.0

First public release.

- Sentry-compatible error ingest with grouping, so a repeated error is one issue with a count.
- Triage by a local Ollama model, DeepSeek or Anthropic, with a rule-based fallback.
- One GitHub issue per new error with a stack trace.
- A resolver that attempts a fix in a throwaway worktree, runs your check command and opens a pull request. An attempt is capped at 20 model turns, and a failing issue is retried at most 3 times with a growing wait.
- A dashboard over server-sent events, with per-project tokens stored encrypted.
- Release tarball with the UI prebuilt; runs on Node 24+ with `git` on Linux and macOS.
