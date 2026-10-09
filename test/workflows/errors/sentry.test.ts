import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PayloadError } from '../../../server/errors.ts';
import { computeFingerprint } from '../../../server/workflows/errors/grouping.ts';
import { parseEnvelope } from '../../../server/workflows/errors/sentry/envelope.ts';
import { normalizeEvent } from '../../../server/workflows/errors/sentry/normalize.ts';
import { envelope, jsEvent, normalized, pyEvent } from './fixtures.ts';

describe('parseEnvelope', () => {
  it('reads length-prefixed items, including payloads containing newlines and binary bytes', () => {
    const binary = Buffer.from([0x00, 0x0a, 0xff, 0x0a, 0x42]);
    const body = envelope(
      [
        { header: { type: 'attachment' }, payload: binary },
        { header: { type: 'event' }, payload: '{"a":\n1}' },
      ],
      { event_id: 'abc' },
    );
    const parsed = parseEnvelope(body);
    assert.equal(parsed.eventId, 'abc');
    assert.deepEqual(parsed.items.map((i) => i.type), ['attachment', 'event']);
    assert.deepEqual(parsed.items[0]?.payload, binary);
    assert.equal(parsed.items[1]?.payload.toString(), '{"a":\n1}');
  });

  it('reads items without a length by scanning to the next newline', () => {
    const body = Buffer.from('{}\n{"type":"event"}\n{"x":1}\n{"type":"session"}\n{"y":2}\n');
    const parsed = parseEnvelope(body);
    assert.deepEqual(parsed.items.map((i) => [i.type, i.payload.toString()]), [['event', '{"x":1}'], ['session', '{"y":2}']]);
  });

  it('rejects malformed headers and overlong items', () => {
    assert.throws(() => parseEnvelope(Buffer.from('not json\n')), PayloadError);
    assert.throws(() => parseEnvelope(Buffer.from('{}\n{"type":"event","length":99}\n{}\n')), PayloadError);
  });
});

