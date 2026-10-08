# Errorflow: glossary

**Project**: a GitHub repo, the branch to work on, and the token(s) used to reach it. Errors and fixes belong to a project. Its id is the number at the end of the DSN.

**Managed clone**: the single bare, shallow copy of a project's repo that Errorflow keeps to fetch from and to make fix worktrees. Never worked in directly.

**Error**: one event an app reports through its Sentry SDK. Events are grouped by a fingerprint (exception type, crashing file and line) into one **issue** with a count.

**Issue**: a group of identical errors. It may also have a **GitHub issue**, opened for errors that carry a stack trace (or for any error, when the project ticks *Also file errors without a stack trace*).

**Triage**: deciding whether an error looks like a small fix. Today its only effect is the `bot-safe` label on the GitHub issue.

**Resolver**: what picks up an open GitHub issue, fetches the project's branch, attempts a fix in a throwaway worktree and opens a pull request against that branch.

**Check command** (a project's verify command): run through a shell before and after a fix. A pull request whose check passed is marked verified; without one, or when it fails, the pull request says it is unverified.

**Attempt**: one go by the resolver at one issue. Its outcome is `PR_OPEN`, `SKIPPED` or `FAILED`.
