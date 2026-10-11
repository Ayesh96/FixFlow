/** Cuts `text` to at most `max` characters, ending in an ellipsis when it was cut. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A fenced block whose fence is longer than any backtick run inside, so payload text can't close it early. */
export function fence(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}\n${text}\n${marker}`;
}
