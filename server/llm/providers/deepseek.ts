import { HttpChatProvider } from '../http-provider.ts';
import { recoverToolCalls, toolNames } from '../tool-call-recovery.ts';
import { LlmError, type ChatMessage, type ChatOptions, type ToolCall } from '../types.ts';

export class DeepSeekError extends LlmError {
  constructor(status: number, message: string) {
    super('deepseek', status, message);
    this.name = 'DeepSeekError';
  }
}

export interface DeepSeekProviderOptions {
  apiUrl: string;
  apiKey: string;
  model: string;
  /** Pause before the single retry of a rate limit or server error. Tests shorten it. */
  retryDelayMs?: number;
}

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_TOKENS = 4096;

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** DeepSeek rejects a history whose tool-call arguments are not a JSON object, so a malformed one is sent as `{}`. */
function jsonObjectText(json: string): string {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return json;
  } catch {
    // fall through
  }
  return '{}';
}

/** Errorflow's history is already OpenAI-shaped; the wire form only adds `type: "function"` to each call. */
function toWireMessage(message: ChatMessage): unknown {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.tool_call_id ?? '', content: message.content ?? '' };
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    const calls: WireToolCall[] = message.tool_calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.function.name, arguments: jsonObjectText(call.function.arguments) },
    }));
    return { role: 'assistant', content: message.content, tool_calls: calls };
  }
  return { role: message.role, content: message.content ?? '' };
}

/** One call from the reply's `tool_calls`, or null when it names no tool (nothing could run it). */
function readToolCall(raw: unknown, index: number): ToolCall | null {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fn = (obj.function && typeof obj.function === 'object' ? obj.function : {}) as Record<string, unknown>;
  if (typeof fn.name !== 'string' || fn.name === '') return null;
  const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
  return { id: typeof obj.id === 'string' && obj.id !== '' ? obj.id : `deepseek-call-${index}`, function: { name: fn.name, arguments: args } };
}

/**
 * Provider for DeepSeek's chat API, which speaks the OpenAI chat-completions protocol.
 *
 * Thinking is switched off on every request. DeepSeek turns it on by default, and with tools in the request
 * it then answers 400 unless each turn's `reasoning_content` is sent back, which the agent loop does not
 * carry. Off, the model also answers faster and cheaper, and `temperature` takes effect.
 */
export class DeepSeekProvider extends HttpChatProvider {
  protected override readonly id = 'deepseek' as const;
  protected override readonly label = 'DeepSeek';
  protected override readonly timeoutMs = REQUEST_TIMEOUT_MS;
  protected override readonly maxRetries = 1;
  protected override readonly retryDelayMs: number;
  private readonly options: DeepSeekProviderOptions;

  constructor(options: DeepSeekProviderOptions) {
    super();
    this.options = options;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  protected override url(): string {
    return `${this.options.apiUrl}/chat/completions`;
  }

  protected override headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.apiKey}` };
  }

  protected override body(messages: ChatMessage[], tools: readonly unknown[], options: ChatOptions): unknown {
    return {
      model: this.options.model,
      messages: messages.map(toWireMessage),
      stream: false,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      ...(tools.length > 0 ? { tools } : {}),
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
  }

  protected override fail(status: number, message: string): LlmError {
    return new DeepSeekError(status, message);
  }

  protected override parse(data: unknown, tools: readonly unknown[]): ChatMessage {
    const choices = (data as { choices?: unknown } | null)?.choices;
    const message = Array.isArray(choices) ? (choices[0] as { message?: unknown } | undefined)?.message : undefined;
    if (typeof message !== 'object' || message === null) throw this.fail(502, 'DeepSeek response is missing choices');

    const obj = message as Record<string, unknown>;
    const content = typeof obj.content === 'string' && obj.content !== '' ? obj.content : null;
    const raw = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
    let toolCalls = raw.map(readToolCall).filter((call): call is ToolCall => call !== null);
    let finalContent = content;

    // Rare, but a call written into the text must not be read as a final answer. Only tools that were
    // offered count, so ordinary JSON in a reply is left alone.
    if (toolCalls.length === 0 && content && tools.length > 0) {
      const recovered = recoverToolCalls(content, 'deepseek', toolNames(tools));
      if (recovered.calls.length > 0) {
        toolCalls = recovered.calls;
        finalContent = recovered.remainder.length > 0 ? recovered.remainder : null;
      }
    }

    return { role: 'assistant', content: finalContent, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
