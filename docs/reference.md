---
title: "Code Akos configuration and security reference"
description: "Every Code Akos setting and environment variable, how GitHub tokens are stored, the dashboard and ingest listeners, the security model and the code layout."
---

# Configuration and security reference

This page lists every Code Akos setting and explains how projects, tokens and the two network listeners work. Most people never need it: the setup window covers the common settings. To install Code Akos, see [installation](installation.md).

## What a project is

A **project** is a repository, the **branch** to work on, and the **GitHub token** to do it with. Its ID is the number at the end of the DSN.

- The **branch is the one you give**, not GitHub's default. Errors are filed against it, fixes are based on its latest commit, and pull requests target it.
- Tokens are stored **encrypted** (AES-256-GCM) in `projects.db`, never in `.env`, and are never sent to the browser (only the last 4 characters, to tell tokens apart). The key is `secret.key` (mode 0600), beside it.
- **What that does and does not protect:** a copied database or backup contains no usable token. Someone who can read your user's files can still read the key beside it, so this is the same trust as an SSH private key, not an OS keychain.
- A project can have a separate token for the resolver (pushing a branch and opening a pull request need more access than filing issues). Without one, the main token is used.
- Each project's repository is cloned once, when it is added, into `repos/` as a bare, shallow (`--depth 1`), single-branch clone, and fetched before every fix. One clone serves every branch of a repo.
- **The check command** runs through a shell, in a throwaway copy of the repository, before and after each fix. If it already fails before the fix, the resolver skips the issue; if it fails after, the pull request says it is unverified. It runs as you, on your machine, so only put commands there that you would run yourself.

All of it lives in one data folder, `~/.code-akos` by default (`ORCH_DATA_DIR`).

## Two listeners

One process, two sockets, and the split matters:

| | Dashboard | Error ingest |
|---|---|---|
| Default | `127.0.0.1:7420` | `127.0.0.1:3000` |
| Auth | token cookie + `Host` allow-list + `Origin` check | optional `sentry_key` only |
| CORS | none (same-origin only) | `*` |
| Serves | the UI and the API | the two Sentry endpoints and `/healthz`, nothing else |

Sentry SDKs, browsers included, post cross-origin with no cookie, so none of the dashboard's checks can apply to them. Rather than weaken those checks, ingest gets its own socket with nothing else on it. It still binds loopback by default, so only apps on this machine can report until you set `ORCH_ERRORS_INGEST_HOST=0.0.0.0` (which prints a warning at startup). Set `ORCH_ERRORS_DSN_PUBLIC_KEY` to require a key.

## Security

This server holds your GitHub tokens and can push code, so:

1. It listens on **127.0.0.1 only**, unless you set `ORCH_DASHBOARD_HOST` (the Docker image does; publish it on `127.0.0.1` only).
2. Requests must have a `Host` of `localhost`/`127.0.0.1`/`[::1]` on Code Akos's port (blocks DNS rebinding), and state-changing requests are rejected if `Origin`/`Sec-Fetch-Site` say they came from another site.
3. Every `/api` route needs a **secret token**, kept in `<data folder>/token` (mode `0600`). The link printed at startup exchanges it for an `HttpOnly; SameSite=Strict` cookie. Treat the token file like an SSH key.
4. Strict CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, and `no-store` on API responses.
5. Git and the model's tools use argument arrays. The only shell is your own check command.

## Configuration

Settings live in a `.env` file. The desktop app's setup writes it on first launch, and **Settings** in the dashboard header edits it later. [From source](#running-from-source), the terminal setup does the same; you can also copy `.env.example` to `.env` and edit it, where every variable has a default.

The setup, in the desktop app and in the terminal, differs from a hand-written `.env` in three ways:

- It always turns on error tracking and the resolver. `ORCH_ERRORS_ENABLED=0` and `ORCH_RESOLVER_ENABLED=0` still work when set by hand.
- It requires at least one model, because the resolver needs one.
- It writes only values it has checked: the ports are free, the Ollama address answers, API keys are accepted, and the models are ones the provider lists. Then the server's own config checks run on the result before anything is written.

