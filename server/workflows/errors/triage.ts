import { isBotSafe } from './botsafe.ts';
import type { NormalizedEvent } from './types.ts';

/** Decides whether an event's issue is small enough to label `bot-safe`. Never throws. */
export type Triager = (event: NormalizedEvent) => Promise<boolean>;

export interface OllamaTriageOptions {
  url: string;
  model: string;
  timeoutMs?: number;
}

const MAX_FRAMES = 8;

const SYSTEM_PROMPT = `You triage production errors for a code-fixing bot.
Answer small_fix=true only if the error can be fixed with a change of about 2-5 lines in one place
(a missing null check, a typo, a missing import, a wrong variable) or if it is a lint/formatting finding.
Answer false if it needs a design change, touches several files, depends on infrastructure or network
conditions, or you cannot tell from the evidence. When unsure, answer false.
Reply with JSON only: {"small_fix": boolean, "reason": string}`;

function describe(event: NormalizedEvent): string {
  const thrown = event.exceptions.at(-1);
  const frames = (thrown?.frames ?? [])
    .slice(-MAX_FRAMES)
    .reverse()
    .map((f) => `  at ${f.function ?? '<anonymous>'} (${f.filename ?? '?'}:${f.lineno ?? '?'})${f.inApp ? ' [app]' : ''}${f.contextLine ? `\n      ${f.contextLine.trim()}` : ''}`);
  return [`Error: ${event.exceptionType ?? 'Message'}: ${event.message}`, `Platform: ${event.platform}`, 'Stack (newest first):', ...frames].join('\n');
}

/** Asks a local Ollama model; any failure (down, slow, malformed) falls back to the rule-based heuristic. */
export function ollamaTriager({ url, model, timeoutMs = 60_000 }: OllamaTriageOptions): Triager {
  return async (event) => {
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
      if (!response.ok) return isBotSafe(event);
      const reply = (await response.json()) as { message?: { content?: string } };
      const verdict = JSON.parse(reply.message?.content ?? '') as { small_fix?: unknown };
      return typeof verdict.small_fix === 'boolean' ? verdict.small_fix : isBotSafe(event);
    } catch {
      return isBotSafe(event);
    }
  };
}
