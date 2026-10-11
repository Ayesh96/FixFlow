/**
 * Recovers tool calls that qwen2.5-coder writes as plain text in the form `tool_name {"arg": ...}`:
 * the tool name followed directly by its arguments object, with no `name`/`arguments` wrapper.
 * The generic parsers in tool-call-recovery.ts don't recognize that shape, so the call is lost and the
 * fixer reads the text as a final answer. Kept separate from those parsers on purpose: it is only
 * applied when the configured model is qwen2.5-coder.
 */

import { findJsonObjectEnd } from '../tool-call-recovery.ts';

/** Only the qwen2.5-coder family (any size or tag) gets this parser. */
export function isQwenCoderModel(model: string): boolean {
  return /^qwen2\.5-coder(:|$)/i.test(model);
}

/**
 * Pulls `knownName {json object}` calls out of `content`. Only names in `knownNames` count, so
 * prose that happens to put a word before braces is left alone. Returns the calls in order and
 * the text that remains once they are removed.
 */
export function extractNamedToolCalls(
  content: string,
  knownNames: ReadonlySet<string>,
): { calls: { name: string; arguments: string }[]; remainder: string } {
  const calls: { name: string; arguments: string }[] = [];
  const namePattern = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let result = '';
  let cursor = 0;

  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(content)) !== null) {
    const name = match[1] as string;
    const braceAt = match.index + match[0].length - 1;
    if (!knownNames.has(name)) continue;

    const end = findJsonObjectEnd(content, braceAt);
    if (end === null) continue;

    let args: unknown;
    try {
      args = JSON.parse(content.slice(braceAt, end));
    } catch {
      continue;
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) continue;

    calls.push({ name, arguments: JSON.stringify(args) });
    result += content.slice(cursor, match.index);
    cursor = end;
    namePattern.lastIndex = end;
  }

  result += content.slice(cursor);
  return { calls, remainder: result.trim() };
}
