import type { Dirent } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const MAX_READ_BYTES = 100_000;
const MAX_FILE_STAT_BYTES = MAX_READ_BYTES * 2;
const MAX_LIST_ENTRIES = 500;
const MAX_GREP_FILES = 2000;
const MAX_GREP_MATCHES = 200;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

export class ToolPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolPathError';
  }
}

/**
 * Resolves `relativePath` against `cwd` and rejects anything that would land outside it —
 * this is the sandbox boundary that replaces the Claude Agent SDK's built-in cwd confinement,
 * since these tools are driven by a model with no such guarantee of its own.
 */
export function resolveInWorkDir(cwd: string, relativePath: string): string {
  const root = resolve(cwd);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new ToolPathError(`path "${relativePath}" escapes the repository root`);
  }
  return target;
}

async function walk(root: string, dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out, limit);
    else if (entry.isFile()) out.push(relative(root, full));
  }
}

export async function readFileTool(cwd: string, path: string): Promise<string> {
  const target = resolveInWorkDir(cwd, path);
  const info = await stat(target);
  if (!info.isFile()) return `${path} is not a file`;
  if (info.size > MAX_FILE_STAT_BYTES) return `(file too large to read: ${info.size} bytes)`;
  const content = await readFile(target, 'utf8');
  return content.length > MAX_READ_BYTES ? `${content.slice(0, MAX_READ_BYTES)}\n...(truncated)` : content;
}

export async function listDirectoryTool(cwd: string, path = '.'): Promise<string> {
  const target = resolveInWorkDir(cwd, path);
  const root = resolve(cwd);
  const out: string[] = [];
  await walk(root, target, out, MAX_LIST_ENTRIES);
  return out.length > 0 ? out.sort().join('\n') : '(no files)';
}

export async function grepTool(cwd: string, pattern: string, path = '.'): Promise<string> {
  const target = resolveInWorkDir(cwd, path);
  const root = resolve(cwd);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return `invalid regular expression: ${pattern}`;
  }

  const files: string[] = [];
  await walk(root, target, files, MAX_GREP_FILES);

  const matches: string[] = [];
  for (const file of files) {
    if (matches.length >= MAX_GREP_MATCHES) break;
    let content: string;
    try {
      content = await readFile(resolve(root, file), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && matches.length < MAX_GREP_MATCHES; i++) {
      const line = lines[i] as string;
      if (regex.test(line)) matches.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  return matches.length > 0 ? matches.join('\n') : '(no matches)';
}

export async function editFileTool(cwd: string, path: string, oldString: string, newString: string): Promise<string> {
  const target = resolveInWorkDir(cwd, path);
  const content = await readFile(target, 'utf8');
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) return `old_string not found in ${path}`;
  if (occurrences > 1) return `old_string appears ${occurrences} times in ${path}; include more surrounding context so it is unique`;
  await writeFile(target, content.replace(oldString, newString), 'utf8');
  return `edited ${path}`;
}

/** OpenAI-compatible function-tool definitions, for the DeepSeek chat completions request. */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the repository. path is relative to the repository root.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files under a directory in the repository, recursively. path defaults to the repository root.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Search file contents for a regular expression, recursively under path (default: repository root). Returns matching lines as file:line: text.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' }, path: { type: 'string' } },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact, unique occurrence of old_string with new_string in a file. Fails if old_string is not found or not unique — include enough surrounding context to make it unique.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
] as const;

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model sent it. */
  arguments: string;
}

/** Runs one tool call and returns its result text — never throws, so a bad call becomes model-visible feedback. */
export async function executeTool(call: ToolCall, cwd: string): Promise<string> {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return `invalid JSON arguments for ${call.name}`;
  }
  const obj = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const str = (key: string): string | undefined => (typeof obj[key] === 'string' ? (obj[key] as string) : undefined);

  try {
    switch (call.name) {
      case 'read_file': {
        const path = str('path');
        return path ? await readFileTool(cwd, path) : 'missing required argument: path';
      }
      case 'list_directory':
        return await listDirectoryTool(cwd, str('path') ?? '.');
      case 'grep': {
        const pattern = str('pattern');
        return pattern ? await grepTool(cwd, pattern, str('path') ?? '.') : 'missing required argument: pattern';
      }
      case 'edit_file': {
        const path = str('path');
        const oldString = str('old_string');
        const newString = str('new_string');
        if (!path || oldString === undefined || newString === undefined) {
          return 'missing required argument(s): path, old_string, new_string';
        }
        return await editFileTool(cwd, path, oldString, newString);
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
