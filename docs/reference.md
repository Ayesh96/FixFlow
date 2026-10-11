---
title: FixFlow reference: projects, ports, security and configuration
description: Reference for FixFlow, a self-hosted Sentry-compatible error tracker: how projects and tokens work, the two listeners, security model, every environment variable, and the code layout.
---

# Reference

Projects, ports, security and every setting. For install steps see the [quick start](index.md#quick-start).

## What a project is

A **project** is a repository, the **branch** to work on, and the **GitHub token** to do it with. Its id is the number at the end of the DSN.

- The **branch is the one you give**, not GitHub's default. Errors are filed against it, fixes are based on its latest commit, and pull requests target it.
- Tokens are stored **encrypted** (AES-256-GCM) in `projects.db`, never in `.env`, and are never sent to the browser (only the last 4 characters, to tell tokens apart). The key is `secret.key` (mode 0600), beside it.
- **What that does and does not protect:** a copied database or backup contains no usable token. Someone who can read your user's files can still read the key beside it, so this is the same trust as an SSH private key, not an OS keychain.
- A project can have a separate token for the resolver (pushing a branch and opening a pull request need more access than filing issues). Without one, the main token is used.
- Each project's repository is cloned once, when it is added, into `repos/`, and fetched up to date before every fix. One clone serves every branch of a repo.
- **The check command** runs through a shell, in a throwaway copy of the repository, before and after each fix. If it already fails before the fix, the resolver skips the issue; if it fails after, the pull request says it is unverified. It runs as you, on your machine, so only put commands there that you would run yourself.

All of it lives in one data folder, `~/.fixflow` by default (`ORCH_DATA_DIR`).

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

1. It listens on **127.0.0.1 only**.
2. Requests must have a `Host` of `localhost`/`127.0.0.1`/`[::1]` on our port (blocks DNS rebinding), and state-changing requests are rejected if `Origin`/`Sec-Fetch-Site` say they came from another site.
3. Every `/api` route needs a **secret token**, kept in `<data folder>/token` (mode `0600`). The link printed at startup exchanges it for an `HttpOnly; SameSite=Strict` cookie. Treat the token file like an SSH key.
4. Strict CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, and `no-store` on API responses.
5. Git and the model's tools use argument arrays. The only shell is your own check command.

## Configuration

Everything is optional. Copy `.env.example` to `.env`.

| Variable | Default | |
|---|---|---|
| `PORT` | `7420` | The dashboard. |
| `ORCH_DATA_DIR` | `~/.fixflow` | Where the token, databases, key and clones live. |
| `ORCH_GITHUB_API_URL` | `https://api.github.com` | For GitHub Enterprise. |
| `ORCH_GITHUB_CLONE_URL` | `https://github.com/{repo}.git` | Where to clone from, with `{repo}` for `owner/name`. |
| `ORCH_OLLAMA_URL` | unset | Address of a local Ollama server, which runs the model for triage and fixes. The resolver always tries Ollama at `http://localhost:11434`; triage uses it only when this is set. |
| `ORCH_OLLAMA_MODEL` | `qwen2.5-coder:7b` | The model Ollama is asked to run. |
| `ORCH_DEEPSEEK_API_KEY` | unset | Turns on DeepSeek as a provider for triage and the resolver. |
| `ORCH_DEEPSEEK_MODEL` | `deepseek-flash` | Or `deepseek-v4-pro`. Thinking mode is always off. |
| `ORCH_DEEPSEEK_API_URL` | `https://api.deepseek.com` | |
| `ORCH_ANTHROPIC_API_KEY` | unset | Turns on Anthropic as a provider for triage and the resolver. |
| `ORCH_ANTHROPIC_MODEL` | `claude-haiku-4-5` | |
| `ORCH_LLM_PROVIDERS` | `ollama,deepseek,anthropic` | The providers to try, in order, for both triage and the resolver; the first is used and the rest are fallbacks when it fails. A provider that is not set up is skipped by default, and is an error when you name it here. |
| `ORCH_TRIAGE_PROVIDERS` / `ORCH_RESOLVER_PROVIDERS` | `ORCH_LLM_PROVIDERS` | The same, for one purpose only. |

With no model set up for triage, new errors are triaged by the rule-based heuristic. When models are set up and all of them fail, the error is recorded as ERRORED and can be triaged again.

### Errors

| Variable | Default | |
|---|---|---|
| `ORCH_ERRORS_ENABLED` | on | `0` leaves the workflow out. |
| `ORCH_ERRORS_INGEST_PORT` | `3000` | |
| `ORCH_ERRORS_INGEST_HOST` | `127.0.0.1` | |
| `ORCH_ERRORS_DSN_PUBLIC_KEY` | unset | When set, ingest requests must carry this `sentry_key`. |
| `ORCH_ERRORS_GITHUB_LABELS` | none | Labels applied to new issues. |
| `ORCH_ERRORS_MIN_LEVEL` | `error` | |
| `ORCH_ERRORS_COMMENT_THRESHOLDS` | `100,1000,10000` | Event counts at which it comments on the issue. |
| `ORCH_ERRORS_RETENTION_DAYS` | `30` | Raw events older than this are pruned hourly; issue rows and counters stay. `0` keeps everything. |
| `ORCH_ERRORS_DB` | `<data>/errors.db` | |

**What reaches GitHub.** Every error is kept in the Errors tab. A GitHub issue is opened only for an error that carries a stack trace (a bare log line gives a fixer little to go on), unless the project ticks *Also file errors without a stack trace on GitHub*. Grouping uses the exception type, the crashing file and its line, not the message, so an error with changing ids in its text is still one issue.

### Resolver

| Variable | Default | |
|---|---|---|
| `ORCH_RESOLVER_ENABLED` | on | `0` leaves the workflow out. |
| `ORCH_RESOLVER_DB` | `<data>/resolver.db` | |
| `ORCH_RESOLVER_POLL_INTERVAL_MS` | `300000` | Minimum 30000. |
| `ORCH_RESOLVER_MAX_CONCURRENT_FIXES` | `3` | |
| `ORCH_RESOLVER_MAX_ATTEMPTS` | `3` | How often one issue is attempted before the resolver stops on its own. A failed attempt waits 15 minutes before the next try, doubling each time. Running an issue from the dashboard ignores the limit. |
| `ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS` | off | Testing aid: re-attempt `SKIPPED` issues each poll. `PR_OPEN` is never retried. |

A fix attempt clones a repo, runs a model and may run your check command, so it does real work on your machine as you. A model call costs money, so a single attempt is also capped at 20 turns (`AGENT_MAX_TURNS` in `server/constants.ts`).

## Development

```
server/                Express API (TypeScript, run natively by Node)
  app.ts               the dashboard app (loopback, token-checked)
  ingest.ts            the public ingest listener: no cookie, no Origin check, ingest routes only
  projects/            projects, encrypted tokens, repo clones, the GitHub check, and the Projects routes
  workflows/
    errors/            Sentry ingest, grouping, triage, GitHub issues
    resolver/          polls those issues, attempts a fix, opens a PR
web/                   React + Vite + Tailwind v4 + shadcn/ui (Radix). See [DESIGN.md](https://github.com/Ayesh96/FixFlow/blob/main/DESIGN.md)
test/                  real git and real SQLite; only GitHub's network API and the paid model are faked
```

The only runtime dependency of the server is `express`; SQLite is Node's built-in `node:sqlite`.

```bash
npm run dev               # API with auto-restart + Vite hot reload on http://localhost:5173
npm test                  # server tests + UI unit tests
npm run typecheck
```

To add another workflow, implement `Workflow` from `server/workflows/types.ts` (`id`, `title`, `routes(router)`, optional `start`/`stop`, and `ingestRoutes(router)` only if it needs unauthenticated outside traffic), switch it on in `server/workflows/index.ts`, and register a panel for its `id` in `web/src/components/extensions.ts`.

[`DESIGN.md`](https://github.com/Ayesh96/FixFlow/blob/main/DESIGN.md) documents the tokens, components, accessibility rules and copy conventions.
