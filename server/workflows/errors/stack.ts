import type { NormalizedEvent, StackFrame } from './types.ts';

/** The frames that say where an event came from: the thrown exception's, else the stack attached to a message. Oldest first. */
export function stackOf(event: NormalizedEvent): StackFrame[] {
  const thrown = event.exceptions.at(-1);
  return thrown && thrown.frames.length > 0 ? thrown.frames : event.stack;
}

export const hasStack = (event: NormalizedEvent): boolean => event.exceptions.some((e) => e.frames.length > 0) || event.stack.length > 0;
