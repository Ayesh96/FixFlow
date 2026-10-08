import type { ExceptionInfo, NormalizedEvent, StackFrame } from './types.ts';

const MAX_TITLE_LENGTH = 120;
const MAX_FRAMES = 40;
/** GitHub rejects bodies over 65,536 characters. */
const MAX_BODY_LENGTH = 60_000;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Inline code that cannot be broken out of by hostile input. */
const inline = (text: string): string => `\`${oneLine(text).replaceAll('`', "'").replaceAll('|', '\\|')}\``;

/** A fenced block whose fence is longer than any backtick run inside, so payload text can't close it early. */
function fence(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}\n${text}\n${marker}`;
}

export function formatIssueTitle(event: NormalizedEvent): string {
  const type = event.exceptionType ?? 'Message';
  return truncate(`[Error] ${type}: ${oneLine(event.message) || '(no message)'}`, MAX_TITLE_LENGTH);
}

function formatFrame(frame: StackFrame): string {
  const location = [frame.filename ?? '<unknown>', frame.lineno, frame.colno].filter((p) => p != null).join(':');
  return frame.function ? `    at ${frame.function} (${location})` : `    at ${location}`;
}

/** Newest frame first, like a Node.js stack trace. */
function formatException(exception: ExceptionInfo): string {
  const frames = exception.frames.slice().reverse();
  const shown = frames.slice(0, MAX_FRAMES).map(formatFrame);
  if (frames.length > MAX_FRAMES) shown.push(`    … ${frames.length - MAX_FRAMES} more frames`);
  const head = exception.value ? `${exception.type}: ${exception.value}` : exception.type;
  return [head, ...shown].join('\n');
}

export function formatStackTrace(event: NormalizedEvent): string {
  if (event.exceptions.length === 0) return event.message || '(no stack trace)';
  // Sentry orders exceptions oldest first; show the thrown one first, then its causes.
  const [thrown, ...causes] = event.exceptions.slice().reverse();
  return [formatException(thrown as ExceptionInfo), ...causes.map((c) => `Caused by: ${formatException(c)}`)].join('\n\n');
}

export function formatIssueBody(event: NormalizedEvent, fingerprint: string): string {
  const rows: [string, string][] = [
    ['Environment', event.environment ?? 'unknown'],
    ['Platform', event.platform],
    ['Level', event.level],
    ['Occurred At', event.occurredAt],
  ];
  if (event.release) rows.push(['Release', event.release]);
  if (event.serverName) rows.push(['Server', event.serverName]);
  if (event.culprit) rows.push(['Culprit', event.culprit]);
  rows.push(['Event ID', event.eventId], ['Fingerprint', fingerprint.slice(0, 12)]);

  const tags = Object.entries(event.tags);
  const sections = [
    '## Error report',
    ['| | |', '|---|---|', ...rows.map(([k, v]) => `| **${k}** | ${inline(v)} |`)].join('\n'),
    '### Message',
    fence(event.message || '(no message)'),
    '### Stack trace',
    fence(formatStackTrace(event)),
  ];
  if (tags.length > 0) {
    sections.push('### Tags', tags.map(([k, v]) => `- ${inline(k)}: ${inline(v)}`).join('\n'));
  }
  sections.push('---', '_Opened automatically. Further occurrences of this error are counted, not reported as new issues._');

  return truncate(sections.join('\n\n'), MAX_BODY_LENGTH);
}

export function formatThresholdComment(count: number, lastSeen: string): string {
  return `This error has now occurred **${count.toLocaleString('en-US')}** times (last seen ${lastSeen}).`;
}
