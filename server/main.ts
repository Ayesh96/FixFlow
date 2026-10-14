import { fileURLToPath } from 'node:url';
import { loadOrCreateToken } from './auth.ts';
import { createApp } from './app.ts';
import { loadConfig, moveLegacyDataDir } from './config.ts';
import { createIngestApp } from './ingest.ts';
import { loadWorkflows } from './workflows/index.ts';

try {
  process.loadEnvFile?.();
} catch {
  // Ignore if .env doesn't exist
}

const moved = moveLegacyDataDir();
if (moved) console.log(`Data from ~/.fixflow (the name before Code Akos) is now in ${moved}`);
const config = loadConfig();
const token = await loadOrCreateToken(config.tokenFile);
const { workflows, projects, events } = loadWorkflows(config);
await Promise.all(workflows.map(async (workflow) => workflow.start?.()));
const app = createApp({ port: config.port, publicPort: config.dashboardPublicPort, publicDir: fileURLToPath(new URL('../web/dist', import.meta.url)), token, workflows, events });

// Loopback unless told otherwise: this server holds your GitHub tokens, so it must not be reachable from the
// network. The container image widens the bind because a published port cannot reach the container's loopback.
const dashboardHost = config.dashboardHost ?? '127.0.0.1';
const server = app.listen(config.port, dashboardHost, () => {
  console.log(`Dashboard  →  http://localhost:${config.dashboardPublicPort ?? config.port}/?token=${token}`);
  console.log('  (open that link once; your browser remembers it. The token lives in a private file:', `${config.tokenFile})`);
  console.log(`  Data:         ${config.dataDir}`);
  if (dashboardHost !== '127.0.0.1' && dashboardHost !== 'localhost') {
    console.warn(`  ⚠  The dashboard is listening on ${dashboardHost}. Only publish it on 127.0.0.1 (for Docker: -p 127.0.0.1:${config.port}:${config.port}).`);
  }
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
