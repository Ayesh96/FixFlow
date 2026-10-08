import type { Router } from 'express';

/**
 * The pino-shaped logger the absorbed workflows were written against: `info({ err }, 'message')`
 * or `info('message')`. Defined here so the workflows need neither pino nor fastify.
 */
export interface Logger {
  info(details: object, message?: string): void;
  info(message: string): void;
  warn(details: object, message?: string): void;
  warn(message: string): void;
  error(details: object, message?: string): void;
  error(message: string): void;
}

const emit = (level: 'info' | 'warn' | 'error', args: [object | string, string?]): void => {
  const [first, second] = args;
  const write = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
  // launchd captures stdout/stderr per app, so one line per entry keeps the log viewer readable.
  if (typeof first === 'string') write(`[${level}] ${first}`);
  else write(`[${level}] ${second ?? ''}`.trimEnd(), JSON.stringify(first, replaceErrors));
};

/** Errors don't survive JSON.stringify, so unwrap them into something readable. */
function replaceErrors(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
}

/** Prefixes every line with the workflow's id, so one log file can carry all of them. */
export function prefixedLogger(id: string): Logger {
  const at = (level: 'info' | 'warn' | 'error') =>
    (first: object | string, second?: string): void =>
      emit(level, [typeof first === 'string' ? `${id}: ${first}` : first, second ? `${id}: ${second}` : `${id}`]);
  return { info: at('info'), warn: at('warn'), error: at('error') } as Logger;
}

/**
 * A feature that plugs into the dashboard. Its `routes` are served under `/api/ext/<id>` behind the
 * dashboard's token check, and its `title` becomes a tab in the UI.
 *
 * `ingestRoutes` is the exception: those are mounted on a **separate, public listener** (see
 * server/ingest.ts) with no cookie and no Origin check, because Sentry SDKs — including browsers —
 * post to them cross-origin. A workflow only declares them if it genuinely needs outside traffic.
 */
export interface Workflow {
  /** URL-safe (same rules as an app name); part of the route prefix. */
  id: string;
  title: string;
  routes(router: Router): void;
  /** Mounted on the public ingest listener, outside the dashboard's auth boundary. */
  ingestRoutes?(router: Router): void;
  /** Runs before the server starts listening; a rejection aborts startup. */
  start?(): Promise<void> | void;
  /** Runs once the server has stopped accepting requests, on SIGINT/SIGTERM. */
  stop?(): Promise<void> | void;
}
