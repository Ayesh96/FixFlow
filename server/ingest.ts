import express, { type ErrorRequestHandler, type Express } from 'express';
import { HttpError } from './errors.ts';
import type { Workflow } from './workflows/types.ts';

const onError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  console.error('ingest:', err);
  res.status(500).json({ error: 'Internal error' });
};

/**
 * The public listener, kept deliberately separate from the dashboard.
 *
 * The dashboard is loopback-only and demands a token cookie, a known `Host` and a same-site
 * `Origin`, because it holds GitHub tokens. None of that can apply to Sentry ingest: SDKs —
 * browsers included — post cross-origin from wherever the app runs, with no cookie. Rather than
 * punching a hole in the dashboard's checks, those routes get their own socket, their own port and
 * nothing else on it. A request arriving here can only file an error; it cannot reach the dashboard's API.
 *
 * It still binds loopback by default. Opening it to the network is an explicit choice
 * (`ORCH_ERRORS_INGEST_HOST=0.0.0.0`), and only then can anything off-machine reach it.
 */
export function createIngestApp(workflows: Workflow[]): Express | null {
  const contributors = workflows.filter((workflow) => workflow.ingestRoutes);
  if (contributors.length === 0) return null;

  const app = express();
  app.disable('x-powered-by');
  // No localOnly, no securityHeaders, no token: see above. Nothing here reads a cookie.
  for (const workflow of contributors) {
    const router = express.Router();
    workflow.ingestRoutes?.(router);
    app.use(router);
  }
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(onError);
  return app;
}
