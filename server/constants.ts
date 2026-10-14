/**
 * Fixed limits and timeouts used by more than one module, or that someone tuning the system would look
 * for. Anything an operator sets through the environment lives in that workflow's config.ts instead.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

// Model providers
/** Local inference is slower than a hosted API, so Ollama gets real room before timing out. */
export const LLM_TIMEOUT_MS = { ollama: 2 * MINUTE, deepseek: 90 * SECOND, anthropic: MINUTE } as const;
/** The longest reply a hosted model is asked for. */
export const LLM_MAX_OUTPUT_TOKENS = 4096;
/** Pause before a retry of a rate limit or server error; it grows with each attempt. */
export const LLM_RETRY_DELAY_MS = SECOND;
/** How much of a failed response body goes into an error message. */
export const ERROR_BODY_PREVIEW_CHARS = 300;

/** Ollama's own default window is small enough that a stack trace and the files it names get cut off. */
export const OLLAMA_CONTEXT_TOKENS = 32_768;

// GitHub
export const GITHUB_REQUEST_TIMEOUT_MS = 10 * SECOND;
/** GitHub's largest page. A repo with more branches than this is shown as incomplete, and the user can type the rest. */
export const GITHUB_BRANCH_LIST_SIZE = 100;
/** How many branch names an error message spells out before it stops. */
export const BRANCHES_SHOWN_IN_MESSAGE = 10;
/** Issues the resolver will never act on, so there's no point paging them in. */
export const GITHUB_ISSUES_PAGE_SIZE = 1000;

// Git
export const GIT_NETWORK_TIMEOUT_MS = 2 * MINUTE;
/** How much of a git command's stderr goes into an error message. */
export const GIT_STDERR_PREVIEW_CHARS = 500;

// Resolver
export const VERIFY_TIMEOUT_MS = 5 * MINUTE;
export const VERIFY_OUTPUT_MAX_CHARS = 4000;
/** The default for the most model turns one fix attempt may take (ORCH_RESOLVER_MAX_TURNS). Each turn re-sends the whole history, so this is the cost ceiling per attempt. */
export const AGENT_MAX_TURNS = 20;
/** The resolver's log is moved aside (replacing the previous one) once it passes this, so it cannot grow without end. */
export const RESOLVER_LOG_MAX_BYTES = 5 * 1024 * 1024;
/** How often one issue is attempted before the resolver stops on its own. A person can still run it from the dashboard. */
export const RESOLVER_MAX_ATTEMPTS_PER_ISSUE = 3;
/** The wait after a failed attempt, doubled for each further failure, so an outage does not spend every attempt within minutes. */
export const RESOLVER_RETRY_BACKOFF_MS = 15 * MINUTE;
/** Source files named in the issue that are read for the model up front, saving it the first few tool calls. */
export const AGENT_PREREAD_FILES = 3;
/** Lines either side of the crashing line that a pre-read shows. */
export const AGENT_PREREAD_WINDOW_LINES = 60;
/** A file this short is pre-read whole rather than as a window. */
export const AGENT_PREREAD_WHOLE_FILE_LINES = 250;
/** What one read_file call returns; the rest is cut off so a huge file cannot flood the context. */
export const AGENT_MAX_READ_BYTES = 100_000;
/** Files over this are not opened at all. */
export const AGENT_MAX_FILE_STAT_BYTES = AGENT_MAX_READ_BYTES * 2;
export const AGENT_MAX_LIST_ENTRIES = 500;
export const AGENT_MAX_GREP_FILES = 2000;
export const AGENT_MAX_GREP_MATCHES = 200;
/** Git's conventional limit for a commit subject. */
export const COMMIT_SUBJECT_MAX_CHARS = 72;
/** How much of the model's explanation goes into a pull request. */
export const PR_SUMMARY_MAX_CHARS = 1_000;
/** The floor for ORCH_RESOLVER_POLL_INTERVAL_MS: polling GitHub faster than this only burns the rate limit. */
export const RESOLVER_MIN_POLL_INTERVAL_MS = 30 * SECOND;
export const RESOLVER_DEFAULT_PAGE_SIZE = 50;
export const RESOLVER_MAX_PAGE_SIZE = 200;

// Errors
/** Compressed request size limit; also bounds memory per in-flight request. */
export const INGEST_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Decompressed size limit, to defuse zip bombs. */
export const INGEST_MAX_DECODED_BYTES = 10 * 1024 * 1024;
/** Local variables kept per stack frame, and how much of each value. */
export const EVENT_MAX_VARS = 12;
export const EVENT_MAX_VAR_CHARS = 120;
/** Stack frames shown in a GitHub issue body. */
export const ISSUE_BODY_MAX_FRAMES = 40;
/** What the triage model is shown: the innermost frames only, and each text clipped. */
export const TRIAGE_MAX_FRAMES = 8;
export const TRIAGE_MAX_TEXT_CHARS = 500;
/** Issues the Errors tab loads. */
export const ERRORS_ISSUE_LIST_LIMIT = 200;
export const ERRORS_PRUNE_INTERVAL_MS = 60 * MINUTE;

// Dashboard
/** Keeps the live-update stream from being closed as idle by proxies. */
export const SSE_HEARTBEAT_MS = 25 * SECOND;

// Titles and bodies written to GitHub
export const MAX_TITLE_LENGTH = 120;
/** GitHub rejects bodies over 65,536 characters. */
export const MAX_BODY_LENGTH = 60_000;

// Dashboard session
export const SESSION_COOKIE_MAX_AGE_MS = 365 * DAY;
