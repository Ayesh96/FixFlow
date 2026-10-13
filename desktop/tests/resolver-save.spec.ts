import { createServer } from 'node:net';
import type { ElectronApplication, Page } from '@playwright/test';
import { chooseDataFolder, expect, freePort, readEnv, test, type Fake } from './fixtures';

// Section E of CASES.md: the resolver step (step 4), Save, and relaunching after a save.
//
// SAFETY: every test that clicks Save first points the data folder at a scratch folder inside the
// test's output directory, and uses ports from freePort(). The default ~/.code-akos is never used.
// Ollama always points at the local fake, never a real URL.

const SAVE_TIMEOUT = 120_000;

interface Ports {
  dashboard: number;
  ingest: number;
}

async function freePorts(): Promise<Ports> {
  const dashboard = await freePort();
  let ingest = await freePort();
  while (ingest === dashboard) ingest = await freePort();
  return { dashboard, ingest };
}

/** True when nothing is listening on the port (the app's own server has shut down). */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** The value of KEY in a .env file, or undefined when the line is not there. */
function envValue(env: string | null, key: string): string | undefined {
  const line = env?.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

/**
 * Walks the wizard from step 1 to step 4 with Ollama pointed at the fake.
 * Optional `ollamaModel` picks a model from the fake's list; `commentThresholds` sets the
 * comment counts on the Errors step before moving on.
 */
async function reachResolver(
  app: ElectronApplication,
  page: Page,
  fake: Fake,
  dataDir: string,
  ports: Ports,
  options: { ollamaModel?: string; commentThresholds?: string } = {},
): Promise<void> {
  // Step 1: Basics. The data folder is always a scratch folder, so any Save below is safe.
  await chooseDataFolder(app, page, dataDir);
  await page.fill('#port', String(ports.dashboard));
  await expect(page.locator('.msg[data-key="port"]')).toHaveText('Free.');
  await page.click('#next');
  await expect(page.locator('section[data-step="1"] h1')).toBeVisible();

  // Step 2: Model (Ollama only)
  await page.check('#useOllama');
  await page.fill('#ollamaUrl', fake.url);
  await expect(page.locator('#ollamaModel')).toBeEnabled();
  if (options.ollamaModel) await page.selectOption('#ollamaModel', options.ollamaModel);
  await page.click('#next');
  await expect(page.locator('section[data-step="2"] h1')).toBeVisible();

  // Step 3: Errors
  await page.fill('#ingestPort', String(ports.ingest));
  await expect(page.locator('.msg[data-key="ingestPort"]')).toHaveText('Free.');
  if (options.commentThresholds !== undefined) await page.fill('#commentThresholds', options.commentThresholds);
  await page.click('#next');
  await expect(page.locator('section[data-step="3"] h1')).toBeVisible();
}

/** Counts .env writes made by the main process from now on. */
async function countEnvWrites(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const main = process as unknown as { mainModule: { require: (id: string) => any } };
    const fs = main.mainModule.require('node:fs');
    const g = globalThis as any;
    g.__envWrites = 0;
    const original = fs.writeFileSync;
    fs.writeFileSync = (file: unknown, ...rest: unknown[]) => {
      if (String(file).endsWith('.env')) g.__envWrites += 1;
      return original(file, ...rest);
    };
  });
}

async function envWrites(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as any).__envWrites as number);
}

/** Dashboard windows are the ones served over http; the setup window is a file:// page. */
function dashboardWindows(app: ElectronApplication): Page[] {
  return app.windows().filter((w) => w.url().startsWith('http://'));
}

