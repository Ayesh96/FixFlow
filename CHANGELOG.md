# Changelog

## 1.1.0

- **Setup.** The first `npm start` (or `node bin/fixflow.mjs`) in a terminal asks for the settings and writes `.env`; `npm run setup` changes them later, starting from the current values. It tests the Ollama address, verifies API keys, offers only the models a provider actually has, checks the ports are free, and runs the result through the server's own config checks before writing. Error tracking and the resolver are always on, and at least one model is required.
- **Desktop app, now the recommended way to install.** Each release attaches a macOS (Apple Silicon) `.dmg`, a Windows `.exe` installer and a Linux AppImage, all unsigned; only the macOS build is tested. The app runs FixFlow without a Node install, shows the setup as a window on first launch, and opens the dashboard in a window. A **Settings** button in the dashboard header reopens the setup; saving restarts FixFlow and puts the old settings back if it will not start. In a browser, the button explains `npm run setup`.
- The GitHub level setting is offered as choices that name what each one files, such as "Errors and crashes (error, fatal)", because it is a threshold.
- The connect guide shows one step per line and wraps the error address instead of scrolling it sideways.
- The release tarball now includes the setup scripts and `npm run setup`.
- The desktop app keeps `.env` in its user-data folder (`~/Library/Application Support/FixFlow` on macOS, `%APPDATA%\FixFlow` on Windows, `~/.config/FixFlow` on Linux) instead of inside the app, which is read-only in an AppImage and replaced on update. A `.env` from an earlier build is copied over on first launch.
- The README and docs site point to the desktop app download; running from source moved to the reference page.
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
