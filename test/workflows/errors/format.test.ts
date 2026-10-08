import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatIssueBody, formatIssueTitle } from '../../../server/workflows/errors/format.ts';
import { jsEvent, normalized } from './fixtures.ts';

describe('issue formatting', () => {
  it('builds the [Error] Type: message title, single-line and bounded', () => {
    assert.equal(formatIssueTitle(normalized(jsEvent())), "[Error] TypeError: Cannot read properties of undefined (reading 'id')");
    const long = normalized(jsEvent({ exception: { values: [{ type: 'Error', value: `line1\nline2 ${'x'.repeat(500)}` }] } }));
    const title = formatIssueTitle(long);
    assert.ok(title.length <= 120 && !title.includes('\n'));
  });

  it('renders environment, platform, timestamp and a newest-first stack trace in a fence', () => {
    const body = formatIssueBody(normalized(jsEvent()), 'f'.repeat(64));
    assert.match(body, /\*\*Environment\*\* \| `production`/);
    assert.match(body, /\*\*Platform\*\* \| `javascript`/);
    assert.match(body, /\*\*Occurred At\*\* \| `2026-/);
    const trace = /### Stack trace\n\n```\n([\s\S]*?)\n```/.exec(body)?.[1] ?? '';
    assert.match(trace, /^TypeError: Cannot read/);
    assert.ok(trace.indexOf('getUserId') < trace.indexOf('render'), 'newest frame comes first');
    assert.match(trace, /at getUserId \(https:\/\/app\.example\.com\/static\/main\.3f9a8c1b\.js\?v=2:42:17\)/);
  });

  it('cannot be broken out of by backticks or mentions in the payload', () => {
    const hostile = normalized(
      jsEvent({ environment: 'prod`\n@octocat', exception: { values: [{ type: 'Error', value: '```\n@everyone\n```' }] } }),
    );
    const body = formatIssueBody(hostile, 'abc');
    assert.match(body, /````\n```\n@everyone\n```\n````/); // fence widened past the payload's own run
    assert.match(body, /\*\*Environment\*\* \| `prod' @octocat`/);
  });

  it('stays under GitHub’s body size limit', () => {
    const frames = Array.from({ length: 5000 }, (_, i) => ({ filename: `f${i}.js`, function: 'fn', lineno: i, in_app: true }));
    const body = formatIssueBody(normalized(jsEvent({ exception: { values: [{ type: 'Error', value: 'x'.repeat(100_000), stacktrace: { frames } }] } })), 'abc');
    assert.ok(body.length <= 60_000);
  });
});