| Variable | Default | |
|---|---|---|
| `PORT` | `7420` | The dashboard. |
| `ORCH_DATA_DIR` | `~/.code-akos` | Where the token, databases, key and clones live. |
| `ORCH_TOKEN_FILE`, `ORCH_SECRET_KEY_FILE`, `ORCH_PROJECTS_DB`, `ORCH_REPOS_DIR` | inside `ORCH_DATA_DIR` | Move one of those out of the data folder. |
| `ORCH_GITHUB_API_URL` | `https://api.github.com` | For GitHub Enterprise. |
| `ORCH_GITHUB_CLONE_URL` | `https://github.com/{repo}.git` | Where to clone from, with `{repo}` for `owner/name`. |
| `ORCH_OLLAMA_URL` | unset | Address of a local Ollama server, which runs the model for triage and fixes. The resolver always tries Ollama at `http://localhost:11434`; triage uses it only when this is set. |
| `ORCH_OLLAMA_MODEL` | `qwen2.5-coder:7b` | The model Ollama is asked to run. |
| `ORCH_DEEPSEEK_API_KEY` | unset | Turns on DeepSeek as a provider for triage and the resolver. |
| `ORCH_DEEPSEEK_MODEL` | `deepseek-flash` | Or `deepseek-v4-pro`. Thinking mode is always off. |
| `ORCH_DEEPSEEK_API_URL` | `https://api.deepseek.com` | |
| `ORCH_ANTHROPIC_API_KEY` | unset | Turns on Anthropic as a provider for triage and the resolver. |
| `ORCH_ANTHROPIC_MODEL` | `claude-haiku-4-5` | |
| `ORCH_ANTHROPIC_API_URL` | `https://api.anthropic.com` | |
| `ORCH_LLM_PROVIDERS` | `ollama,deepseek,anthropic` | The providers to try, in order, for both triage and the resolver; the first is used and the rest are fallbacks when it fails. A provider that is not set up is skipped by default, and is an error when you name it here. |
| `ORCH_TRIAGE_PROVIDERS` / `ORCH_RESOLVER_PROVIDERS` | `ORCH_LLM_PROVIDERS` | The same, for one purpose only. |

With no provider set up for triage, new errors are triaged by built-in rules. When providers are set up and all of them fail, the rules are not used as a substitute: the error is recorded as `ERRORED` and can be triaged again from the dashboard.

### Errors

| Variable | Default | |
|---|---|---|
| `ORCH_ERRORS_ENABLED` | on | `0` leaves the workflow out. |
| `ORCH_ERRORS_INGEST_PORT` | `3000` | |
| `ORCH_ERRORS_INGEST_HOST` | `127.0.0.1` | |
| `ORCH_ERRORS_DSN_PUBLIC_KEY` | unset | When set, ingest requests must carry this `sentry_key`. |
| `ORCH_ERRORS_PUBLIC_URL` | unset | The address apps use to reach ingest, such as `http://code-akos:3000` for a container on the same Compose network. DSNs are built from it instead of from the host and port. It must be an `http` or `https` address with no path, query or credentials. |
| `ORCH_ERRORS_GITHUB_LABELS` | none | Labels applied to new issues. |
| `ORCH_ERRORS_MIN_LEVEL` | `error` | A threshold: that level and every level above it are filed on GitHub (`error` files `error` and `fatal`; `fatal` files crashes only). The order is `debug`, `info`, `warning`, `error`, `fatal`. Lower levels are still stored and triaged. |
| `ORCH_ERRORS_COMMENT_THRESHOLDS` | `100,1000,10000` | Event counts at which it comments on the GitHub issue. |
| `ORCH_ERRORS_RETENTION_DAYS` | `30` | Raw events older than this are pruned hourly; issue rows and counters stay. `0` keeps everything. |
| `ORCH_ERRORS_DB` | `<data>/errors.db` | |

**What reaches GitHub.** Every error is kept in Code Akos and listed on its project's page. A GitHub issue is opened only for an error that carries a stack trace (a bare log line gives a fixer little to go on), unless the project ticks *Also file errors without a stack trace on GitHub*. Grouping uses the exception type, the crashing file (origin, query string and content hashes stripped) and that frame's source line text, or its function name when the SDK sent no source. The message is not used, so changing IDs in it do not split a group. An event without a stack is grouped by its message with numbers, UUIDs and hex IDs replaced. The SDK's `fingerprint` (including `{{ default }}`) overrides all of this. Groups are per project and per `service` tag.

### Resolver

| Variable | Default | |
|---|---|---|
| `ORCH_RESOLVER_ENABLED` | on | `0` leaves the workflow out. |
| `ORCH_RESOLVER_DB` | `<data>/resolver.db` | |
| `ORCH_RESOLVER_POLL_INTERVAL_MS` | `300000` | Minimum 30000. |
| `ORCH_RESOLVER_MAX_CONCURRENT_FIXES` | `3` | |
| `ORCH_RESOLVER_MAX_TURNS` | `20` | The most model turns one fix attempt may take before it fails with "exceeded the maximum number of turns". |
| `ORCH_RESOLVER_MAX_ATTEMPTS` | `3` | How many failed attempts one issue gets before the resolver stops on its own. A failed attempt waits 15 minutes before the next try, doubling each time. Running an issue from the dashboard ignores the limit. |
| `ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS` | off | Testing aid: re-attempt `SKIPPED` issues each poll. `PR_OPEN` is never retried. |

The resolver attempts every open GitHub issue Code Akos filed for an existing project, whatever its triage tags, unless an earlier attempt opened a pull request or was skipped. A single attempt is capped at `ORCH_RESOLVER_MAX_TURNS` model turns (20 by default). Every turn is also appended to a file per issue, `<data folder>/logs/<owner>-<repo>-issue-<n>.log` (folder set by `ORCH_RESOLVER_LOG_DIR`), and a failed attempt's error names that file. It runs your check command as you, on your machine.

## Running from source

For a headless server, or working on Code Akos itself. Needs Node 24+ and git, on Linux or macOS.

