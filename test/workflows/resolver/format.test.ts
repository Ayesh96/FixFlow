import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPullRequestBody, formatPullRequestTitle, formatVerifyNote } from '../../../server/workflows/resolver/format.ts';
import type { GitHubIssue } from '../../../server/workflows/resolver/types.ts';

const issue: GitHubIssue = {
  number: 42,
  title: 'TypeError: Cannot read properties of undefined',
  body: 'stack trace here',
  state: 'open',
  htmlUrl: 'https://github.com/acme/app/issues/42',
};

describe('formatPullRequestTitle', () => {
  it('prefixes the issue title', () => {
    assert.equal(formatPullRequestTitle(issue), 'Fix: TypeError: Cannot read properties of undefined');
  });

  it('truncates very long titles', () => {
    const long = { ...issue, title: 'x'.repeat(200) };
    const title = formatPullRequestTitle(long);
    assert.ok(title.length <= 120);
    assert.ok(title.endsWith('…'));
  });
});

describe('formatVerifyNote', () => {
  it('reports unverified when no verify command ran', () => {
    assert.match(formatVerifyNote(false, false), /Unverified.*no verify command/);
  });
  it('reports verified when the command passed', () => {
    assert.match(formatVerifyNote(true, true), /Verified/);
  });
  it('reports unverified with a warning when the command still fails', () => {
    assert.match(formatVerifyNote(true, false), /Unverified.*still fails/);
  });
});

describe('formatPullRequestBody', () => {
  it('includes a Closes link, the explanation, and changed files', () => {
    const body = formatPullRequestBody(issue, 'Added a null check before accessing .name', ['src/user.ts'], true, true);
    assert.match(body, /Closes #42/);
    assert.match(body, /Added a null check before accessing \.name/);
    assert.match(body, /`src\/user\.ts`/);
    assert.match(body, /Verified/);
  });

  it('widens the fence so explanation text cannot break out of its code block', () => {
    const hostile = 'normal text\n```\nmalicious content outside the fence\n```\nmore text';
    const body = formatPullRequestBody(issue, hostile, [], false, false);
    // The wrapping fence must use 4 backticks since the payload itself contains a 3-backtick run;
    // that keeps the payload's fences inert (plain text) inside the wider one.
    assert.ok(body.includes('````\n'), 'expected a 4-backtick opening fence around the explanation');
    const opens = (body.match(/````\n/g) ?? []).length;
    assert.equal(opens, 2, 'expected exactly one 4-backtick open and one close');
    assert.ok(body.includes(hostile), 'the hostile payload should appear verbatim inside the wider fence');
  });

  it('truncates very long bodies to stay under GitHub limits', () => {
    const body = formatPullRequestBody(issue, 'x'.repeat(100_000), [], false, false);
    assert.ok(body.length <= 60_000);
  });
});
