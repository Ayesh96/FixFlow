import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Reply = { status: number; body?: unknown };

export interface FakeGithub {
  url: string;
  /** Every request seen, so a test can check which token was sent where. */
  requests: { method: string; path: string; authorization: string | undefined }[];
  close(): Promise<void>;
}

/** A GitHub API stand-in on a real local socket: the code under test makes real HTTP requests to it. */
export async function startFakeGithub(handler: (method: string, path: string) => Reply): Promise<FakeGithub> {
  const requests: FakeGithub['requests'] = [];
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', path: req.url ?? '', authorization: req.headers.authorization });
    const { status, body } = handler(req.method ?? '', req.url ?? '');
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}
