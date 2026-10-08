import { fileURLToPath } from 'node:url';
import { loadOrCreateToken } from './auth.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createIngestApp } from './ingest.ts';
import { loadWorkflows } from './workflows/index.ts';

try {
  process.loadEnvFile?.();
} catch {
  // Ignore if .env doesn't exist
}

const config = loadConfig();
const token = await loadOrCreateToken(config.tokenFile);
const { workflows, projects } = loadWorkflows(config);
await Promise.all(workflows.map(async (workflow) => workflow.start?.()));
const app = createApp({ port: config.port, publicDir: fileURLToPath(new URL('../web/dist', import.meta.url)), token, workflows });

// Loopback only: this server holds your GitHub tokens, so it must never be reachable from the network.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Dashboard  →  http://localhost:${config.port}/?token=${token}`);
  console.log('  (open that link once; your browser remembers it. The token lives in a private file:', `${config.tokenFile})`);
  console.log(`  Data:         ${config.dataDir}`);
  console.log(`  Workflows:    ${workflows.map((w) => w.id).join(', ')}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Set PORT=<other> and retry.` : err);
  process.exit(1);
});

/**
 * The second socket: Sentry SDKs post here without a cookie, so it deliberately carries none of
 * the dashboard's auth (see server/ingest.ts). Loopback unless you widen ORCH_ERRORS_INGEST_HOST.
 */
const errors = config.errors;
const ingestApp = errors ? createIngestApp(workflows) : null;
const ingestServer =
  ingestApp && errors
    ? ingestApp.listen(errors.ingestPort, errors.ingestHost, () => {
        console.log(`  Error ingest: http://${errors.ingestHost}:${errors.ingestPort}/api/<project>/store/  (no auth — Sentry SDKs post here)`);
        if (errors.ingestHost !== '127.0.0.1' && errors.ingestHost !== 'localhost') {
          console.warn(`  ⚠  Ingest is reachable from the network on ${errors.ingestHost}. Anyone who can reach it can file errors.`);
        }
      })
    : null;

ingestServer?.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? `Ingest port ${errors?.ingestPort} is already in use. Set ORCH_ERRORS_INGEST_PORT=<other>.` : err);
  process.exit(1);
});

const closeServer = (target: typeof server | null): Promise<void> =>
  new Promise((resolve) => {
    if (!target) return resolve();
    target.closeAllConnections();
    target.close(() => resolve());
  });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void Promise.all([closeServer(server), closeServer(ingestServer)])
      .then(() => Promise.allSettled(workflows.map(async (workflow) => workflow.stop?.())))
      .then(() => projects.close())
      .then(() => process.exit(0));
  });
}
