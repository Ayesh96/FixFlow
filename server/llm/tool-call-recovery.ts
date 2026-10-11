import type { ToolCall } from './types.ts';

/**
 * Some models write a tool call as text instead of using the API's tool_calls field. These readers
 * pull such calls out of a reply so a real call is not mistaken for a final answer. They are shared by
 * every provider whose model does this; the names a provider passes in keep them from reading ordinary
 * JSON the model happened to write as a call.
 */

const TOOL_CALL_TAG = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export interface Recovered {
  calls: ToolCall[];
  remainder: string;
}

/**
 * `<tool_call>{json}</tool_call>`, the Qwen chat template's own form. Malformed tags are dropped
 * silently: one bad tag should not block tags elsewhere in the same message that parsed fine.
 */
export function extractTaggedToolCalls(content: string, idPrefix: string, known?: ReadonlySet<string>): Recovered {
  const calls: ToolCall[] = [];
  let index = 0;
  const remainder = content
    .replace(TOOL_CALL_TAG, (_match, jsonText: string) => {
      try {
        const parsed = JSON.parse(jsonText) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name === 'string' && (!known || known.has(parsed.name))) {
          calls.push({ id: `${idPrefix}-tag-${index++}`, function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments ?? {}) } });
        }
      } catch {
        // Not valid JSON inside the tags: noise either way.
      }
      return '';
    })
    .trim();
  return { calls, remainder };
}

/**
 * A bare `{"name": ..., "arguments": {...}}` object written as plain text. Found with a brace-depth scan
 * (not a regex), so it is safe when `arguments` holds code with braces in it.
 */
export function extractBareJsonToolCalls(content: string, idPrefix: string, known?: ReadonlySet<string>): Recovered {
  const calls: ToolCall[] = [];
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
    let parsed: { name?: unknown; arguments?: unknown } | null = null;
    try {
      parsed = JSON.parse(content.slice(braceAt, end));
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed.name === 'string' && 'arguments' in parsed && (!known || known.has(parsed.name))) {
      calls.push({ id: `${idPrefix}-bare-${index++}`, function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments ?? {}) } });
      result += content.slice(cursor, braceAt);
    } else {
      result += content.slice(cursor, end); // a plain object the model wrote; keep it and move past it
    }
    cursor = end;
  }

  return { calls, remainder: result.trim() };
}

/** The tagged form first, then the bare one. */
export function recoverToolCalls(content: string, idPrefix: string, known?: ReadonlySet<string>): Recovered {
  const tagged = extractTaggedToolCalls(content, idPrefix, known);
  return tagged.calls.length > 0 ? tagged : extractBareJsonToolCalls(content, idPrefix, known);
}

/** The names of the tools offered in a request (OpenAI-style definitions). */
export function toolNames(tools: readonly unknown[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const tool of tools) {
    const name = (tool as { function?: { name?: unknown } } | null)?.function?.name;
    if (typeof name === 'string') names.add(name);
  }
  return names;
}

/** The index just past the JSON object that starts at `start`, or null when it never closes. */
export function findJsonObjectEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return null;
}
