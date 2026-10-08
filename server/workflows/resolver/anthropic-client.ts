import type { ChatClient, OllamaMessage, OllamaToolCall } from './ollama-client.ts';

export class AnthropicError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'AnthropicError';
  }
}

export interface AnthropicClientOptions {
  apiUrl: string;
  apiKey: string;
  model: string;
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 4096;
const API_VERSION = '2023-06-01';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** The agent's OpenAI-style history becomes Anthropic's: system on its own, tool results folded into one user turn. */
export function toAnthropicMessages(messages: OllamaMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content ?? '')
    .join('\n\n');
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const result: Block = { type: 'tool_result', tool_use_id: message.tool_call_id ?? '', content: message.content ?? '' };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(result);
      else out.push({ role: 'user', content: [result] });
    } else if (message.role === 'assistant') {
      const blocks: Block[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) });
      }
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : [{ type: 'text', text: '(no reply)' }] });
    } else {
      out.push({ role: 'user', content: message.content ?? '' });
    }
  }
  return { system, messages: out };
}

function toAnthropicTools(tools: readonly unknown[]): unknown[] {
  return tools.map((tool) => {
    const fn = (tool as { function: { name: string; description?: string; parameters?: unknown } }).function;
    return { name: fn.name, description: fn.description ?? '', input_schema: fn.parameters ?? { type: 'object', properties: {} } };
  });
}

/** Client for Anthropic's Messages API, speaking the same message shape as OllamaClient. */
export class AnthropicClient implements ChatClient {
  private readonly options: AnthropicClientOptions;

  constructor(options: AnthropicClientOptions) {
    this.options = options;
  }

  async chat(messages: OllamaMessage[], tools: readonly unknown[]): Promise<OllamaMessage> {
    const { system, messages: converted } = toAnthropicMessages(messages);
    let response: Response;
    try {
      response = await fetch(`${this.options.apiUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.options.apiKey, 'anthropic-version': API_VERSION },
        body: JSON.stringify({ model: this.options.model, max_tokens: MAX_TOKENS, system, messages: converted, tools: toAnthropicTools(tools) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AnthropicError(0, `Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await response.text();
    if (!response.ok) throw new AnthropicError(response.status, `Anthropic API error ${response.status}: ${text.slice(0, 300)}`);

    let data: { content?: unknown };
    try {
      data = JSON.parse(text) as { content?: unknown };
    } catch {
      throw new AnthropicError(502, 'Anthropic returned a non-JSON response');
    }
    if (!Array.isArray(data.content)) throw new AnthropicError(502, 'Anthropic response is missing content');

    const blocks = data.content as { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
    const content = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    const toolCalls: OllamaToolCall[] = blocks
      .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
      .map((b) => ({ id: b.id as string, function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) } }));
    return { role: 'assistant', content: content || null, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}

/**
 * Uses `primary` until it fails (no network, bad key, rate limit, outage), then finishes the run on `fallback`.
 * The history is the same shape for both, so the fallback simply carries on from the same conversation.
 */
export class FallbackClient implements ChatClient {
  private failed = false;

  private readonly primary: ChatClient;
  private readonly fallback: ChatClient;
  private readonly onFallback: (err: unknown) => void;

  constructor(primary: ChatClient, fallback: ChatClient, onFallback: (err: unknown) => void = () => {}) {
    this.primary = primary;
    this.fallback = fallback;
    this.onFallback = onFallback;
  }

  async chat(messages: OllamaMessage[], tools: readonly unknown[]): Promise<OllamaMessage> {
    if (!this.failed) {
      try {
        return await this.primary.chat(messages, tools);
      } catch (err) {
        this.failed = true;
        this.onFallback(err);
      }
    }
    return this.fallback.chat(messages, tools);
  }
}