test.describe('E. Step 4: resolver and saving', () => {
  test('E1 has no resolver on/off switch', async ({ launch, fake }, testInfo) => {
    const { app, page } = await launch();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), await freePorts());

    await expect(page.locator('#resolverEnabled')).toHaveCount(0);
    await expect(page.locator('section[data-step="3"] input.switch')).toHaveCount(0);
    await expect(page.locator('#maxConcurrent')).toBeVisible();
    await expect(page.locator('#maxAttempts')).toBeVisible();
  });

  test('E2 fixes at the same time of 0, empty or -1 is an error and Save stays disabled', async ({ launch, fake }, testInfo) => {
    const { app, page } = await launch();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), await freePorts());

    for (const value of ['0', '', '-1']) {
      await page.fill('#maxConcurrent', value);
      await expect(page.locator('.msg[data-key="maxConcurrent"]')).toHaveText('Enter a whole number, 1 or more.');
      await expect(page.locator('.msg[data-key="maxConcurrent"]')).toHaveClass(/error/);
      await expect(page.locator('#maxConcurrent')).toHaveClass(/invalid/);
      await expect(page.locator('#save')).toBeDisabled();
    }

    await page.fill('#maxConcurrent', '2');
    await expect(page.locator('.msg[data-key="maxConcurrent"]')).toHaveText('');
    await expect(page.locator('#save')).toBeEnabled();
  });

  test('E3 attempts per issue of 0 is an error and Save stays disabled', async ({ launch, fake }, testInfo) => {
    const { app, page } = await launch();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), await freePorts());

    await page.fill('#maxAttempts', '0');
    await expect(page.locator('.msg[data-key="maxAttempts"]')).toHaveText('Enter a whole number, 1 or more.');
    await expect(page.locator('.msg[data-key="maxAttempts"]')).toHaveClass(/error/);
    await expect(page.locator('#save')).toBeDisabled();
  });

  test('E4 the interval list holds exactly the five presets with 5 minutes selected', async ({ launch, fake }, testInfo) => {
    const { app, page } = await launch();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), await freePorts());

    await expect(page.locator('#pollInterval option')).toHaveText(['1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour']);
    await expect(page.locator('#pollInterval')).toHaveValue('300000');
    await expect(page.locator('#pollInterval option:checked')).toHaveText('5 minutes');
  });

  test('E5 values entered on earlier steps are kept when going back and forward', async ({ launch, fake }, testInfo) => {
    const { app, page } = await launch();
    const ports = await freePorts();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), ports);
    await page.fill('#maxConcurrent', '5');
    await page.fill('#maxAttempts', '7');

    // Back to Basics, then forward again to the resolver step.
    for (let i = 0; i < 3; i++) await page.click('#back');
    await expect(page.locator('section[data-step="0"] h1')).toBeVisible();
    await expect(page.locator('#port')).toHaveValue(String(ports.dashboard));
    await expect(page.locator('#useOllama')).toBeChecked();
    await expect(page.locator('#ollamaUrl')).toHaveValue(fake.url);

    for (let i = 0; i < 3; i++) await page.click('#next');
    await expect(page.locator('section[data-step="3"] h1')).toBeVisible();
    await expect(page.locator('#maxConcurrent')).toHaveValue('5');
    await expect(page.locator('#maxAttempts')).toHaveValue('7');
    await expect(page.locator('#ingestPort')).toHaveValue(String(ports.ingest));
  });

  test('E6 going back to break the port makes Save disabled and the note names the Basics step', async ({ launch, fake }, testInfo) => {
    const { app, page } = await launch();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), await freePorts());

    for (let i = 0; i < 3; i++) await page.click('#back');
    await expect(page.locator('section[data-step="0"] h1')).toBeVisible();
    await page.fill('#port', '0');
    await expect(page.locator('.msg[data-key="port"]')).toHaveText('Enter a port from 1 to 65535.');
    // Continue on Basics is blocked while the port is invalid, so the wizard cannot move forward
    // from here by clicking. Step 4 is then reached by calling the wizard's own goTo().
    await expect(page.locator('#next')).toBeDisabled();
    await page.evaluate('goTo(3)');

    await expect(page.locator('section[data-step="3"] h1')).toBeVisible();
    await expect(page.locator('#save')).toBeDisabled();
    await expect(page.locator('#stepNote')).toContainText('The Basics step needs attention before you can save');
  });

  test('E7 happy path writes the chosen settings to .env and opens a dashboard window', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT);
    const { app, page, envPath } = await launch();
    const ports = await freePorts();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), ports, { ollamaModel: 'qwen3:14b' });
    const dataDir = testInfo.outputPath('data');

    const dashboardOpened = app.waitForEvent('window', { timeout: SAVE_TIMEOUT });
    await page.click('#save');
    const dashboard = await dashboardOpened;

    await expect.poll(() => new URL(dashboard.url()).port, { timeout: SAVE_TIMEOUT }).toBe(String(ports.dashboard));
    await expect.poll(() => page.isClosed()).toBe(true);

    const env = readEnv(envPath);
    expect(env).not.toBeNull();
    expect(envValue(env, 'PORT')).toBe(String(ports.dashboard));
    expect(envValue(env, 'ORCH_DATA_DIR')).toBe(dataDir);
    expect(envValue(env, 'ORCH_LLM_PROVIDERS')).toBe('ollama');
    expect(envValue(env, 'ORCH_OLLAMA_URL')).toBe(fake.url);
    expect(envValue(env, 'ORCH_OLLAMA_MODEL')).toBe('qwen3:14b');
    expect(envValue(env, 'ORCH_ERRORS_INGEST_PORT')).toBe(String(ports.ingest));
    expect(envValue(env, 'ORCH_RESOLVER_ENABLED')).toBe('1');
  });

  test('E8 a port taken after the page checked it is caught at save: message, nothing written, Save usable', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT);
    const { app, page, envPath } = await launch();
    const ports = await freePorts();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), ports);

    // Another program grabs the ingest port after the page saw it free.
    const squatter = createServer();
    await new Promise<void>((resolve) => squatter.listen(ports.ingest, '127.0.0.1', () => resolve()));
    try {
      const windowsBefore = dashboardWindows(app).length;
      await page.click('#save');

      await expect(page.locator('#status')).toHaveClass(/error/);
      // The page takes the user to the step with the problem and says it under the field.
      await expect(page.locator('section[data-step="2"] h1')).toBeVisible();
      await expect(page.locator('.msg[data-key="ingestPort"]')).toContainText('already in use');

      expect(readEnv(envPath)).toBeNull();
      expect(dashboardWindows(app).length).toBe(windowsBefore);

      // Pick another port: saving works again.
      await squatter.close();
      await page.fill('#ingestPort', String(await freePort()));
      await page.click('#next');
      await expect(page.locator('#save')).toBeEnabled();
    } finally {
      squatter.close();
    }
  });

  test('E9 double-clicking Save writes .env once and opens one dashboard window', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT);
    const { app, page, envPath } = await launch();
    const ports = await freePorts();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), ports);
    await countEnvWrites(app);

    await page.dblclick('#save');

    await expect.poll(() => dashboardWindows(app).length, { timeout: SAVE_TIMEOUT }).toBe(1);
    await expect.poll(() => page.isClosed()).toBe(true);
    // Give a second save, if one were to happen, time to show up.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    expect(dashboardWindows(app).length).toBe(1);
    expect(await envWrites(app)).toBe(1);
    expect(envValue(readEnv(envPath), 'PORT')).toBe(String(ports.dashboard));
  });

  test('E10 closing the setup window without saving quits the app and writes no .env', async ({ launch, fake }, testInfo) => {
    const { app, page, envPath } = await launch();
    await reachResolver(app, page, fake, testInfo.outputPath('data'), await freePorts());

    const quit = app.waitForEvent('close', { timeout: 30_000 });
    await page.close();
    await quit;

    expect(readEnv(envPath)).toBeNull();
  });

  test('E11 launching again after a save opens the dashboard directly', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT);
    const first = await launch();
    const ports = await freePorts();
    await reachResolver(first.app, first.page, fake, testInfo.outputPath('data'), ports);

    const dashboardOpened = first.app.waitForEvent('window', { timeout: SAVE_TIMEOUT });
    await first.page.click('#save');
    await dashboardOpened;
    await expect.poll(() => first.page.isClosed(), { timeout: SAVE_TIMEOUT }).toBe(true);
    await first.app.close();

    // The first run's server must release its ports before the second launch can bind them.
    await expect.poll(() => isFree(ports.dashboard), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => isFree(ports.ingest), { timeout: 15_000 }).toBe(true);

    const second = await launch();
    await expect.poll(() => new URL(second.page.url()).port, { timeout: SAVE_TIMEOUT }).toBe(String(ports.dashboard));
    expect(second.app.windows().filter((w) => w.url().startsWith('file:')).length).toBe(0);
    await expect(second.page.locator('#save')).toHaveCount(0);
  });
});
