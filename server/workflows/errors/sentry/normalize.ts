import { randomUUID } from 'node:crypto';
import { PayloadError } from '../../../errors.ts';
import { LEVELS, type ExceptionInfo, type Level, type NormalizedEvent, type StackFrame } from '../types.ts';
import { asNumber, asString, isRecord } from './util.ts';

const LEVEL_ALIASES: Record<string, Level> = { warn: 'warning', critical: 'fatal', log: 'info' };

function parseLevel(value: unknown): Level {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  return LEVELS.find((l) => l === raw) ?? LEVEL_ALIASES[raw] ?? 'error';
}

/** Sentry sends either epoch seconds (float) or an ISO string. */
function parseTimestamp(value: unknown): string {
  const date =
    typeof value === 'number' ? new Date(value * 1000) : typeof value === 'string' ? new Date(value) : new Date(NaN);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseFrame(value: unknown): StackFrame | null {
  if (!isRecord(value)) return null;
  return {
    filename: asString(value.filename) ?? asString(value.abs_path) ?? asString(value.module),
    function: asString(value.function),
    lineno: asNumber(value.lineno),
    colno: asNumber(value.colno),
    inApp: value.in_app === true,
    contextLine: asString(value.context_line),
  };
}

function parseExceptions(value: unknown): ExceptionInfo[] {
  const values: unknown = Array.isArray(value) ? value : isRecord(value) ? value.values : [];
  if (!Array.isArray(values)) return [];
  return values.filter(isRecord).map((v) => {
    const frames = isRecord(v.stacktrace) && Array.isArray(v.stacktrace.frames) ? v.stacktrace.frames : [];
    return {
      type: asString(v.type) ?? 'Error',
      value: typeof v.value === 'string' ? v.value : '',
      frames: frames.map(parseFrame).filter((f): f is StackFrame => f !== null),
    };
  });
}

/** `message` may be a string or `{formatted, message}`; SDKs also use `logentry`. */
function parseMessage(data: Record<string, unknown>): string {
  for (const candidate of [data.message, data.logentry]) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (isRecord(candidate)) {
      const text = asString(candidate.formatted) ?? asString(candidate.message);
      if (text) return text;
    }
  }
  return '';
}

/** Tags arrive as an object or as a list of `[key, value]` pairs depending on the SDK. */
function parseTags(value: unknown): Record<string, string> {
  const pairs: [unknown, unknown][] = Array.isArray(value)
    ? value.filter((p): p is [unknown, unknown] => Array.isArray(p) && p.length === 2)
    : isRecord(value)
      ? Object.entries(value)
      : [];
  return Object.fromEntries(pairs.filter(([, v]) => v != null).map(([k, v]) => [String(k), String(v)]));
}

export function normalizeEvent(rawJson: string): NormalizedEvent {
  let data: unknown;
  try {
    data = JSON.parse(rawJson);
  } catch {
    throw new PayloadError('Event payload is not valid JSON');
  }
  if (!isRecord(data)) throw new PayloadError('Event payload must be a JSON object');

  const exceptions = parseExceptions(data.exception);
  const primary = exceptions.at(-1);
  const fingerprint = Array.isArray(data.fingerprint) ? data.fingerprint.filter((f) => typeof f === 'string') : [];

  return {
    eventId: asString(data.event_id) ?? randomUUID().replaceAll('-', ''),
    occurredAt: parseTimestamp(data.timestamp),
    platform: asString(data.platform) ?? 'other',
    level: parseLevel(data.level),
    environment: asString(data.environment),
    release: asString(data.release),
    serverName: asString(data.server_name),
    exceptionType: primary?.type ?? null,
    message: primary?.value || parseMessage(data),
    culprit: asString(data.culprit) ?? asString(data.transaction),
    exceptions,
    tags: parseTags(data.tags),
    fingerprint: fingerprint.length > 0 ? fingerprint : null,
    rawJson,
  };
}
