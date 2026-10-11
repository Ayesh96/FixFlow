import { HttpChatProvider } from '../http-provider.ts';
import { recoverToolCalls, toolNames } from '../tool-call-recovery.ts';
import { LlmError, type ChatMessage, type ChatOptions, type ToolCall } from '../types.ts';
import { extractNamedToolCalls, isQwenCoderModel } from './qwen-named-tool-calls.ts';

export class OllamaError extends LlmError {
  constructor(status: number, message: string) {
    super('ollama', status, message);
    this.name = 'OllamaError';
  }
}

export interface OllamaProviderOptions {
  apiUrl: string;
  model: string;
}

/** Local inference is slower than a hosted API; give it real room before timing out. */
const REQUEST_TIMEOUT_MS = 120_000;
/** Ollama's own default window is small enough that a stack trace and the files it names get cut off. */
const DEFAULT_CONTEXT_TOKENS = 32_768;

/** Ollama expects tool_calls[].function.arguments as an object; inside Errorflow it is a JSON string, so convert it on the way out. */
function toWireMessage(message: ChatMessage): unknown {
  if (!message.tool_calls) return message;
  return {
    ...message,
    tool_calls: message.tool_calls.map((call) => ({
      ...call,
      function: { name: call.function.name, arguments: safeParse(call.function.arguments) },
    })),
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function normalizeToolCall(raw: unknown, index: number): ToolCall {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fn = (obj.function && typeof obj.function === 'object' ? obj.function : {}) as Record<string, unknown>;
  const name = typeof fn.name === 'string' ? fn.name : 'unknown';
  const argumentsJson = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
  const id = typeof obj.id === 'string' ? obj.id : `ollama-call-${index}`;
  return { id, function: { name, arguments: argumentsJson } };
}

/** Provider for Ollama's native /api/chat. */
export class OllamaProvider extends HttpChatProvider {
  protected override readonly id = 'ollama' as const;
  protected override readonly label = 'Ollama';
  protected override readonly timeoutMs = REQUEST_TIMEOUT_MS;
  private readonly options: OllamaProviderOptions;

  constructor(options: OllamaProviderOptions) {
    super();
    this.options = options;
  }

  protected override url(): string {
    return `${this.options.apiUrl}/api/chat`;
  }

  protected override headers(): Record<string, string> {
    return {};
  }

  protected override body(messages: ChatMessage[], tools: readonly unknown[], options: ChatOptions): unknown {
    return {
      model: this.options.model,
      messages: messages.map(toWireMessage),
      ...(tools.length > 0 ? { tools } : {}),
      stream: false,
      ...(options.json ? { format: 'json' } : {}),
      options: {
        num_ctx: options.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    };
  }

  protected override fail(status: number, message: string): LlmError {
    return new OllamaError(status, message);
  }

  protected override parse(data: unknown, tools: readonly unknown[]): ChatMessage {
    if (typeof data !== 'object' || data === null) throw this.fail(502, 'Ollama response is not an object');
    const message = (data as Record<string, unknown>).message;
    if (typeof message !== 'object' || message === null) throw this.fail(502, 'Ollama response is missing message');

    const obj = message as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content : null;
    const rawToolCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
    let toolCalls = rawToolCalls.map((raw, i) => normalizeToolCall(raw, i));
    let finalContent = content;

    // Qwen-family models often skip the structured field and write the call into their text instead.
    if (toolCalls.length === 0 && content) {
      const recovered = recoverToolCalls(content, 'ollama');
      if (recovered.calls.length > 0) {
        toolCalls = recovered.calls;
        finalContent = recovered.remainder.length > 0 ? recovered.remainder : null;
      } else if (isQwenCoderModel(this.options.model)) {
        const named = extractNamedToolCalls(content, toolNames(tools));
        if (named.calls.length > 0) {
          toolCalls = named.calls.map((call, i) => ({ id: `ollama-named-${i}`, function: call }));
          finalContent = named.remainder.length > 0 ? named.remainder : null;
        }
      }
    }

    return { role: 'assistant', content: finalContent, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
