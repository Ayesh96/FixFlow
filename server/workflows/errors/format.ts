import { ISSUE_BODY_MAX_FRAMES, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from '../../constants.ts';
import { fence, truncate } from '../../shared/text.ts';
import type { ExceptionInfo, NormalizedEvent, StackFrame } from './types.ts';


const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Inline code that cannot be broken out of by hostile input. */
const inline = (text: string): string => `\`${oneLine(text).replaceAll('`', "'").replaceAll('|', '\\|')}\``;

export function formatIssueTitle(event: NormalizedEvent): string {
  const type = event.exceptionType ?? 'Message';
  return truncate(`[Error] ${type}: ${oneLine(event.message) || '(no message)'}`, MAX_TITLE_LENGTH);
}

function formatFrame(frame: StackFrame): string {
  const location = [frame.filename ?? '<unknown>', frame.lineno, frame.colno].filter((p) => p != null).join(':');
  return frame.function ? `    at ${frame.function} (${location})` : `    at ${location}`;
}

/**
 * Newest frame first, like a Node.js stack trace. When the app's own code is in the stack, its frames get their
 * source line and every run of library frames between them folds into one line: the reader wants the app's frames,
 * not twenty lines of web-framework internals. A stack with no app frames is shown whole.
 */
function formatFrames(oldestFirst: StackFrame[]): string[] {
  const frames = oldestFirst.slice().reverse();
  if (!frames.some((f) => f.inApp)) {
    const shown = frames.slice(0, ISSUE_BODY_MAX_FRAMES).map(formatFrame);
    if (frames.length > ISSUE_BODY_MAX_FRAMES) shown.push(`    … ${frames.length - ISSUE_BODY_MAX_FRAMES} more frames`);
    return shown;
  }
  const lines: string[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden > 0) lines.push(`    … ${hidden} library ${hidden === 1 ? 'frame' : 'frames'}`);
    hidden = 0;
  };
  for (const frame of frames) {
    if (!frame.inApp) {
      hidden++;
      continue;
    }
    flush();
    lines.push(formatFrame(frame));
    if (frame.contextLine) lines.push(`        ${oneLine(frame.contextLine)}`);
  }
  flush();
  return lines.slice(0, ISSUE_BODY_MAX_FRAMES * 2);
}

function formatException(exception: ExceptionInfo): string {
  const head = exception.value ? `${exception.type}: ${exception.value}` : exception.type;
  return [head, ...formatFrames(exception.frames)].join('\n');
}

export function formatStackTrace(event: NormalizedEvent): string {
  if (event.exceptions.length === 0) {
    // A message is not a crash, but the stack of the code that logged it says where to start.
    return event.stack.length > 0 ? [`${event.message || '(no message)'} (logged from)`, ...formatFrames(event.stack)].join('\n') : event.message || '(no stack trace)';
  }
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
  if (event.request) rows.push(['Request', `${event.request.method} ${event.request.path}`]);
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
