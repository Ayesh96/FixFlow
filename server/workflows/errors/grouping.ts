import { createHash } from 'node:crypto';
import type { NormalizedEvent, StackFrame } from './types.ts';

const DEFAULT_MARKER = '{{ default }}';

/** The frame where the error surfaced: the newest in-app frame, else the newest frame. */
function topFrame(frames: StackFrame[]): StackFrame | undefined {
  return frames.findLast((f) => f.inApp) ?? frames.at(-1);
}

/** Strips origin, query string and content hashes so `app.3f9a8c1b.js?v=2` groups across deploys. */
function normalizePath(path: string): string {
  return path
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')
    .replace(/[?#].*$/, '')
    .replace(/[.-][0-9a-f]{8,}(?=\.)/gi, '');
}

/** Removes the volatile parts of a message (ids, numbers) so "User 42 not found" groups with "User 7 not found". */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .trim()
    .slice(0, 200);
}

/**
 * Default grouping key: exception type + file path of the crashing frame + the frame's
 * source line (or function name when no source is attached). The exception message is
 * deliberately excluded because it usually embeds variable data. Events without any
 * stack frames fall back to the normalized message so unrelated errors don't collapse.
 */
function defaultParts(event: NormalizedEvent): string[] {
  const primary = event.exceptions.at(-1);
  const frame = primary ? topFrame(primary.frames) : undefined;
  const location = frame?.filename ? normalizePath(frame.filename) : (event.culprit ?? '');
  const detail = frame ? (frame.contextLine?.trim() ?? frame.function ?? '') : normalizeMessage(event.message);
  return [primary?.type ?? 'message', location, detail];
}

/**
 * Honors Sentry's client-side `fingerprint` override, including the `{{ default }}`
 * placeholder, which expands to the default grouping key. The project id is part of the
 * hash, so an identical error reported by two projects stays two issues (each in its own repo).
 */
/** What separates two otherwise identical errors: the project (repo) they belong to and the app that raised them. */
export const fingerprintScope = (projectId: string, event: NormalizedEvent): string => `${projectId}/${event.tags.service ?? ''}`;

export function computeFingerprint(event: NormalizedEvent, projectId = ''): string {
  const defaults = JSON.stringify(defaultParts(event));
  const parts = event.fingerprint?.map((p) => (p === DEFAULT_MARKER ? defaults : p)) ?? [defaults];
  return createHash('sha256').update(JSON.stringify([projectId, parts])).digest('hex');
}
