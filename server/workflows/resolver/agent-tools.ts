import type { Dirent } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AGENT_MAX_FILE_STAT_BYTES, AGENT_MAX_GREP_FILES, AGENT_MAX_GREP_MATCHES, AGENT_MAX_LIST_ENTRIES, AGENT_MAX_READ_BYTES } from '../../constants.ts';

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
    throw new ToolPathError(`path "${relativePath}" is outside the repository root; use a path relative to it`);
  }
  return target;
}

/**
 * Stack traces carry the reporting machine's absolute paths (/Users/me/app/src/x.py), which exist
 * nowhere in the checkout. For an absolute path outside the repository, this finds the longest tail
 * of it that is a real file or directory under the repository and returns that, so the agent can
 * follow a trace without being told to translate it. Anything else comes back unchanged and still
 * goes through the strict sandbox check.
 */
export async function mapToRepoPath(cwd: string, path: string): Promise<string> {
  if (!isAbsolute(path)) return path;
  const root = resolve(cwd);
  if (resolve(path).startsWith(root + sep)) return path;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join(sep);
    try {
      await stat(resolveInWorkDir(cwd, candidate));
      return candidate;
    } catch {
      // not in this checkout; try a shorter tail
    }
  }
  return path;
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

export async function readFileTool(cwd: string, rawPath: string): Promise<string> {
  const path = await mapToRepoPath(cwd, rawPath);
  const target = resolveInWorkDir(cwd, path);
  const info = await stat(target);
  if (!info.isFile()) return `${path} is not a file`;
  if (info.size > AGENT_MAX_FILE_STAT_BYTES) return `(file too large to read: ${info.size} bytes)`;
  const content = await readFile(target, 'utf8');
  return content.length > AGENT_MAX_READ_BYTES ? `${content.slice(0, AGENT_MAX_READ_BYTES)}\n...(truncated)` : content;
}

export async function listDirectoryTool(cwd: string, rawPath = '.'): Promise<string> {
  const path = await mapToRepoPath(cwd, rawPath);
  const target = resolveInWorkDir(cwd, path);
  const root = resolve(cwd);
  const out: string[] = [];
  await walk(root, target, out, AGENT_MAX_LIST_ENTRIES);
  return out.length > 0 ? out.sort().join('\n') : '(no files)';
}

export async function grepTool(cwd: string, pattern: string, rawPath = '.'): Promise<string> {
  const path = await mapToRepoPath(cwd, rawPath);
  const target = resolveInWorkDir(cwd, path);
  const root = resolve(cwd);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return `invalid regular expression: ${pattern}`;
  }

  const files: string[] = [];
  await walk(root, target, files, AGENT_MAX_GREP_FILES);

  const matches: string[] = [];
  for (const file of files) {
    if (matches.length >= AGENT_MAX_GREP_MATCHES) break;
    let content: string;
    try {
      content = await readFile(resolve(root, file), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && matches.length < AGENT_MAX_GREP_MATCHES; i++) {
      const line = lines[i] as string;
      if (regex.test(line)) matches.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  return matches.length > 0 ? matches.join('\n') : '(no matches)';
}

/** What the file actually says near where a failed edit was aimed, so the model can retry with the real text. */
function nearbyLines(content: string, oldString: string): string {
  const lines = content.split('\n');
  const needle = (oldString.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 30);
  const at = needle ? lines.findIndex((l) => l.includes(needle)) : -1;
  const from = at >= 0 ? Math.max(0, at - 3) : 0;
  const shown = lines.slice(from, from + 12).map((l, i) => `${from + i + 1}: ${l}`);
  return `${at >= 0 ? 'Closest match' : 'Start of the file'}:\n${shown.join('\n')}`;
}

export async function editFileTool(cwd: string, rawPath: string, oldString: string, newString: string): Promise<string> {
  const path = await mapToRepoPath(cwd, rawPath);
  const target = resolveInWorkDir(cwd, path);
  const content = await readFile(target, 'utf8');
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) return `old_string not found in ${path}. It must match the file exactly, including whitespace. ${nearbyLines(content, oldString)}`;
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
