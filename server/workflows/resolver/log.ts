import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RESOLVER_LOG_MAX_BYTES } from '../../constants.ts';
import type { ResolverLogEntry } from '../../types.ts';
import type { RepoRef } from './types.ts';

/** The most of a log the dashboard is sent: the end of it, where the latest attempt is. */
const READ_MAX_BYTES = 512 * 1024;
const PREFIX = '[resolver] ';

/** One file per issue, so concurrent fixes never interleave and one error's whole history is in one place. */
export function logFileFor(logDir: string, repo: RepoRef, issueNumber: number): string | undefined {
  return logDir ? join(logDir, `${repo.owner}-${repo.repo}-issue-${issueNumber}.log`) : undefined;
}

/** Prints a resolver line and, when a log file is set, appends it there too. Logging never throws into the fix. */
export function logLine(logFile: string | undefined, message: string, detail?: unknown): void {
  const text = detail === undefined ? message : `${message} ${JSON.stringify(detail)}`;
  console.log(message, ...(detail === undefined ? [] : [JSON.stringify(detail)]));
  if (!logFile) return;
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    try {
      if (statSync(logFile).size > RESOLVER_LOG_MAX_BYTES) renameSync(logFile, `${logFile}.1`);
    } catch {
      // no log yet
    }
    appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
  } catch {
    // a log that cannot be written must not fail the attempt
  }
}

/** Splits `<time> [resolver] <message> <json detail>` back into its parts; a line it cannot read is kept as plain text. */
export function parseLogLine(line: string): ResolverLogEntry | null {
  if (!line.trim()) return null;
  const space = line.indexOf(' ');
  const at = line.slice(0, space);
  if (space < 0 || Number.isNaN(Date.parse(at))) return { at: null, message: line };
  let message = line.slice(space + 1);
  if (message.startsWith(PREFIX)) message = message.slice(PREFIX.length);
  // The detail is the JSON object at the end. A message can itself contain " {", so take the first split that parses.
  for (let i = message.indexOf(' {'); i >= 0; i = message.indexOf(' {', i + 1)) {
    try {
      const detail = JSON.parse(message.slice(i + 1)) as unknown;
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) return { at, message: message.slice(0, i), detail: detail as Record<string, unknown> };
    } catch {
      // not the start of the detail; keep looking
    }
  }
  return { at, message };
}

/** The log's entries, oldest first; empty when nothing has been written yet. Only the end of a large log is read. */
export async function readLog(logFile: string): Promise<ResolverLogEntry[]> {
  let text: string;
  try {
    const handle = await open(logFile, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, READ_MAX_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      text = buffer.toString('utf8');
      if (size > length) text = text.slice(text.indexOf('\n') + 1); // the first line was cut in half
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => parseLogLine(line) ?? []);
}

/** Removes an issue's log and its rotated copy. */
export async function removeLog(logFile: string): Promise<void> {
  await Promise.all([rm(logFile, { force: true }), rm(`${logFile}.1`, { force: true })]);
}
