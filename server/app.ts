import express, { type ErrorRequestHandler, type Express } from 'express';
import { requireToken, tokenLogin } from './auth.ts';
import { HttpError } from './errors.ts';
import { localOnly, securityHeaders } from './guard.ts';
import type { Workflow } from './workflows/types.ts';

export interface AppDeps {
  /** The dashboard's port, so only its own loopback Host names are accepted. */
  port: number;
  publicDir: string;
  /** Secret the browser must present (see auth.ts). */
  token: string;
  /** Mounted under /api/ext/<id>; see workflows/types.ts. */
  workflows?: Workflow[];
}

/** What a workflow id may be: it becomes part of a URL and a tab. */
const WORKFLOW_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

const onError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
};

export function createApp({ port, publicDir, token, workflows = [] }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly(port));
  app.use(securityHeaders);
  app.use(tokenLogin(token));
  app.use(express.json({ limit: '256kb' }));

  const api = express.Router();
  api.use(requireToken(token));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // issue lists and project settings shouldn't linger in any cache
    next();
  });

  // The UI builds one tab per workflow from this list.
  api.get('/extensions', (_req, res) => {
    res.json({ extensions: workflows.map(({ id, title }) => ({ id, title })) });
  });
  for (const workflow of workflows) {
    if (!WORKFLOW_ID.test(workflow.id)) throw new Error(`Invalid workflow id "${workflow.id}"`);
    const router = express.Router();
    workflow.routes(router);
    api.use(`/ext/${workflow.id}`, router);
  }

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);
  app.use(express.static(publicDir));
  app.use(onError);
  return app;
}
