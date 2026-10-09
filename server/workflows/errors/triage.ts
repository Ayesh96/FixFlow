import { isBotSafe } from './botsafe.ts';
import { TRIAGE_TAGS, type ExceptionInfo, type NormalizedEvent, type TriageResult, type TriageTag } from './types.ts';

/** Reads an error and says what it is, what to do about it, and which tags apply. Never throws. */
export type Triager = (event: NormalizedEvent) => Promise<TriageResult>;

export interface OllamaTriageOptions {
  url: string;
  model: string;
  timeoutMs?: number;
}

const MAX_FRAMES = 8;
const MAX_TEXT = 500;

const TEST_WORDS = /\b(tests?|testing|hello(?: world)?|sentry|ping|sample|dummy|example)\b/i;
const INFRA = /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed? ?out|connection (?:refused|reset)|socket hang up|service unavailable|rate limit(?:ed)?|50[234])\b/i;

const clip = (text: string, max = MAX_TEXT) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The newest frame in the app's own code, else the newest frame at all: where the error was thrown from. */
function culpritOf(thrown: ExceptionInfo | undefined): { text: string; inApp: boolean } | null {
  const frame = thrown?.frames.findLast((f) => f.inApp) ?? thrown?.frames.at(-1);
  if (!frame) return null;
  const where = [frame.filename ?? '?', frame.lineno].filter((part) => part !== null).join(':');
  return { text: frame.function ? `${frame.function} (${where})` : where, inApp: frame.inApp };
}

function describe(event: NormalizedEvent): string {
  const thrown = event.exceptions.at(-1);
  const frames = (thrown?.frames ?? [])
    .slice(-MAX_FRAMES)
    .reverse()
    .map((f) => `  at ${f.function ?? '<anonymous>'} (${f.filename ?? '?'}:${f.lineno ?? '?'})${f.inApp ? ' [app]' : ''}${f.contextLine ? `\n      ${f.contextLine.trim()}` : ''}`);
  return [
    `Error: ${event.exceptionType ?? 'Message'}: ${event.message}`,
    `Level: ${event.level}`,
    `Platform: ${event.platform}`,
    ...(event.environment ? [`Environment: ${event.environment}`] : []),
    ...(event.tags.service ? [`Service: ${event.tags.service}`] : []),
    thrown ? 'Stack (newest first):' : 'No exception and no stack trace: this was sent as a plain message.',
    ...frames,
  ].join('\n');
}

/**
 * The rule-based triage: always available, and the fallback whenever the model is off or fails.
 * Less perceptive than a model, but it always produces a full finding, so no error is left without one.
 */
export function rulesTriage(event: NormalizedEvent): TriageResult {
  const thrown = event.exceptions.at(-1);
  const what = thrown ? `${thrown.type}: ${clip(thrown.value, 160)}` : `“${clip(event.message, 160)}”`;
  const culprit = culpritOf(thrown);
  const result = (tags: TriageTag[], message: string, suggestion: string): TriageResult => ({ message, suggestion, tags, source: 'rules' });

  if (isBotSafe(event)) {
    return result(
      ['bot-safe'],
      `${what}. ${culprit ? `Most likely culprit: ${culprit.text}, in your own code.` : 'This looks like a lint or formatting finding.'} It matches a common small mistake, such as a missing check or import.`,
      'Report it. It looks like a small fix, so the resolver will try it and open a pull request.',
    );
  }

  if (!thrown) {
    const source = `your ${event.platform} app${event.tags.service ? ` (${event.tags.service})` : ''}`;
    if (TEST_WORDS.test(event.message)) {
      return result(
        ['test-event', 'no-stack-trace'],
        `This looks like a test message, not a real failure. ${what} was sent on purpose from ${source} at level “${event.level}”. Nothing threw an exception, so there is no culprit to find.`,
        "Don't report it: this is not a valid issue. It is safe to ignore.",
      );
    }
    return result(
      ['no-stack-trace', 'needs-human'],
      `A “${event.level}” log message with no stack trace: ${what}. Nothing in the code can be pointed at as the cause.`,
      'Report it only if someone recognises it. To make it actionable, send it as an exception so it carries a stack trace.',
    );
  }

  if (thrown.frames.length === 0) {
    return result(['no-stack-trace', 'needs-human'], `${what}. It arrived without a stack trace, so the culprit cannot be located.`, 'Make sure the SDK attaches stack traces (and source maps, for browser code), then wait for the next occurrence.');
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

small_fix: true only if the error can be fixed with a change of about 2-5 lines in one place
(a missing null check, a typo, a missing import, a wrong variable) or if it is a lint/formatting finding.
false if it needs a design change, touches several files, depends on infrastructure or network conditions,
or you cannot tell from the evidence. When unsure, false.

message: 1-2 plain sentences. What this is, why it most likely happened, and who or what is the culprit
(a function and file in the app, a library, the environment or infrastructure, or nobody: it is a test message).
Say so plainly when it looks like a test or noise.

suggestion: one sentence on what to do. Start with "Don't report it" when this is not a valid issue
(a test message, noise, an expected condition).

tags: any of ${TRIAGE_TAGS.filter((t) => t !== 'bot-safe').join(', ')}. Do not include bot-safe; it follows small_fix.`;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? clip(value.trim()) : null);

/** Asks a local Ollama model; any failure (down, slow, malformed) falls back to the rule-based triage. */
export function ollamaTriager({ url, model, timeoutMs = 60_000 }: OllamaTriageOptions): Triager {
  return async (event) => {
    const fallback = rulesTriage(event);
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: describe(event) },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return fallback;
      const reply = (await response.json()) as { message?: { content?: string } };
      const verdict = JSON.parse(reply.message?.content ?? '') as { small_fix?: unknown; message?: unknown; suggestion?: unknown; tags?: unknown };
      if (typeof verdict.small_fix !== 'boolean') return fallback;
      const named = Array.isArray(verdict.tags) ? verdict.tags.filter((t): t is TriageTag => TRIAGE_TAGS.includes(t as TriageTag) && t !== 'bot-safe') : [];
      const tags: TriageTag[] = [...(verdict.small_fix ? (['bot-safe'] as const) : []), ...new Set(named)];
      if (tags.length === 0) tags.push('needs-human');
      // The model decides small_fix and the tags. Wording it leaves out comes from the rules, but only when the rules
      // reached the same verdict; otherwise their text would contradict the model's, so a neutral line stands in.
      const agrees = fallback.tags.includes('bot-safe') === verdict.small_fix;
      const thrown = event.exceptions.at(-1);
      const neutral = thrown ? `${thrown.type}: ${clip(thrown.value, 160)}.` : `“${clip(event.message, 160)}”.`;
      return {
        message: text(verdict.message) ?? (agrees ? fallback.message : neutral),
        suggestion: text(verdict.suggestion) ?? (agrees ? fallback.suggestion : verdict.small_fix ? 'Report it. It looks like a small fix, so the resolver will try it.' : 'Report it, and have a person look first.'),
        tags,
        source: 'model',
      };
    } catch {
      return fallback;
    }
  };
}