describe('normalizeEvent', () => {
  it('handles a browser-style event', () => {
    const ev = normalizeEvent(JSON.stringify(jsEvent()));
    assert.equal(ev.eventId, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
    assert.equal(ev.occurredAt, new Date(1_790_000_000_500).toISOString());
    assert.equal(ev.exceptionType, 'TypeError');
    assert.match(ev.message, /reading 'id'/);
    assert.equal(ev.environment, 'production');
    assert.deepEqual(ev.tags, { browser: 'Chrome 130' });
    assert.equal(ev.exceptions[0]?.frames.length, 2);
  });

  it('handles a python-style event (ISO timestamp, tag pairs, logentry)', () => {
    const ev = normalized(pyEvent({ exception: undefined }));
    assert.equal(ev.occurredAt, '2026-09-20T10:15:30.123Z');
    assert.equal(ev.message, 'Job 8841 failed');
    assert.equal(ev.exceptionType, null);
    assert.deepEqual(ev.tags, { runtime: 'CPython 3.12' });
    assert.equal(ev.serverName, 'worker-3');
  });

  it('applies defaults for sparse or odd payloads', () => {
    const ev = normalizeEvent('{"level":"critical","message":{"formatted":"boom"}}');
    assert.equal(ev.level, 'fatal');
    assert.equal(ev.message, 'boom');
    assert.equal(ev.platform, 'other');
    assert.match(ev.eventId, /^[0-9a-f]{32}$/);
  });

  it('rejects non-object and non-JSON payloads', () => {
    assert.throws(() => normalizeEvent('[]'), PayloadError);
    assert.throws(() => normalizeEvent('{'), PayloadError);
  });
});

describe('normalizeEvent: what the SDK adds beyond the exception', () => {
  const frame = (fn: string, inApp: boolean, extra: Record<string, unknown> = {}) => ({ filename: 'main.py', function: fn, lineno: 10, in_app: inApp, ...extra });
  const message = (extra: Record<string, unknown>) => normalized({ event_id: 'a'.repeat(32), platform: 'python', level: 'error', message: 'display sleep failed', ...extra });

  it("reads the stack Sentry attaches to a message, which lives in `threads`, not `exception`", () => {
    const e = message({ threads: { values: [{ crashed: false, current: true, stacktrace: { frames: [frame('main', true), frame('display_sleep', true)] } }] } });
    assert.deepEqual(e.stack.map((f) => f.function), ['main', 'display_sleep']);
    assert.deepEqual(e.exceptions, []);
  });

  it('prefers the crashed thread, and ignores threads when the exception already has frames', () => {
    const two = message({ threads: { values: [{ current: true, stacktrace: { frames: [frame('a', true)] } }, { crashed: true, stacktrace: { frames: [frame('b', true)] } }] } });
    assert.deepEqual(two.stack.map((f) => f.function), ['b']);
    const withException = normalized(jsEvent({ threads: { values: [{ stacktrace: { frames: [frame('t', true)] } }] } }));
    assert.deepEqual(withException.stack, []);
  });

  it('keeps short local variables, and the request as method and path only (no host, no query string)', () => {
    const e = normalized(jsEvent({ request: { method: 'post', url: 'http://10.0.0.5:8420/volume/up?token=secret', headers: { cookie: 'x' } } }));
    assert.deepEqual(e.request, { method: 'POST', path: '/volume/up' });
    const long = normalized(jsEvent({ exception: { values: [{ type: 'E', value: 'v', stacktrace: { frames: [frame('f', true, { vars: { direction: "'up'", blob: 'x'.repeat(500) } })] } }] } }));
    assert.equal(long.exceptions[0]?.frames[0]?.vars?.direction, "'up'");
    assert.ok((long.exceptions[0]?.frames[0]?.vars?.blob ?? '').length <= 120);
    assert.equal(normalized(jsEvent()).request, null);
    assert.equal(normalized(jsEvent()).exceptions[0]?.frames[0]?.vars, null);
  });
});

describe('computeFingerprint', () => {
  it('is stable across messages, line numbers, content hashes and query strings', () => {
    const a = normalized(jsEvent());
    const shifted = jsEvent({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'name')",
            stacktrace: {
              frames: [
                { filename: 'https://staging.example.com/static/main.99ffee00.js', function: 'render', lineno: 11, in_app: true },
                { filename: 'https://staging.example.com/static/main.99ffee00.js', function: 'getUserId', lineno: 57, in_app: true },
              ],
            },
          },
        ],
      },
    });
    assert.equal(computeFingerprint(a), computeFingerprint(normalized(shifted)));
  });

  it('differs when the exception type, file or crashing code changes', () => {
    const base = computeFingerprint(normalized(pyEvent()));
    const frames = (file: string, line: string) => ({
      values: [{ type: 'KeyError', value: 'x', stacktrace: { frames: [{ filename: file, function: 'f', in_app: true, context_line: line }] } }],
    });
    assert.notEqual(base, computeFingerprint(normalized(pyEvent({ exception: frames('/app/other.py', "  uid = payload['user_id']") }))));
    assert.notEqual(base, computeFingerprint(normalized(pyEvent({ exception: frames('/app/handlers.py', "  uid = payload['id']") }))));
    const typeChanged = pyEvent();
    ((typeChanged.exception as { values: { type: string }[] }).values[0] as { type: string }).type = 'ValueError';
    assert.notEqual(base, computeFingerprint(normalized(typeChanged)));
  });

  it('prefers the newest in-app frame over library frames', () => {
    const withLib = pyEvent({
      exception: {
        values: [
          {
            type: 'KeyError',
            value: 'x',
            stacktrace: {
              frames: [
                { filename: '/app/handlers.py', function: 'handle', in_app: true, context_line: "  uid = payload['user_id']" },
                { filename: '/venv/lib/dict.py', function: '__getitem__', in_app: false },
              ],
            },
          },
        ],
      },
    });
    const single = pyEvent({
      exception: {
        values: [
          { type: 'KeyError', value: 'x', stacktrace: { frames: [{ filename: '/app/handlers.py', function: 'other', in_app: true, context_line: "  uid = payload['user_id']" }] } },
        ],
      },
    });
    assert.equal(computeFingerprint(normalized(withLib)), computeFingerprint(normalized(single)));
  });

  it('groups stackless messages by their normalized text', () => {
    const msg = (m: string) => normalized({ platform: 'node', message: m });
    assert.equal(computeFingerprint(msg('User 42 not found')), computeFingerprint(msg('User 7 not found')));
    assert.notEqual(computeFingerprint(msg('User 42 not found')), computeFingerprint(msg('Order 42 not found')));
  });

  it('honors client fingerprints and the {{ default }} placeholder', () => {
    const plain = computeFingerprint(normalized(jsEvent()));
    const custom = computeFingerprint(normalized(jsEvent({ fingerprint: ['payments', 'timeout'] })));
    const sameCustom = computeFingerprint(normalized(jsEvent({ fingerprint: ['payments', 'timeout'], message: 'other' })));
    const defaultOnly = computeFingerprint(normalized(jsEvent({ fingerprint: ['{{ default }}'] })));
    const defaultPlus = computeFingerprint(normalized(jsEvent({ fingerprint: ['{{ default }}', 'tenant-9'] })));
    assert.notEqual(plain, custom);
    assert.equal(custom, sameCustom);
    assert.equal(plain, defaultOnly);
    assert.notEqual(plain, defaultPlus);
  });
});