```bash
git clone https://github.com/Ayesh96/code-akos.git && cd code-akos
npm install     # also installs the UI's dependencies
npm start       # builds the UI if it is stale, then serves it
```

The first `npm start` in a terminal runs the same setup as the desktop app and writes `.env`; `npm run setup` changes it later, starting from the current values. `npm start` then prints `http://localhost:7420/?token=…`: open it once, and the token is kept in an HttpOnly cookie. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/healthz` prints `200` when ingest is up.

Each release also has a tarball with the UI prebuilt, so there is no build step: check it against `sha256sums.txt`, unpack it, and run `node bin/code-akos.mjs`.

## Running in Docker

A container image is published at `ghcr.io/ayesh96/code-akos`. Inside the container the dashboard listens on all interfaces (`ORCH_DASHBOARD_HOST=0.0.0.0`), so publish it on `127.0.0.1` only. `ORCH_DASHBOARD_PUBLIC_PORT` adds the published port to the allowed `Host` values when it differs from `PORT`. See [Running in Docker](docker.md).

## Development

```
server/                Express API (TypeScript, run natively by Node)
  app.ts               the dashboard app (loopback, token-checked)
  ingest.ts            the public ingest listener: no cookie, no Origin check, ingest routes only
  projects/            projects, encrypted tokens, repo clones, the GitHub check, and the Projects routes
  workflows/
    errors/            Sentry ingest, grouping, triage, GitHub issues
    resolver/          polls those issues, attempts a fix, opens a PR
web/                   React + Vite + Tailwind v4 + shadcn/ui (Radix). See DESIGN.md
test/                  real git and real SQLite; only GitHub's network API and the paid model are faked
```

The only runtime dependency of the server is `express`; SQLite is Node's built-in `node:sqlite`.

```bash
npm run dev               # API with auto-restart + Vite hot reload on http://localhost:5173
npm test                  # server tests + UI unit tests
npm run typecheck
npm run setup             # the terminal setup; writes .env
python3 test/setup-wizard.pty.py   # drives the terminal setup in a pseudo-terminal; works in scratch copies, never your .env
```

### Desktop app

`desktop/` is an Electron shell for macOS, Windows and Linux. It forks `bin/code-akos.mjs` in Electron's own Node (so the machine needs no Node install), shows the setup as a window on first launch (`desktop/onboarding.html`, the same checks as the terminal setup through `scripts/setup-checks.mjs`), and opens the dashboard in a window. **Settings** in the dashboard header, or Code Akos › Settings… (⌘,), reopens the setup filled in from `.env` (**File › Settings…**, Ctrl+, on Windows and Linux). Saving restarts the server; if it will not start, the previous `.env` is restored and the previous server started again.

```bash
cd desktop
npm install
npm start                 # run from the repo (uses the repo's .env)
npm run dist:mac          # build release/code-akos-<version>-mac-arm64.dmg and -mac-x64.dmg (Intel)
npm run dist:win          # an NSIS .exe installer
npm run dist:linux        # an AppImage
npm run test:e2e          # Playwright against the built macOS app; build first
```

Pushing a `v*` tag builds all three on GitHub Actions and attaches them to the release, unsigned. Only the Apple Silicon build is tested.

The built app looks for a newer release (`desktop/updates.js`) 15 seconds after the dashboard opens and then every 24 hours, using GitHub's latest-release API, and offers this computer's file in a dialog. It installs nothing itself. The automatic check, and a version the user chose to skip, are kept in `update-state.json` in the user-data folder; a run from the repository (`npm start`) never checks on its own.

In the built app, `.env` lives in the app's user-data folder, separate from the repo's and kept across updates: `~/Library/Application Support/Code Akos/.env` on macOS, `%APPDATA%\Code Akos\.env` on Windows, `~/.config/Code Akos/.env` on Linux. The server runs with that folder as its working directory. Builds before 1.1.0 kept it inside the app; the first launch of a newer build copies it over. The macOS build is ad-hoc signed (`mac.identity: "-"`): an Apple Silicon Mac refuses to run an Electron app with no signature at all. It is not notarized, so macOS blocks the first open of a downloaded copy until it is allowed in System Settings › Privacy & Security. Removing that step for users needs a Developer ID certificate and notarization; on Windows, a code-signing certificate.

The end-to-end tests give each test its own APFS clone of the built app, fake Ollama, DeepSeek and Anthropic servers, and a stubbed folder picker, so they never touch `~/.code-akos` or a real API. The cases are listed in `desktop/tests/CASES.md`.

To add another workflow, implement `Workflow` from `server/workflows/types.ts` (`id`, `title`, `routes(router)`, optional `start`/`stop`, and `ingestRoutes(router)` only if it needs unauthenticated outside traffic), switch it on in `server/workflows/index.ts`, and register a panel for its `id` in `web/src/components/extensions.ts`.

[`DESIGN.md`](https://github.com/Ayesh96/code-akos/blob/main/DESIGN.md) documents the tokens, components, accessibility rules and copy conventions.
