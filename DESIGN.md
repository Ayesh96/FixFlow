# Errorflow dashboard: design system

Dark-only, minimalist, Vercel/Supabase-style. Built on **shadcn/ui** (Radix primitives) + **Tailwind v4**.
Components live in `web/src/components/ui/` (shadcn source, owned by this repo); product components in `web/src/components/`.

## 1. Foundations

- **Consistency over creativity.** Everything is a shadcn primitive or a thin composition of one. No bespoke dialogs, selects or switches.
- **Data is the loud part.** Chrome is neutral grayscale; the only saturated pixels are status icons and chart marks.
- **No pills.** A state is an icon and a word as plain text (`StateLabel`), never a capsule around it. Tags are small square chips (`rounded-sm`). The shadcn `Badge` is removed so a pill can't creep back in.
- **Never color alone.** Status is icon + label (see §4). Verified, not assumed: the validator gives running↔crashed a deutan ΔE of 4.1 (fail), so shape carries the meaning.
- **Dark only.** The app is an ops tool; one theme, fully validated, rather than two half-checked ones.

## 2. Tokens

Neutral base is shadcn's `neutral` dark theme, so every shadcn component renders correctly with no overrides.

| Token | Value | Use |
|---|---|---|
| `--background` | `#0a0a0a` | page |
| `--card` / `--popover` | `#171717` | tiles, table, dialogs, sheet. **The surface every data color is validated against** |
| `--border` | `rgb(255 255 255 / 10%)` | all hairlines |
| `--input` | `#6e6e6e` | field borders (3.4:1 on card; WCAG 1.4.11 needs 3:1) |
| `--foreground` | `#fafafa` | primary text |
| `--muted-foreground` | `#a3a3a3` | secondary text, labels |
| `--primary` | `#e5e5e5` on `#171717` | primary buttons (white-on-dark, Vercel style) |
| `--destructive` | `#e5484d` | delete only |
| `--ring` | `#d4d4d4` | focus ring; shadcn draws it at 50% alpha = 3.9:1 effective on card |
| `--radius` | `0.5rem` | cards 8px, controls 6px |
| `--chart-1` | `#3987e5` | pipeline bars, in-progress icon (categorical slot 1, dark step) |
| `--chart-muted` | `#898781` | muted chart ink |
| `--status-running` | `#0ca30c` | icon only |
| `--status-stopped` | `#898781` | icon only |
| `--status-crashed` | `#d03b3b` | icon only |

Type: **Geist Sans** for UI, **Geist Mono** for paths/commands/logs (self-hosted via `@fontsource-variable`, works offline). Scale: 12 / 13 / 14 / 16 / 20 / 28. Big standalone numbers use proportional figures; `tabular-nums` only in table columns.
Spacing: Tailwind 4px scale; page gutter 16 (mobile) / 24; max width 1152px.
Motion: 150ms ease-out for hover/focus; sheet/dialog use shadcn's enter/exit; everything respects `prefers-reduced-motion`.

## 3. Layout and patterns

| Pattern | Where | Why |
|---|---|---|
| **Full-width canvas** | `App.tsx` | Content spans the screen (cap 2000px, 16/32px gutters) instead of a centred 1152px column. Cards go 1 → 2 → 3 columns at `md` / `2xl`. |
| **Project card** | `ProjectCard.tsx` | The unit of the product, laid out the same way every time so a row of cards reads as a grid. Header: repo (links to its page) and actions on the left and right, then branch; the clone status appears only when it needs attention (Cloning, Failed, Not cloned yet), never as "Ready" on a card. The project page lists it, Ready included, under "How it is set up". Body: the pipeline as large counts. Footer: two equal buttons (setup guide, copy error address), then three equal columns of facts (connection, token, fix check). |
| **Overview strip** | `Overview.tsx` | Above the cards: tracker health, resolver last poll (and poll error), and the pipeline summed across projects. |
| **Counts on the card, errors on the page** | `ProjectCard.tsx`, `ProjectPage.tsx` | A card shows only numbers: the project's pipeline (Tracked → Triaged → Filed → Fix tried → PR Open) as big counts with bars and "% of tracked", a one-line total, and a "View errors" button. It never grows with the number of errors. The errors themselves live on the project's own page at `#/projects/<id>`: back link, header with actions, the full-size pipeline, **every error** (search, state filter, 25 at a time) and how the project is set up. |
| **Hash routing** | `hooks/useProjectRoute.ts` | `#/projects/<id>` opens a project, anything else is the list. No router library or server support; it survives a reload and the back button works. A new page scrolls to the top and moves focus to its title. |
| **Connection status** | `ConnectionStatus.tsx`, `lib/connection.ts` | On each card and project page, in the place the "Connect an app" button used to be: a plain line of text (icon and words) and a guide button. **Connected** means an event has actually arrived (not a setting): "App connected · last event 3m ago", the reporting apps (by their `service` tag) on hover and in the summary line, and a "Setup guide" button that reopens the connect dialog to add another app. Before the first event the same spot reads "No app connected yet" with the "Connect an app" button. State is icon and words, never colour alone. |
| **Connect guide** | `ConnectDialog.tsx`, `lib/snippets.ts` | A "Connect an app" button on each card (and in its empty state) opens a four-step guide: the project's error address, install, init, send a test. Tabs for Python, Node.js and Browser (TypeScript and JavaScript share the code); the snippets are filled in with the project's own address and a service name taken from its repo. A table explains each recommended setting. The test sends an `info` message, so it shows on the card and is read as a test without opening a GitHub issue. |
| **Detail drawer** | `IssueDrawer.tsx` | Right-hand sheet: counts, and a timeline of how far the error got, with links to the issue and PR and the resolver's reason. |
| **Lifecycle track** | `LifecycleTrack.tsx` | Five segments per row filled to the furthest stage; the state word beside it carries the meaning. |
| **Responsive rows** | `ErrorInbox.tsx` | Under `md` the row's columns collapse into a second line (track, state, count, time) instead of a horizontally scrolling table. |
| **Progressive disclosure** | inbox | 25 rows, then "Show N more"; detail only on demand. |
| **Polling, quiet** | `use*` hooks | 5s poll while the tab is visible; the last good data stays on screen if a poll fails. |

