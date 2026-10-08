import type { GitHubIssue } from './types.ts';

const MAX_TITLE_LENGTH = 120;
/** GitHub rejects PR bodies over 65,536 characters. */
const MAX_BODY_LENGTH = 60_000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A fenced block whose fence is longer than any backtick run inside, so payload text can't close it early. */
function fence(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}\n${text}\n${marker}`;
}

export function formatPullRequestTitle(issue: GitHubIssue): string {
  return truncate(`Fix: ${issue.title}`, MAX_TITLE_LENGTH);
}

export function formatVerifyNote(verifyRan: boolean, verified: boolean): string {
  if (!verifyRan) return '_Unverified — no verify command is configured for this repository._';
  return verified
    ? '_Verified — the configured verify command passed after this change._'
    : '_Unverified — the configured verify command still fails after this change. Review carefully before merging._';
}

export function formatPullRequestBody(
  issue: GitHubIssue,
  explanation: string,
  filesChanged: string[],
  verifyRan: boolean,
  verified: boolean,
): string {
  const sections = [
    `Closes #${issue.number}`,
    '### What changed',
    fence(explanation),
    '### Files',
    filesChanged.map((f) => `- \`${f}\``).join('\n'),
    formatVerifyNote(verifyRan, verified),
    '---',
    '_Opened automatically by ErrorResolver from an error-tracker issue. Review before merging._',
  ];
  return truncate(sections.join('\n\n'), MAX_BODY_LENGTH);
}
