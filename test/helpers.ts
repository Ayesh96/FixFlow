import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../server/config.ts';

/** A configuration whose files all live in a fresh temporary folder. */
export async function tempConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const root = await mkdtemp(join(tmpdir(), 'errorflow-'));
  return {
    port: 7420,
    home: root,
    dataDir: root,
    tokenFile: join(root, 'token'),
    projectsDb: join(root, 'projects.db'),
    secretKeyFile: join(root, 'secret.key'),
    reposDir: join(root, 'repos'),
    githubCloneUrl: 'https://github.com/{repo}.git',
    errors: null,
    resolver: null,
    ...overrides,
  };
}

/** A port nothing is listening on right now. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
