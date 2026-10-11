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

// GitHub
export const GITHUB_REQUEST_TIMEOUT_MS = 10 * SECOND;

// Git
export const GIT_NETWORK_TIMEOUT_MS = 2 * MINUTE;
/** How much of a git command's stderr goes into an error message. */
export const GIT_STDERR_PREVIEW_CHARS = 500;

// Resolver
export const VERIFY_TIMEOUT_MS = 5 * MINUTE;
export const VERIFY_OUTPUT_MAX_CHARS = 4000;

// Titles and bodies written to GitHub
export const MAX_TITLE_LENGTH = 120;
/** GitHub rejects bodies over 65,536 characters. */
export const MAX_BODY_LENGTH = 60_000;

// Dashboard session
export const SESSION_COOKIE_MAX_AGE_MS = 365 * DAY;
