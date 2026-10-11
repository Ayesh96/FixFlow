import { ERROR_BODY_PREVIEW_CHARS, LLM_RETRY_DELAY_MS } from '../constants.ts';
import { LlmError, type ChatClient, type ChatMessage, type ChatOptions, type ProviderId } from './types.ts';


/**
 * The part every HTTP model API shares: one POST, a timeout, errors turned into `LlmError`, JSON parsed.
 * A provider says what its request looks like and how to read the answer, and nothing else.
 */
export abstract class HttpChatProvider implements ChatClient {
  protected abstract readonly id: ProviderId;
  /** The name used in error messages ("Ollama"). */
  protected abstract readonly label: string;
  protected abstract readonly timeoutMs: number;
  /** Extra attempts after a rate limit or a server error. Zero means none. */
  protected readonly maxRetries: number = 0;
  protected readonly retryDelayMs: number = LLM_RETRY_DELAY_MS;

  protected abstract url(): string;
  protected abstract headers(): Record<string, string>;
  protected abstract body(messages: ChatMessage[], tools: readonly unknown[], options: ChatOptions): unknown;
  /** Reads a successful, JSON-parsed answer. Throws `this.fail(502, ...)` when it is not usable. */
  protected abstract parse(data: unknown, tools: readonly unknown[]): ChatMessage;

  async chat(messages: ChatMessage[], tools: readonly unknown[], options: ChatOptions = {}): Promise<ChatMessage> {
    const payload = JSON.stringify(this.body(messages, tools, options));
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const { status, text } = await this.post(payload, timeoutMs);
      if (status >= 200 && status < 300) return this.parse(this.readJson(text), tools);
      if (attempt < this.maxRetries && isTransient(status)) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
        continue;
      }
      throw this.fail(status, `${this.label} API error ${status}: ${text.slice(0, ERROR_BODY_PREVIEW_CHARS)}`);
    }
  }

  /** The error class a provider throws; override to keep a provider-specific subclass. */
  protected fail(status: number, message: string): LlmError {
    return new LlmError(this.id, status, message);
  }

  private async post(payload: string, timeoutMs: number): Promise<{ status: number; text: string }> {
    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers() },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw this.fail(0, `${this.label} request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { status: response.status, text: await response.text() };
  }

  private readJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw this.fail(502, `${this.label} returned a non-JSON response`);
    }
  }
}

/** A rate limit or a server-side failure: worth asking again, unlike a bad key or a bad request. */
function isTransient(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
