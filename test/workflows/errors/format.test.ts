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

  it('shows the request, folds library frames into one line, and puts the source line under the app frame', () => {
    const frame = (fn: string, inApp: boolean, extra = {}) => ({ filename: `${inApp ? 'app' : 'lib'}/${fn}.py`, function: fn, lineno: 7, in_app: inApp, ...extra });
    const event = normalized({
      event_id: 'f'.repeat(32), platform: 'python', level: 'error',
      request: { method: 'POST', url: 'http://localhost:8421/volume/up?x=1' },
      exception: { values: [{ type: 'NameError', value: "name 'X' is not defined", stacktrace: { frames: [frame('server', false), frame('router', false), frame('volume', true, { context_line: '    delta = X' }), frame('wrapper', false)] } }] },
    });
    const body = formatIssueBody(event, 'abc');
    assert.match(body, /\| \*\*Request\*\* \| `POST \/volume\/up` \|/);
    assert.doesNotMatch(body, /8421|x=1/, 'no host and no query string');
    assert.match(body, /at volume \(app\/volume\.py:7\)\n {8}delta = X/);
    assert.match(body, /… 1 library frame\n/);
    assert.match(body, /… 2 library frames/);
    assert.doesNotMatch(body, /at router|at server|at wrapper/);
  });

  it('shows a whole stack when none of it is app code, and where a logged message came from', () => {
    const lib = normalized({ ...jsEvent(), exception: { values: [{ type: 'RangeError', value: 'x', stacktrace: { frames: [{ filename: 'a.js', function: 'a', lineno: 1, in_app: false }, { filename: 'b.js', function: 'b', lineno: 2, in_app: false }] } }] } });
    assert.match(formatIssueBody(lib, 'abc'), /at b \(b\.js:2\)\n {4}at a \(a\.js:1\)/);
    const logged = normalized({ event_id: 'e'.repeat(32), platform: 'python', level: 'error', message: 'pmset failed', threads: { values: [{ stacktrace: { frames: [{ filename: 'main.py', function: 'display_sleep', lineno: 131, in_app: true, context_line: 'capture_message(...)' }] } }] } });
    assert.match(formatIssueBody(logged, 'abc'), /pmset failed \(logged from\)\n {4}at display_sleep \(main\.py:131\)/);
  });
});
