import type { Request, RequestHandler, Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliDecompress, gunzip, inflate } from 'node:zlib';
import { HttpError } from '../../errors.ts';
import { parseEnvelope } from './sentry/envelope.ts';
import { normalizeEvent } from './sentry/normalize.ts';
import type { NormalizedEvent } from './types.ts';
import { INGEST_MAX_BODY_BYTES, INGEST_MAX_DECODED_BYTES } from '../../constants.ts';

/** All these routes need of the Ingestor; a seam so they can be tested without a store. */
export interface EventSink {
  ingest(event: NormalizedEvent, projectId: string): void;
}

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliAsync = promisify(brotliDecompress);


/** Browser SDKs POST cross-origin, so ingest routes must answer preflights. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'x-sentry-auth, content-type, content-encoding, authorization, sentry-trace, baggage',
  'access-control-max-age': '86400',
};

/**
 * Collects the request body as raw bytes, capped at `limit`.
 *
 * Deliberately not `express.raw()`: body-parser either silently inflates a gzip body (with no
 * limit on the result, defeating the zip-bomb guard below) or, with `inflate: false`, rejects any
 * encoded body outright with a 415. Sentry SDKs gzip by default, so neither will do — we need the
 * bytes exactly as sent and decompress them ourselves.
 */
function rawBody(limit: number): RequestHandler {
  return (req, _res, next) => {
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > limit) {
      next(new HttpError(413, 'Request body too large'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      next(err);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        fail(new HttpError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      req.body = Buffer.concat(chunks);
      next();
    });
    req.on('error', fail);
  };
}

async function decodeBody(req: Request): Promise<Buffer> {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'Empty request body');

  const encoding = String(req.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  const limits = { maxOutputLength: INGEST_MAX_DECODED_BYTES };
  try {
    switch (encoding) {
      case 'identity':
        return body;
      case 'gzip':
      case 'x-gzip':
        return await gunzipAsync(body, limits);
      case 'deflate':
        return await inflateAsync(body, limits);
      case 'br':
        return await brotliAsync(body, limits);
      default:
        throw new HttpError(415, `Unsupported content-encoding: ${encoding}`);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new HttpError(413, 'Decompressed payload too large');
    throw new HttpError(400, `Could not decompress ${encoding} body`);
  }
}

/** SDKs send the key in `X-Sentry-Auth` or, from browsers, as a query parameter. */
function extractKey(req: Request): string | null {
  const query = req.query.sentry_key;
  if (typeof query === 'string') return query;
  const header = req.headers['x-sentry-auth'];
  return typeof header === 'string' ? (/sentry_key=([^,\s]+)/.exec(header)?.[1] ?? null) : null;
}

function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The Sentry-compatible endpoints, mounted on the **public** ingest listener rather than the
 * dashboard: SDKs post here cross-origin with no cookie, so none of the dashboard's Origin,
 * Host or token checks can apply. The only optional credential is the DSN's `sentry_key`.
 */
export function ingestRoutes(router: Router, sink: EventSink, dsnPublicKey: string | null): void {
  router.use((_req, res, next) => {
    res.set(CORS_HEADERS);
    next();
  });
  router.options(/.*/, (_req, res) => {
    res.status(204).end();
  });

  router.use(rawBody(INGEST_MAX_BODY_BYTES));

  const authenticate = (req: Request): void => {
    if (!dsnPublicKey) return;
    const provided = extractKey(req);
    if (!provided || !keysMatch(provided, dsnPublicKey)) throw new HttpError(401, 'Invalid or missing sentry_key');
  };

  /** Acknowledge now, process on the next tick so ingestion work never delays the SDK. */
  const enqueue = (projectId: string, events: NormalizedEvent[]): void => {
    setImmediate(() => {
      for (const event of events) {
        try {
          sink.ingest(event, projectId);
        } catch (err) {
          console.error('errors: failed to process event', event.eventId, err);
        }
      }
    });
  };

  router.post('/api/:projectId/store', async (req, res) => {
    authenticate(req);
    const event = normalizeEvent((await decodeBody(req)).toString('utf8'));
    enqueue(req.params.projectId, [event]);
    res.json({ id: event.eventId });
  });

  router.post('/api/:projectId/envelope', async (req, res) => {
    authenticate(req);
    const envelope = parseEnvelope(await decodeBody(req));
    // Transactions, sessions, replays, attachments etc. are acknowledged and ignored.
    const events = envelope.items.filter((item) => item.type === 'event').map((item) => normalizeEvent(item.payload.toString('utf8')));
    enqueue(req.params.projectId, events);
    const id = envelope.eventId ?? events[0]?.eventId;
    res.json(id ? { id } : {});
  });

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
}
