# Errorflow dashboard: design system

Dark-only, minimalist, Vercel/Supabase-style. Built on **shadcn/ui** (Radix primitives) + **Tailwind v4**.
Components live in `web/src/components/ui/` (shadcn source, owned by this repo); product components in `web/src/components/`.

## 1. Foundations

- **Consistency over creativity.** Everything is a shadcn primitive or a thin composition of one. No bespoke dialogs, selects or switches.
- **Data is the loud part.** Chrome is neutral grayscale; the only saturated pixels are status icons and chart marks.
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
| `--chart-1` | `#3987e5` | sparkline accent (categorical slot 1, dark step) |
| `--chart-muted` | `#898781` | sparkline history, axis/labels ink |
| `--status-running` | `#0ca30c` | icon only |
| `--status-stopped` | `#898781` | icon only |
| `--status-crashed` | `#d03b3b` | icon only |

Type: **Geist Sans** for UI, **Geist Mono** for paths/commands/logs (self-hosted via `@fontsource-variable`, works offline). Scale: 12 / 13 / 14 / 16 / 20 / 28. Big standalone numbers use proportional figures; `tabular-nums` only in table columns.
Spacing: Tailwind 4px scale; page gutter 16 (mobile) / 24; max width 1152px.
Motion: 150ms ease-out for hover/focus; sheet/dialog use shadcn's enter/exit; everything respects `prefers-reduced-motion`.

## 3. Component inventory

| Component | Source | Variants / states | Notes |
|---|---|---|---|
| Button | shadcn | default, outline, ghost, destructive · sm, icon · disabled, loading (spinner + label) | icon buttons always have `aria-label` and a Tooltip |
| Badge | shadcn | outline | container for `StatusBadge` |
| Card | shadcn | - | KPI tile surface |
| Table | shadcn | - | process list; row actions right-aligned |
| Dialog | shadcn | - | Add App wizard |
| AlertDialog | shadcn | - | Delete confirmation (focus lands on the safe action) |
| Sheet (right) | shadcn | - | Log viewer |
| Select, Switch, Input, Label, Checkbox | shadcn | default, focus, invalid (`aria-invalid`), disabled | invalid = red border + message linked by `aria-describedby` |
| Tooltip | shadcn | - | action-button labels, sparkline readout |
| **Open action** | custom | link (has web address) / disabled (none) | an `<a target="_blank" rel="noopener noreferrer">` styled as an icon button; only http(s) is ever rendered, even from a hand-edited plist |
| Sonner | shadcn | success, error | transient results ("Stopped worker") |
| **StatusBadge** | custom | running / stopped / crashed | icon + label; crashed appends the exit reason |
| **Sparkline** | custom | cpu / memory · hover crosshair | see §4 |
| **StatTile** | custom | with / without trend | see §4 |
| **Stepper** | custom | current / done / upcoming | `<ol>`, `aria-current="step"` |
| **KeyValueEditor** | custom | add / remove row | environment variables |
| **Terminal** | custom | live / paused / reconnecting / empty | stderr lines carry a red left rule and a "stderr" marker (not color alone) |

## 4. Data visualization (from the `dataviz` procedure)

**Form.** Headline numbers → **stat tiles** (not charts). Per-process trend → **sparkline** inside the table row. Nothing else needs a chart.

**Color.** One series per sparkline → categorical slot 1 (`#3987e5`). Validator on the card surface: lightness band, chroma floor and ≥3:1 contrast all PASS. History is drawn in muted gray and the latest ~25% of the line plus the end dot in the accent (the tile contract: de-emphasis hue with the current period in accent). CPU and memory sit in separately headed columns, so both use slot 1; hue would add no information.

**Status** (fixed, never reused for series):

| State | Icon | Color (icon only) | Label |
|---|---|---|---|
| running | circle-check | `#0ca30c` | Running |
| stopped | circle-pause | `#898781` | Stopped |
| crashed | triangle-alert | `#d03b3b` | Crashed · exit 3 |

Labels stay in the normal text ink. Text never wears a data color.

**Marks.** Line 2px, round joins; area fill 10% opacity; end dot r = 4 with a 2px ring in the surface color; no axes or gridlines in sparklines (the number beside it is the scale).

**Stat tile contract.** label (sentence case) → value (semibold, proportional figures, auto-compact) → optional trend. Tiles: *Apps* (count), *Running* (count, "of N"), *CPU* (sum, % of one core, sparkline), *Memory* (sum RSS, sparkline).

**Interaction.** Every sparkline has a hover crosshair + tooltip (value and "Ns ago"); hit area is the whole cell. Each sparkline is `role="img"` with an `aria-label` summarizing min/max/now, and the table row already carries the current values as text (the table view).

## 5. Accessibility rules

- Every interactive element reachable and operable by keyboard; visible 2px focus ring.
- Dialogs/Sheet/AlertDialog trap focus, close on Esc, and restore focus (Radix).
- Text ≥ 4.5:1 (`#a3a3a3` on `#171717` = 7.1:1). Status icons ≥ 3:1 and never sole carriers of meaning.
- Live-updating numbers are **not** announced every 2s; a single polite live region announces status *changes* ("ai-worker is now Crashed").
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
