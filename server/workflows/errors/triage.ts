import { OLLAMA_NUM_CTX } from '../config.ts';
import { hasCodeToFix, isBotSafe } from './botsafe.ts';
import { stackOf } from './stack.ts';
import { TRIAGE_TAGS, type NormalizedEvent, type StackFrame, type TriageResult, type TriageTag } from './types.ts';

/** Reads an error and says what it is, what to do about it, and which tags apply. Throws when it cannot (the error is then recorded as ERRORED). */
export type Triager = (event: NormalizedEvent) => Promise<TriageResult>;

export interface OllamaTriageOptions {
  url: string;
  model: string;
  timeoutMs?: number;
}

const MAX_FRAMES = 8;
const MAX_TEXT = 500;

/** Words that mark a message as one somebody sent on purpose to see it arrive. */
const TEST_WORDS = /\b(tests?|testing|hello world|please ignore|ignore me)\b/i;
/** A message that reports something going wrong is not a test, whatever else it says ("unit test runner crashed"). */
const FAILURE_WORDS = /\b(fail(?:ed|s|ure|ing)?|cannot|can't|could not|couldn't|unable|crash(?:ed|es)?|exception|error|refused|denied|timed? ?out|declined)\b/i;
/** Levels a deliberate test message is sent at. One sent as an error is treated as the real thing: the cost of dismissing a real failure is higher than of reading a test. */
const TEST_LEVELS = new Set(['debug', 'info', 'warning']);
const INFRA = /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed? ?out|connection (?:refused|reset)|socket hang up|service unavailable|rate limit(?:ed)?|50[234])\b/i;
/** The machine or account is not set up to allow this; no code change fixes it. */
const PERMISSION = /\b(not allowed|permission denied|operation not permitted|access denied|assistive access|EACCES|EPERM|unauthori[sz]ed|forbidden)\b/i;

const clip = (text: string, max = MAX_TEXT) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The newest frame in the app's own code, else the newest frame at all: where the error was thrown or logged from. */
function culpritOf(frames: StackFrame[]): { text: string; inApp: boolean } | null {
  const frame = frames.findLast((f) => f.inApp) ?? frames.at(-1);
  if (!frame) return null;
  const where = [frame.filename ?? '?', frame.lineno].filter((part) => part !== null).join(':');
  return { text: frame.function ? `${frame.function} (${where})` : where, inApp: frame.inApp };
}

