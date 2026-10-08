import type { NormalizedEvent } from '../../../server/workflows/errors/types.ts';
import { normalizeEvent } from '../../../server/workflows/errors/sentry/normalize.ts';

/** A browser-SDK-shaped event. */
export function jsEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    timestamp: 1_790_000_000.5,
    platform: 'javascript',
    level: 'error',
    environment: 'production',
    release: 'web@1.4.2',
    tags: { browser: 'Chrome 130' },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: {
            frames: [
              { filename: 'https://app.example.com/static/main.3f9a8c1b.js?v=2', function: 'render', lineno: 10, colno: 4, in_app: true },
              { filename: 'https://app.example.com/static/main.3f9a8c1b.js?v=2', function: 'getUserId', lineno: 42, colno: 17, in_app: true },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

/** A sentry-python-shaped event: ISO timestamp, logentry, context lines, tags as pairs. */
export function pyEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: '00000000000000000000000000000001',
    timestamp: '2026-09-20T10:15:30.123456Z',
    platform: 'python',
    level: 'error',
    environment: 'staging',
    server_name: 'worker-3',
    logentry: { message: 'Job %s failed', formatted: 'Job 8841 failed' },
    tags: [['runtime', 'CPython 3.12']],
    exception: {
      values: [
        {
          type: 'KeyError',
          value: "'user_id'",
          stacktrace: {
            frames: [
              { filename: '/app/worker.py', function: 'run', lineno: 88, in_app: true, context_line: 'handle(job)' },
              { filename: '/app/handlers.py', function: 'handle', lineno: 12, in_app: true, context_line: "  uid = payload['user_id']" },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

export const normalized = (event: Record<string, unknown>): NormalizedEvent => normalizeEvent(JSON.stringify(event));

export function envelope(items: { header: Record<string, unknown>; payload: string | Buffer }[], header: Record<string, unknown> = {}): Buffer {
  const parts: Buffer[] = [Buffer.from(`${JSON.stringify(header)}\n`)];
  for (const { header: h, payload } of items) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    parts.push(Buffer.from(`${JSON.stringify({ ...h, length: body.length })}\n`), body, Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}