**Triage** is stored per error: a status (`PENDING` / `COMPLETED` / `ERRORED`, shown as *Analyzing* / *Triaged* / *Couldn't triage*), a message (what happened, why, and who or what is the culprit), a suggestion (what to do, including "Don't report it"), and tags (`bot-safe`, `needs-human`, `test-event`, `no-stack-trace`, `third-party`, `infrastructure`). It runs for every new error, before and independent of filing; filing only reads the `bot-safe` tag. The drawer shows all of it; each row shows the message as its second line.

Components: shadcn primitives in `components/ui/`; product components in `components/`. Shared pieces to reuse, not copy: `StatusBadge` (resolver states), `Bits` (`When`, `ExternalLink`), `lib/lifecycle.ts` (stage logic and `safeUrl`).

## 4. Data visualization (from the `dataviz` procedure)

**Form.** Counts per stage are a funnel of five ordered magnitudes, so they are **stat tiles with a proportion bar**, not a chart. Per-error progress is the lifecycle track. There are no time-series charts because the server stores first/last seen and a count per error, not a series; do not draw a sparkline from two timestamps.

**Color.** The pipeline bars use one hue, categorical slot 1 (`#3987e5`), over a hairline track. Validator on the card surface: lightness band, chroma floor and ≥3:1 contrast PASS. Stage names and percentages are text, so nothing depends on the hue.

**Resolver status** (one component, `StatusBadge`; shape carries the meaning, color only reinforces it):

| State | Icon | Icon color | Label |
|---|---|---|---|
| Pending | circle-dashed | `--status-stopped` | Pending |
| In Progress | loader (spins; static under reduced motion) | `--chart-1` | In Progress |
| PR Open | git-pull-request | `--status-running` | PR Open |
| Skipped | circle-slash | `--status-stopped` | Skipped |
| Failed | triangle-alert | `--status-crashed` | Failed |

Labels stay in normal text ink. Text never wears a data color. No ad-hoc colors (the earlier `yellow-600` is gone).

**Interaction.** Every row is a real `<button>` with a descriptive `aria-label`; hover and focus share one background; the chevron nudges 2px on hover (disabled under `prefers-reduced-motion`).

## 5. Accessibility rules

- Every interactive element reachable and operable by keyboard; visible 2px focus ring.
- Dialogs/Sheet/AlertDialog trap focus, close on Esc, and restore focus (Radix).
- Text ≥ 4.5:1 (`#a3a3a3` on `#171717` = 7.1:1). Status icons ≥ 3:1 and never sole carriers of meaning.
- Live-updating numbers are **not** announced on every poll; the inbox has one polite live region that announces the filtered count when a filter changes.
- The lifecycle track is `role="img"` with the stage as its label; the drawer timeline is an ordered list with "(done)" / "(not yet)" text for screen readers.
- Wizard: step list is an ordered list; validation errors are announced and focus moves to the first invalid field.

## 6. Copy rules (from the `ux-copy` pass)

- **One term per thing:** *project* (a repository and its branch), *error* (what an app reports), *issue* (on GitHub), *resolver* (what proposes the fix), *triage*. Statuses: *Ready / Cloning / Failed*, *PR Open / Skipped / Failed*.
- **Jargon is translated, then named:** a setting's technical name appears in its helper text so it stays searchable.
- **Errors = what happened + why + how to fix.** Buttons name the action ("Delete app" / "Keep app"), never "OK".
- **Reversible actions don't get confirmations.** Saving settings and retrying a clone just happen (toast confirms). Delete does, because it forgets the project's token and clone.
- All strings live in `web/src/lib/copy.ts` so wording changes in one place.

## 7. Security posture (from the review pass)

The server holds GitHub tokens and can push code, so access is layered:

1. **Loopback only** (`127.0.0.1`), never a network interface.
2. **Host allow-list**: defeats DNS rebinding.
3. **Origin / Sec-Fetch-Site check** on state-changing requests: defeats cross-site forms and fetches.
4. **Secret token**: `<data folder>/token` (mode 0600). `GET /?token=…` exchanges it for an `HttpOnly; SameSite=Strict` cookie; every `/api` route requires it. This is what stops other local users and sandboxed apps, who can all reach loopback.
5. **CSP** (`default-src 'self'`, no inline/eval scripts), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `Cache-Control: no-store` on `/api`.
6. **Argument arrays, not shells**: git and the model's tools use `execFile`; the only shell is a project's own check command, which the user wrote.
7. The data folder (token, databases, key) is created `0700`.
