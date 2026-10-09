import type { NormalizedEvent } from './types.ts';

/** Label put on issues whose fix is expected to be tiny (a few lines) or purely stylistic. */
export const BOT_SAFE_LABEL = 'bot-safe';

const LINT = /\b(eslint|stylelint|prettier|pylint|flake8|ruff|rubocop|golangci-lint|lint(?:ing)?)\b/i;
/** Errors that are almost always fixed by a null check or a missing import. */
const SMALL_FIX = [
  /^Cannot read propert(?:y|ies) of (?:undefined|null)/,
  /^(?:undefined|null) is not an object/,
  /^[\w$.]+ is not defined$/,
  /^[\w$.]+ is not a function$/,
  // The same mistakes, worded the way Python says them.
  /^name '[\w.]+' is not defined$/,
  /^'NoneType' object has no attribute '\w+'$/,
  /^'NoneType' object is not (?:subscriptable|iterable|callable)$/,
  /^cannot access local variable '\w+' where it is not associated with a value$/,
];

/**
 * Heuristic for "a bot can fix this safely": lint findings, or a crash whose message points at a
 * one-line fix and whose stack trace is short enough to name the culprit. It only ever reads the
 * event, so a wrong guess costs a label, never a change to the repo.
 */
export function isBotSafe(event: NormalizedEvent): boolean {
  if (LINT.test(event.message) || LINT.test(event.exceptionType ?? '')) return true;
  const thrown = event.exceptions.at(-1);
  if (!thrown || !thrown.frames.some((f) => f.inApp)) return false;
  return SMALL_FIX.some((pattern) => pattern.test(thrown.value));
}

/**
 * Whether there is code to change at all: a crash that reached the app's own code, or a lint finding.
 * A log line or a failure inside a library is never a small fix, whatever anyone says about it.
 */
export function hasCodeToFix(event: NormalizedEvent): boolean {
  if (LINT.test(event.message) || LINT.test(event.exceptionType ?? '')) return true;
  return event.exceptions.at(-1)?.frames.some((f) => f.inApp) === true;
}
