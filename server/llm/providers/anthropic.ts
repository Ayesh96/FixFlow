import { HttpChatProvider } from '../http-provider.ts';
import { LlmError, type ChatMessage, type ChatOptions, type ToolCall } from '../types.ts';

export class AnthropicError extends LlmError {
  constructor(status: number, message: string) {
    super('anthropic', status, message);
    this.name = 'AnthropicError';
  }
}

export interface AnthropicProviderOptions {
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
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
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

/** Provider for Anthropic's Messages API. */
export class AnthropicProvider extends HttpChatProvider {
  protected override readonly id = 'anthropic' as const;
  protected override readonly label = 'Anthropic';
  protected override readonly timeoutMs = REQUEST_TIMEOUT_MS;
  private readonly options: AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions) {
    super();
    this.options = options;
  }

  protected override url(): string {
    return `${this.options.apiUrl}/v1/messages`;
  }

  protected override headers(): Record<string, string> {
    return { 'x-api-key': this.options.apiKey, 'anthropic-version': API_VERSION };
  }

  protected override body(messages: ChatMessage[], tools: readonly unknown[], options: ChatOptions): unknown {
    const { system, messages: converted } = toAnthropicMessages(messages);
    return {
      model: this.options.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: converted,
      ...(tools.length > 0 ? { tools: toAnthropicTools(tools) } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
  }

  protected override fail(status: number, message: string): LlmError {
    return new AnthropicError(status, message);
  }

  protected override parse(data: unknown): ChatMessage {
    const content = (data as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) throw this.fail(502, 'Anthropic response is missing content');

    const blocks = content as { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
    const text = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
      .map((b) => ({ id: b.id as string, function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) } }));
    return { role: 'assistant', content: text || null, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
