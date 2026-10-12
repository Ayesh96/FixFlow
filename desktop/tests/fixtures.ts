import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const BUILT_APP = join(__dirname, '..', 'release', 'mac-arm64', 'FixFlow.app');
const CLONES = join(__dirname, '..', '.test-apps');

export const GOOD_KEY = 'sk-good';
export const OLLAMA_MODELS = ['qwen3:14b', 'qwen2.5-coder:7b'];
export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
export const ANTHROPIC_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5-5'];

/** What the fake providers answer; tests flip these to get the failure they want. */
export interface FakeState {
  ollama: 'ok' | 'empty' | 'error';
  hostedDelayMs: number;
}

export interface Fake {
  url: string;
  /** An address nothing listens on, for "cannot reach" cases. */
  deadUrl: string;
  state: FakeState;
}

function startFake(state: FakeState): Promise<Server> {
  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const authorized = req.headers.authorization === `Bearer ${GOOD_KEY}` || req.headers['x-api-key'] === GOOD_KEY;
    if (req.url === '/api/tags') {
      if (state.ollama === 'error') return json(500, { error: 'boom' });
      return json(200, { models: state.ollama === 'empty' ? [] : OLLAMA_MODELS.map((name) => ({ name })) });
    }
    const hosted = (models: string[]) =>
      setTimeout(() => (authorized ? json(200, { data: models.map((id) => ({ id })) }) : json(401, { error: 'invalid key' })), state.hostedDelayMs);
    if (req.url === '/models') return hosted(DEEPSEEK_MODELS);
    if (req.url === '/v1/models') return hosted(ANTHROPIC_MODELS);
    json(404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A port that was free a moment ago and is now closed, so connecting to it fails fast. */
async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  /** The .env the app writes, inside this test's own copy of the app. */
  envPath: string;
}

export interface LaunchOptions {
  /** Extra environment for the app, e.g. ORCH_DEEPSEEK_API_URL pointing at fake.deadUrl. */
  env?: Record<string, string>;
}

export const test = base.extend<{ fake: Fake; launch: (options?: LaunchOptions) => Promise<Launched> }>({
  fake: async ({}, use) => {
    const state: FakeState = { ollama: 'ok', hostedDelayMs: 0 };
    const server = await startFake(state);
    const { port } = server.address() as AddressInfo;
    await use({ url: `http://127.0.0.1:${port}`, deadUrl: `http://127.0.0.1:${await deadPort()}`, state });
    await new Promise<void>((r) => server.close(() => r()));
  },

  // Each test gets its own APFS clone of the built app, so a test that saves (writes .env and
  // starts a server) never leaks into another test.
  launch: async ({ fake }, use, testInfo) => {
    if (!existsSync(BUILT_APP)) throw new Error('Build the app first: npm run dist:mac && codesign --force --deep --sign - release/mac-arm64/FixFlow.app');
    const copyRoot = join(CLONES, `${testInfo.workerIndex}-${testInfo.testId}`);
    rmSync(copyRoot, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', copyRoot]);
    const appCopy = join(copyRoot, 'FixFlow.app');
    execFileSync('cp', ['-cR', BUILT_APP, appCopy]);
    const envPath = join(appCopy, 'Contents', 'Resources', 'app', '.env');
    rmSync(envPath, { force: true });

    const apps: ElectronApplication[] = [];
    await use(async (options = {}) => {
      const env = { ...process.env, ORCH_DEEPSEEK_API_URL: fake.url, ORCH_ANTHROPIC_API_URL: fake.url, ...options.env } as Record<string, string>;
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        executablePath: join(appCopy, 'Contents', 'MacOS', 'FixFlow'),
        args: [`--user-data-dir=${join(copyRoot, 'user-data')}`],
        env,
      });
      apps.push(app);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      return { app, page, envPath };
    });
    for (const app of apps) await app.close().catch(() => {});
    rmSync(copyRoot, { recursive: true, force: true });
  },
});

export { expect } from '@playwright/test';

/** A TCP port that is free right now. */
export async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** Holds a port open so the app sees it as busy. Call close() when done. */
export async function occupyPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const { port } = s.address() as AddressInfo;
  return { port, close: () => new Promise<void>((r) => s.close(() => r())) };
}

/**
 * Makes the native "Choose folder…" dialog return `dir`, then clicks the button. Every test that
 * saves MUST use this with a scratch folder: the default ~/.fixflow is the user's real data.
 */
export async function chooseDataFolder(app: ElectronApplication, page: Page, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
  }, dir);
  await page.click('#chooseFolder');
  await page.waitForFunction((d) => (document.getElementById('dataDir') as HTMLInputElement).value === d, dir);
}

export const readEnv = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);
