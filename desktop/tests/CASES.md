# Setup wizard test cases

What each case checks, mostly the ways a user can get it wrong. `spec` is the file that covers it.
Rule for every case: a step with a problem must not let the user continue, and the problem must be
said in words next to the field (not colour alone).

## A. Step 1: Basics (`basics-errors.spec.ts`)

| ID | Case | Expected |
|---|---|---|
| A1 | Dashboard port empty | Error under the field; Continue disabled; stepper says "Basics (needs attention)" |
| A2 | Port `0`, `65536`, `-1`, `1.5`, `abc` (each) | Same as A1 |
| A3 | Port held by another program (`occupyPort`) | "Another program is using this port…"; Continue disabled |
| A4 | Fix the port after A1–A3 | Error and "needs attention" clear; Continue enabled |
| A5 | Type into the data folder field | Nothing changes (read-only); only "Choose folder…" changes it |
| A6 | Cancel the folder dialog | Field keeps its old value; no error |
| A7 | Continue moves focus to the next step's heading | `document.activeElement` is the step 2 `h1` |

## B. Step 2: Model, Ollama (`model-ollama.spec.ts`)

| ID | Case | Expected |
|---|---|---|
| B1 | No model turned on | "Turn on at least one model…"; Continue disabled |
| B2 | Ollama on, address unreachable (`fake.deadUrl`) | Error naming Ollama; model list disabled; Continue disabled |
| B3 | Ollama reachable, no models (`fake.state.ollama = 'empty'`) | Error with `ollama pull` hint; list disabled; Continue disabled |
| B4 | Ollama answers HTTP 500 (`'error'`) | Error; list disabled; Continue disabled |
| B5 | Address `localhost`, `ftp://x`, empty (each) | "Enter a full URL…"; Continue disabled |
| B6 | Ollama ok | List holds exactly the fake's models (no built-in names), `qwen2.5-coder:7b` preselected; Continue enabled |
| B7 | Change the address after B6 | List resets to disabled until the new test finishes; Continue disabled meanwhile |
| B8 | Turn Ollama off after B2 | Ollama error disappears; B1 error shows instead |
| B9 | Model list never shows options before a successful test | On first load the select is disabled with a placeholder |

## C. Step 2: Model, DeepSeek and Anthropic (`model-hosted.spec.ts`)

Run each case for both providers.

| ID | Case | Expected |
|---|---|---|
| C1 | Turned on, key empty | "Enter your … API key, or turn … off"; model list disabled; Continue disabled |
| C2 | Wrong key | "… rejected this key…"; list stays disabled; Continue disabled |
| C3 | Provider unreachable (`launch({ env: { ORCH_DEEPSEEK_API_URL: fake.deadUrl } })`) | "Could not reach…"; Continue disabled |
| C4 | Right key (`GOOD_KEY`) | List holds exactly the fake's models; Continue enabled |
| C5 | Edit the key after C4 | List resets to disabled; Continue disabled until verified again |
| C6 | Slow check (`fake.state.hostedDelayMs = 3000`) | "Checking the key…"; Continue disabled until it answers |
| C7 | Key never visible | Input is `type=password`; the key text appears nowhere else in the page |
| C8 | Two providers verified | Order list appears; Up on the first and Down on the last are disabled; moving changes the order |
| C9 | Turn a broken provider off while another is fine | Its error disappears; Continue enabled |

## D. Step 3: Errors (`basics-errors.spec.ts`)

| ID | Case | Expected |
|---|---|---|
| D1 | No on/off switch | There is no `#errorsEnabled` control; the fields are always shown |
| D2 | Ingest port equal to the dashboard port | "Must differ from the dashboard port"; Continue disabled |
| D3 | Ingest port busy / `0` / `70000` | Error; Continue disabled |
| D4 | "Any machine on the network" | Warning in words; NOT blocking |
| D5 | Retention `-1`, empty, `1.5` | Error; Continue disabled |
| D6 | Comment counts `abc`, `100,,200`, `1`, `100,1` | Error before Continue (the server needs whole numbers of 2 or more) |
| D7 | Generate key | 24 hex characters, readable on screen |
| D8 | GitHub issue choices | Each option names the levels it files (it is a threshold: a level and everything above); "Errors and crashes (error, fatal)" selected |

## E. Step 4: Resolver and saving (`resolver-save.spec.ts`)

Every case that saves must call `chooseDataFolder` with `testInfo.outputPath(...)` and set both ports
with `freePort()`. Never save with the default `~/.fixflow`.

| ID | Case | Expected |
|---|---|---|
| E1 | No on/off switch | There is no `#resolverEnabled` control |
| E2 | Fixes at the same time `0`, empty, `-1` | Error; Save disabled |
| E3 | Attempts per issue `0` | Error; Save disabled |
| E4 | Interval list | Exactly the 5 presets; 5 minutes selected |
| E5 | Back and forward | Values entered on earlier steps are kept |
| E6 | Go back, break the port, return to step 4 | Save disabled; the note names the step to fix |
| E7 | Happy path (Ollama fake) | `.env` holds the chosen ports, folder, model and `ORCH_LLM_PROVIDERS=ollama`; a dashboard window opens |
| E8 | A port another program takes after the page checked it | Caught at Save: the page goes to that step, says so under the field, writes nothing; Save works again after a new port |
| E9 | Double-click Save | One `.env` write and one dashboard window |
| E10 | Close the window without saving | App quits; no `.env` |
| E11 | Launch again after E7 | No setup screen; the dashboard opens directly |

## T. Terminal wizard (`test/setup-wizard.pty.py`)

| ID | Case | Expected |
|---|---|---|
| T1 | Not a terminal (stdin piped) | Exit 1 with a message; nothing written |
| T2 | Ctrl+D midway | "Setup cancelled"; nothing written |
| T3 | `.env` exists, answer No | File unchanged byte for byte |
| T4 | Port `0`, `abc`, busy port | Asked again each time |
| T5 | Ingest port equal to dashboard port | Asked again |
| T6 | No model set up at all | Asked again (a model is required) |
| T7 | Ollama unreachable | Says so; asks again or lets the user turn Ollama off |
| T8 | Wrong hosted key | Asked again; blank skips the provider |
| T9 | Comment counts `1` | Asked again |
| T10 | Error tracking / resolver | Not asked: both are always on |
| T11 | Happy path | `.env` written and accepted by the server's `loadConfig` |

## S. Settings after onboarding (`settings.spec.ts`)

Opened from the app menu (FixFlow › Settings…, ⌘,) once .env exists. Same wizard, filled from .env.

| ID | Case | Expected |
|---|---|---|
| S1 | Open settings after a first save | Window titled "FixFlow settings"; every field shows the saved value (ports, folder, labels, counts, level, interval, retry) |
| S2 | Saved provider | Switch is on, model list loads from real data with the saved model selected; hosted key re-verified automatically |
| S3 | FixFlow's own running ports | Not reported as busy |
| S4 | Save is on every step | Change one field on step 1 and save without walking through the other steps |
| S5 | Save new settings | .env updated, server restarted, the same dashboard window reloads; settings window closes |
| S6 | New settings the server will not start with | Message on the page; old .env restored byte for byte; dashboard still works |
| S7 | Break a field while editing | Same blocking rules as onboarding (Save disabled, message under the field) |
| S8 | Stepper | Every step is clickable in settings; in onboarding only steps already reached |
| S9 | Window size and position | Remembered across launches (setup and dashboard separately) |

