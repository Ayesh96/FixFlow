import { OLLAMA_NUM_CTX } from '../config.ts';
import { TOOL_DEFINITIONS } from './agent-tools.ts';
import { extractNamedToolCalls, findJsonObjectEnd, isQwenCoderModel } from './qwen-named-tool-calls.ts';

export class OllamaError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'OllamaError';
  }
}

export interface OllamaClientOptions {
  apiUrl: string;
  model: string;
}

export interface OllamaToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

/** What the fixer needs from a chat client; a seam for tests. */
export interface ChatClient {
  chat(messages: OllamaMessage[], tools: readonly unknown[]): Promise<OllamaMessage>;
}

const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map((tool) => tool.function.name));

/** Local inference is slower than a hosted API; give it real room before timing out. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Ollama expects tool_calls[].function.arguments as an object; we carry it as a JSON string everywhere else (matching the OpenAI-style tool-call convention), so convert it back on the way out. */
function toOllamaMessage(message: OllamaMessage): unknown {
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

function normalizeToolCall(raw: unknown, index: number): OllamaToolCall {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fn = (obj.function && typeof obj.function === 'object' ? obj.function : {}) as Record<string, unknown>;
  const name = typeof fn.name === 'string' ? fn.name : 'unknown';
  const argumentsJson = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
  const id = typeof obj.id === 'string' ? obj.id : `ollama-call-${index}`;
  return { id, function: { name, arguments: argumentsJson } };
}

const TOOL_CALL_TAG = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/**
 * Qwen-family models write tool calls as `<tool_call>{json}</tool_call>` inside their own
 * text (that's this model's actual chat template — see `ollama show qwen2.5-coder:7b
 * --template`); Ollama is supposed to lift these into the structured `tool_calls` field, but
 * doesn't manage it once the model adds any narration around the tags, which it often does.
 * This recovers them directly from content instead of letting a real tool call get misread as
 * a final answer. Malformed tags are dropped silently — one bad tag shouldn't block any
 * tags elsewhere in the same message that parsed fine.
 */
function extractTaggedToolCalls(content: string): { calls: OllamaToolCall[]; remainder: string } {
  const calls: OllamaToolCall[] = [];
  let index = 0;
  const remainder = content
    .replace(TOOL_CALL_TAG, (_match, jsonText: string) => {
      try {
        const parsed = JSON.parse(jsonText) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name === 'string') {
          calls.push({ id: `ollama-tag-${index++}`, function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments ?? {}) } });
        }
      } catch {
        // Not valid JSON inside the tags — skip it, it was noise either way.
      }
      return '';
    })
    .trim();
  return { calls, remainder };
}

/**
 * This model also often skips both the structured tool_calls field and the <tool_call> tags
 * entirely, and just writes a bare `{"name": ..., "arguments": {...}}` object as plain text —
 * the same shape its own tool-call convention uses, just without the wrapper. Recovered the
 * same way as tagged calls: a proper brace-depth scan (not a regex), so it's safe even when
 * `arguments` contains code with braces in it (e.g. an edit_file old_string/new_string).
 */
function extractBareJsonToolCalls(content: string): { calls: OllamaToolCall[]; remainder: string } {
  const calls: OllamaToolCall[] = [];
  let result = '';
  let index = 0;
  let cursor = 0;

  while (cursor < content.length) {
    const braceAt = content.indexOf('{', cursor);
    if (braceAt === -1) {
      result += content.slice(cursor);
      break;
    }
    const end = findJsonObjectEnd(content, braceAt);
    if (end === null) {
      result += content.slice(cursor);
      break;
    }
    const candidate = content.slice(braceAt, end);
    let parsed: { name?: unknown; arguments?: unknown } | null = null;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed.name === 'string' && 'arguments' in parsed) {
      calls.push({ id: `ollama-bare-${index++}`, function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments ?? {}) } });
      result += content.slice(cursor, braceAt);
      cursor = end;
    } else {
      // Not a tool call — a plain object the model happened to write. Keep it as-is and move past it.
      result += content.slice(cursor, end);
      cursor = end;
    }
  }

  return { calls, remainder: result.trim() };
}

/** Client for Ollama's native /api/chat. */
export class OllamaClient implements ChatClient {
  private readonly options: OllamaClientOptions;

  constructor(options: OllamaClientOptions) {
    this.options = options;
  }

  async chat(messages: OllamaMessage[], tools: readonly unknown[]): Promise<OllamaMessage> {
    let response: Response;
    try {
      response = await fetch(`${this.options.apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          messages: messages.map(toOllamaMessage),
          tools,
          stream: false,
          options: { num_ctx: OLLAMA_NUM_CTX },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new OllamaError(0, `Ollama request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      const preview = text.length > 300 ? text.slice(0, 300) : text;
      throw new OllamaError(response.status, `Ollama API error: ${preview}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new OllamaError(502, 'Ollama returned a non-JSON response');
    }

    return this.extractMessage(data);
  }

  private extractMessage(data: unknown): OllamaMessage {
    if (typeof data !== 'object' || data === null) {
      throw new OllamaError(502, 'Ollama response is not an object');
    }
    const message = (data as Record<string, unknown>).message;
    if (typeof message !== 'object' || message === null) {
      throw new OllamaError(502, 'Ollama response is missing message');
    }
    const obj = message as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content : null;
    const rawToolCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
    let toolCalls = rawToolCalls.map((raw, i) => normalizeToolCall(raw, i));
    let finalContent = content;

    if (toolCalls.length === 0 && content) {
      const tagged = extractTaggedToolCalls(content);
      const recovered = tagged.calls.length > 0 ? tagged : extractBareJsonToolCalls(content);
      if (recovered.calls.length > 0) {
        toolCalls = recovered.calls;
        finalContent = recovered.remainder.length > 0 ? recovered.remainder : null;
      } else if (isQwenCoderModel(this.options.model)) {
        const named = extractNamedToolCalls(content, KNOWN_TOOL_NAMES);
        if (named.calls.length > 0) {
          toolCalls = named.calls.map((call, i) => ({ id: `ollama-named-${i}`, function: call }));
          finalContent = named.remainder.length > 0 ? named.remainder : null;
        }
      }
    }

    return { role: 'assistant', content: finalContent, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