function describe(event: NormalizedEvent): string {
  const thrown = event.exceptions.at(-1);
  const frames = stackOf(event)
    .slice(-MAX_FRAMES)
    .reverse()
    .flatMap((f) => [
      `  at ${f.function ?? '<anonymous>'} (${f.filename ?? '?'}:${f.lineno ?? '?'})${f.inApp ? ' [app]' : ''}`,
      ...(f.contextLine ? [`      ${f.contextLine.trim()}`] : []),
      ...(f.inApp && f.vars ? [`      locals: ${Object.entries(f.vars).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    ]);
  return [
    `Error: ${event.exceptionType ?? 'Message'}: ${event.message}`,
    `Level: ${event.level}`,
    `Platform: ${event.platform}`,
    ...(event.environment ? [`Environment: ${event.environment}`] : []),
    ...(event.tags.service ? [`Service: ${event.tags.service}`] : []),
    ...(event.request ? [`Request: ${event.request.method} ${event.request.path}`] : []),
    frames.length > 0 ? 'Stack (newest first):' : 'No stack trace: this was sent as a plain message.',
    ...frames,
    ...(thrown || frames.length === 0 ? [] : ['(A message, not a thrown exception: nothing crashed, it was logged on purpose.)']),
  ].join('\n');
}

/**
 * The rule-based triage: always available, and the fallback whenever the model is off or fails.
 * Less perceptive than a model, but it always produces a full finding, so no error is left without one.
 */
export function rulesTriage(event: NormalizedEvent): TriageResult {
  const thrown = event.exceptions.at(-1);
  const stack = stackOf(event);
  const what = thrown ? `${thrown.type}: ${clip(thrown.value, 160)}` : `“${clip(event.message, 160)}”`;
  const culprit = culpritOf(stack);
  const result = (tags: TriageTag[], message: string, suggestion: string): TriageResult => ({ message, suggestion, tags, source: 'rules' });
  const noStack: TriageTag[] = stack.length === 0 ? ['no-stack-trace'] : [];

  if (isBotSafe(event)) {
    return result(
      ['bot-safe'],
      `${what}. ${culprit ? `Most likely culprit: ${culprit.text}, in your own code.` : 'This looks like a lint or formatting finding.'} It matches a common small mistake, such as a missing check or import.`,
      'Report it. It looks like a small fix, so the resolver will try it and open a pull request.',
    );
  }

  if (!thrown) {
    const source = `your ${event.platform} app${event.tags.service ? ` (${event.tags.service})` : ''}`;
    if (TEST_WORDS.test(event.message) && !FAILURE_WORDS.test(event.message) && TEST_LEVELS.has(event.level)) {
      return result(
        ['test-event', ...noStack],
        `This looks like a test message, not a real failure. ${what} was sent on purpose from ${source} at level “${event.level}”. Nothing threw an exception, so there is no culprit to find.`,
        "Don't report it: this is not a valid issue. It is safe to ignore.",
      );
    }
    if (stack.length === 0) {
      return result(
        ['no-stack-trace', 'needs-human'],
        `A “${event.level}” log message with no stack trace: ${what}. Nothing in the code can be pointed at as the cause.`,
        'Report it only if someone recognises it. To make it actionable, send it as an exception so it carries a stack trace.',
      );
    }
    // A message that came with the stack of the code that logged it (an SDK's `attach_stacktrace`).
    const logged = `A “${event.level}” message logged from ${culprit?.text ?? 'your code'}: ${what}. Nothing crashed; the code reported this on purpose, so the place that logged it is the starting point.`;
    if (PERMISSION.test(event.message)) {
      return result(['infrastructure', 'needs-human'], `${logged} The wording points to a permissions or configuration problem in the environment.`, 'Fix the permission or setting it names. A code change is unlikely to help.');
    }
    if (INFRA.test(event.message)) {
      return result(['infrastructure', 'needs-human'], `${logged} It reads like a network or service problem.`, "Check the service or connection it names. A code change is unlikely to help, so the resolver won't be asked to try.");
    }
    return result(['needs-human'], logged, 'Report it, and have a person look first. It is not a clear small fix for the resolver.');
  }

  if (thrown.frames.length === 0) {
    return result(['no-stack-trace', 'needs-human'], `${what}. It arrived without a stack trace, so the culprit cannot be located.`, 'Make sure the SDK attaches stack traces (and source maps, for browser code), then wait for the next occurrence.');
  }

  if (PERMISSION.test(`${thrown.type} ${thrown.value}`)) {
    return result(
      ['infrastructure', 'needs-human'],
      `${what}. This looks like a permissions or configuration problem in the environment rather than a bug in your code${culprit ? `; it surfaced in ${culprit.text}` : ''}.`,
      'Fix the permission or setting it names (for example by granting the access it asks for). A code change is unlikely to help, so the resolver will not be asked to try.',
    );
  }

  if (INFRA.test(`${thrown.type} ${thrown.value}`)) {
    return result(
      ['infrastructure', 'needs-human'],
      `${what}. This looks like a network or service problem rather than a bug in your code${culprit ? `; it surfaced in ${culprit.text}` : ''}.`,
      "Check the service or connection this call depends on. A code change is unlikely to help, so the resolver won't be asked to try.",
    );
  }

  if (culprit && !culprit.inApp) {
    return result(
      ['third-party', 'needs-human'],
      `${what}. The stack never enters your own code; it fails inside a library, at ${culprit.text}.`,
      'Check the library version and how your code calls it. A person should look at this one.',
    );
  }

  return result(['needs-human'], `${what}. Thrown from ${culprit?.text ?? 'your code'}. It is not an obvious small fix.`, 'Report it, and have a person look first. It is not a clear small fix for the resolver.');
}

const SYSTEM_PROMPT = `You triage production errors for a code-fixing bot.
Reply with JSON only: {"small_fix": boolean, "message": string, "suggestion": string, "tags": string[]}

small_fix: true only if the error is a thrown exception that can be fixed with a change of about 2-5 lines in one
place in the app's own code (a missing null check, a typo, a missing import, a wrong variable) or is a lint/formatting finding.
false for log messages, permission or configuration problems, anything that depends on infrastructure or network
conditions, anything that needs a design change or touches several files, or when you cannot tell. When unsure, false.

message: 1-2 plain sentences. What this is, why it most likely happened, and who or what is the culprit
(a function and file in the app, a library, the environment or infrastructure, or nobody: it is a test message).
Use the locals and the request when they are given.

suggestion: one sentence on what to do. Say "Don't report it" ONLY for a test message or pure noise.
A real failure is never "don't report it": if the fix is outside the code (a permission, a setting, a service), say what to fix instead.

tags: any of ${TRIAGE_TAGS.filter((t) => t !== 'bot-safe').join(', ')}. Do not include bot-safe; it follows small_fix.`;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? clip(value.trim()) : null);
const DISMISSES = /^don'?t report it/i;

/**
 * Asks a local Ollama model, and only the model: a failure (down, slow, malformed, no verdict) is thrown, so
 * the error shows as ERRORED and can be triaged again, rather than being answered by the rule-based triage.
 */
export function ollamaTriager({ url, model, timeoutMs = 60_000 }: OllamaTriageOptions): Triager {
  return async (event) => {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: describe(event) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`The triage model answered with HTTP ${response.status}`);
    const reply = (await response.json()) as { message?: { content?: string } };
    let verdict: { small_fix?: unknown; message?: unknown; suggestion?: unknown; tags?: unknown };
    try {
      verdict = JSON.parse(reply.message?.content ?? '');
    } catch {
      throw new Error('The triage model did not answer with JSON');
    }
    if (typeof verdict.small_fix !== 'boolean') throw new Error('The triage model gave no small_fix verdict');

    // The model gives its opinion; these are facts about the event it does not get to overrule.
    const thrown = event.exceptions.at(-1);
    const smallFix = verdict.small_fix && hasCodeToFix(event); // a log line or a library failure is not a small fix
    const named = (Array.isArray(verdict.tags) ? verdict.tags : []).filter((t): t is TriageTag => TRIAGE_TAGS.includes(t as TriageTag) && t !== 'bot-safe');
    const tags = new Set<TriageTag>(named);
    if (thrown) tags.delete('test-event'); // a real exception is not a test
    if (stackOf(event).length === 0) tags.add('no-stack-trace');
    // "Inside a library" is a fact about the stack: it needs a stack, and none of its frames in the app.
    if (stackOf(event).length === 0 || stackOf(event).some((f) => f.inApp)) tags.delete('third-party');
    if (smallFix) tags.delete('needs-human'); // never both "a bot can do this" and "a person must"
    if (!smallFix && !tags.has('test-event') && !tags.has('needs-human')) tags.add('needs-human');
    const finalTags: TriageTag[] = [...(smallFix ? (['bot-safe'] as const) : []), ...tags];

    // Wording the model leaves out is a neutral line about the error, never the rules' opinion of it.
    const neutralWhat = thrown ? `${thrown.type}: ${clip(thrown.value, 160)}.` : `“${clip(event.message, 160)}”.`;
    const neutralNext = smallFix ? 'Report it. It looks like a small fix, so the resolver will try it.' : 'Report it, and have a person look first.';
    let suggestion = text(verdict.suggestion) ?? neutralNext;
    // "Don't report it" is for tests and noise. A model that says it about a real failure is wrong, and the
    // cost of being wrong is a missed bug, so such a suggestion is replaced rather than shown.
    if (DISMISSES.test(suggestion) && !finalTags.includes('test-event')) suggestion = neutralNext;

    return { message: text(verdict.message) ?? neutralWhat, suggestion, tags: finalTags, source: 'model' };
  };
}
