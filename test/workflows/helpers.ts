import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import type { Express } from 'express';
import type { Logger } from '../../server/workflows/types.ts';

/** Swallows output so a test's own assertions are the only thing on the console. */
export const silentLogger = (): Logger => ({ info: () => {}, warn: () => {}, error: () => {} });

/** Records what was logged, for the tests that assert on warnings. */
export function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const at = () => (first: object | string, second?: string) => {
    lines.push(typeof first === 'string' ? first : (second ?? JSON.stringify(first)));
  };
  return Object.assign({ info: at(), warn: at(), error: at() } as Logger, { lines });
}

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export interface Listening {
  base: string;
  close(): Promise<void>;
}

/**
 * Starts an Express app on a free loopback port. The absorbed workflows' route tests used
 * Fastify's `app.inject()`; Express has no equivalent, so they drive a real socket instead
 * (the same approach as test/http.test.ts).
 */
export async function listen(app: Express): Promise<Listening> {
  const port = await freePort();
  const server: Server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
