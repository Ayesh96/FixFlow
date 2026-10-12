import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { ElectronApplication, Page } from '@playwright/test';
import { chooseDataFolder, DEEPSEEK_MODELS, expect, freePort, GOOD_KEY, OLLAMA_MODELS, readEnv, test, type Fake, type Launched } from './fixtures';

// Section S of CASES.md: the Settings window opened from the app menu after onboarding.
//
// SAFETY: every test that saves first points the data folder at a scratch folder inside the test's
// output directory, and uses ports from freePort(). The default ~/.fixflow is never used. Ollama and
// the hosted providers point at the local fake, never at a real URL.

const SAVE_TIMEOUT = 120_000;
const STEP_NAMES = ['Basics', 'Model', 'Errors', 'Resolver'];

interface Ports {
  dashboard: number;
  ingest: number;
}

interface FirstRunOptions {
  ollamaModel?: string;
  /** Also turn DeepSeek on with GOOD_KEY and pick deepseek-v4-pro. */
  deepseek?: boolean;
  /** Changes to make on the Errors step before moving on. */
  errors?: (page: Page) => Promise<void>;
  /** Changes to make on the Resolver step before saving. */
  resolver?: (page: Page) => Promise<void>;
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

/** Dashboard windows are the ones served over http; the setup window is a file:// page. */
function dashboardWindows(app: ElectronApplication): Page[] {
  return app.windows().filter((w) => w.url().startsWith('http://'));
}

/** Which window in the main process: the dashboard (http) or the settings/setup page (file). */
type WhichWindow = 'dashboard' | 'settings';

async function getWindowBounds(app: ElectronApplication, which: WhichWindow) {
  return app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows().find((x) => (w === 'dashboard' ? x.webContents.getURL().startsWith('http://') : x.webContents.getURL().startsWith('file://')));
    if (!win) throw new Error(`no ${w} window`);
    const { x, y, width, height } = win.getBounds();
    return { x, y, width, height };
  }, which);
}

async function setWindowBounds(app: ElectronApplication, which: WhichWindow, bounds: { x: number; y: number; width: number; height: number }) {
  await app.evaluate(({ BrowserWindow }, { w, b }) => {
    const win = BrowserWindow.getAllWindows().find((x) => (w === 'dashboard' ? x.webContents.getURL().startsWith('http://') : x.webContents.getURL().startsWith('file://')));
    if (!win) throw new Error(`no ${w} window`);
    win.setBounds(b);
  }, { w: which, b: bounds });
}

/**
 * Closes a window the way the user would: BrowserWindow.close() emits 'close', which is when the
 * app saves the window's bounds. Playwright's page.close() does not emit it.
 */
async function closeWindow(app: ElectronApplication, which: WhichWindow): Promise<void> {
  await app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows().find((x) => (w === 'dashboard' ? x.webContents.getURL().startsWith('http://') : x.webContents.getURL().startsWith('file://')));
    if (!win) throw new Error(`no ${w} window`);
    win.close();
  }, which);
}

/** Opens Settings from the app menu and returns the settings window once its values are loaded. */
async function openSettings(app: ElectronApplication): Promise<Page> {
  const opened = app.waitForEvent('window', { timeout: SAVE_TIMEOUT });
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.flatMap((i) => (i.submenu ? i.submenu.items : [])).find((i) => i.label === 'Settings…')!.click());
  const settings = await opened;
  await settings.waitForLoadState('domcontentloaded');
  await expect(settings.locator('#save')).toBeEnabled({ timeout: SAVE_TIMEOUT });
  return settings;
}

/** Clicks a stepper button (only offered in settings, or in onboarding for reached steps). */
async function jumpTo(page: Page, index: number): Promise<void> {
  await page.getByRole('button', { name: `Go to step ${index + 1}: ${STEP_NAMES[index]}`, exact: true }).click();
  await expect(page.locator(`section[data-step="${index}"] h1`)).toBeVisible();
}

// ---- The first-run walk ------------------------------------------------------------------------

async function walkBasics(app: ElectronApplication, page: Page, dataDir: string, ports: Ports): Promise<void> {
  await chooseDataFolder(app, page, dataDir);
  await page.fill('#port', String(ports.dashboard));
  await expect(page.locator('.msg[data-key="port"]')).toHaveText('Free.');
  await page.click('#next');
  await expect(page.locator('section[data-step="1"] h1')).toBeVisible();
}

async function walkModel(page: Page, fake: Fake, options: FirstRunOptions): Promise<void> {
  await page.check('#useOllama');
  await page.fill('#ollamaUrl', fake.url);
  await expect(page.locator('#ollamaModel')).toBeEnabled();
  if (options.ollamaModel) await page.selectOption('#ollamaModel', options.ollamaModel);
  if (options.deepseek) {
    await page.check('#useDeepseek');
    await page.fill('#deepseekKey', GOOD_KEY);
    await expect(page.locator('#deepseekModel')).toBeEnabled({ timeout: SAVE_TIMEOUT });
    await page.selectOption('#deepseekModel', 'deepseek-v4-pro');
  }
  await page.click('#next');
  await expect(page.locator('section[data-step="2"] h1')).toBeVisible();
}

async function walkErrors(page: Page, ports: Ports, options: FirstRunOptions): Promise<void> {
  await page.fill('#ingestPort', String(ports.ingest));
  await expect(page.locator('.msg[data-key="ingestPort"]')).toHaveText('Free.');
  if (options.errors) await options.errors(page);
  await page.click('#next');
  await expect(page.locator('section[data-step="3"] h1')).toBeVisible();
}

/** Does a real first-run save and returns the dashboard window it opens. */
async function firstRun(app: ElectronApplication, page: Page, fake: Fake, dataDir: string, ports: Ports, options: FirstRunOptions = {}): Promise<Page> {
  await walkBasics(app, page, dataDir, ports);
  await walkModel(page, fake, { ollamaModel: 'qwen3:14b', ...options });
  await walkErrors(page, ports, options);
  if (options.resolver) await options.resolver(page);

  const dashboardOpened = app.waitForEvent('window', { timeout: SAVE_TIMEOUT });
  await page.click('#save');
  const dashboard = await dashboardOpened;
  await expect.poll(() => new URL(dashboard.url()).port, { timeout: SAVE_TIMEOUT }).toBe(String(ports.dashboard));
  await expect.poll(() => page.isClosed(), { timeout: SAVE_TIMEOUT }).toBe(true);
  return dashboard;
}

/** The value of KEY in a .env file, or undefined when the line is not there. */
function envValue(env: string | null, key: string): string | undefined {
  const line = env?.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

test.describe('S. Settings after onboarding', () => {
  test('S1 open settings after a first save: title and every field show the saved value', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page } = await launch();
    const ports = await freePorts();
    const dataDir = testInfo.outputPath('data');
    await firstRun(app, page, fake, dataDir, ports, {
      ollamaModel: 'qwen2.5-coder:7b',
      errors: async (p) => {
        await p.selectOption('#minLevel', 'warning');
        await p.fill('#githubLabels', 'bug,crash');
        await p.fill('#commentThresholds', '50,500');
        await p.fill('#retentionDays', '14');
      },
      resolver: async (p) => {
        await p.selectOption('#pollInterval', '900000');
        await p.fill('#maxConcurrent', '4');
        await p.fill('#maxAttempts', '5');
        await p.check('#retrySkipped');
      },
    });

    const settings = await openSettings(app);
    await expect(settings).toHaveTitle('FixFlow settings');

    await expect(settings.locator('#port')).toHaveValue(String(ports.dashboard));
    await expect(settings.locator('#dataDir')).toHaveValue(dataDir);
    await expect(settings.locator('#useOllama')).toBeChecked();
    await expect(settings.locator('#ollamaUrl')).toHaveValue(fake.url);
    await expect(settings.locator('#ollamaModel')).toHaveValue('qwen2.5-coder:7b');
    await expect(settings.locator('#ingestPort')).toHaveValue(String(ports.ingest));
    await expect(settings.locator('#githubLabels')).toHaveValue('bug,crash');
    await expect(settings.locator('#minLevel')).toHaveValue('warning');
    await expect(settings.locator('#commentThresholds')).toHaveValue('50,500');
    await expect(settings.locator('#retentionDays')).toHaveValue('14');
    await expect(settings.locator('#pollInterval')).toHaveValue('900000');
    await expect(settings.locator('#maxConcurrent')).toHaveValue('4');
    await expect(settings.locator('#maxAttempts')).toHaveValue('5');
    await expect(settings.locator('#retrySkipped')).toBeChecked();

    // The same values show on their own steps, not just in the DOM.
    await expect(settings.locator('#port')).toBeVisible();
    await expect(settings.locator('#dataDir')).toBeVisible();
    await jumpTo(settings, 2);
    await expect(settings.locator('#minLevel')).toHaveValue('warning');
    await jumpTo(settings, 3);
    await expect(settings.locator('#maxConcurrent')).toHaveValue('4');
    await expect(settings.locator('#pollInterval option:checked')).toHaveText('15 minutes');
  });

  test('S2 saved provider: switch is on, model lists load with the saved model selected, hosted key re-verified', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page } = await launch();
    const ports = await freePorts();
    await firstRun(app, page, fake, testInfo.outputPath('data'), ports, { ollamaModel: 'qwen3:14b', deepseek: true });

    const settings = await openSettings(app);
    await expect(settings.locator('#useOllama')).toBeChecked();
    await expect(settings.locator('#ollamaModel')).toBeEnabled();
    await expect(settings.locator('#ollamaModel')).toHaveValue('qwen3:14b');
    await expect(settings.locator('#ollamaModel option')).toHaveText(OLLAMA_MODELS);

    // Nothing is clicked: the saved DeepSeek key is verified by the page itself.
    await expect(settings.locator('#useDeepseek')).toBeChecked();
    await expect(settings.locator('#deepseekKey')).toHaveValue(GOOD_KEY);
    await expect(settings.locator('.msg[data-key="deepseekKey"]')).toContainText('Key accepted', { timeout: SAVE_TIMEOUT });
    await expect(settings.locator('#deepseekModel')).toBeEnabled();
    await expect(settings.locator('#deepseekModel')).toHaveValue('deepseek-v4-pro');
    await expect(settings.locator('#deepseekModel option')).toHaveText(DEEPSEEK_MODELS);
  });

  test('S3 FixFlow own running ports are not reported as busy', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page } = await launch();
    const ports = await freePorts();
    await firstRun(app, page, fake, testInfo.outputPath('data'), ports);

    // The app's own server is holding both ports right now.
    const settings = await openSettings(app);
    await expect(settings.locator('.msg[data-key="port"]')).toHaveText('Free.');
    await expect(settings.locator('.msg[data-key="ingestPort"]')).toHaveText('Free.');
    await expect(settings.locator('body')).not.toContainText('already in use');
  });

  test('S4 save is on every step: one change on step 1 saves without walking through the others', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page, envPath } = await launch();
    const ports = await freePorts();
    const dashboard = await firstRun(app, page, fake, testInfo.outputPath('data'), ports);

    const settings = await openSettings(app);
    await expect(settings.locator('section[data-step="0"] h1')).toBeVisible();
    await expect(settings.locator('#save')).toBeVisible();

    const newPort = await freePort();
    await settings.fill('#port', String(newPort));
    await expect(settings.locator('.msg[data-key="port"]')).toHaveText('Free.');
    await expect(settings.locator('#save')).toBeEnabled();
    await settings.click('#save');

    await expect.poll(() => new URL(dashboard.url()).port, { timeout: SAVE_TIMEOUT }).toBe(String(newPort));
    await expect.poll(() => settings.isClosed(), { timeout: SAVE_TIMEOUT }).toBe(true);
    expect(envValue(readEnv(envPath), 'PORT')).toBe(String(newPort));
  });

  test('S5 save new settings: .env updated, server restarted, the same dashboard window reloads, settings closes', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page, envPath } = await launch();
    const ports = await freePorts();
    const dashboard = await firstRun(app, page, fake, testInfo.outputPath('data'), ports);
    const dashboardUrl = dashboard.url();

    // A marker on the dashboard page: a reload throws it away.
    await dashboard.evaluate(() => {
      (window as unknown as { __beforeSave: boolean }).__beforeSave = true;
    });

    const settings = await openSettings(app);
    await jumpTo(settings, 3);
    await settings.fill('#maxConcurrent', '5');
    await expect(settings.locator('.msg[data-key="maxConcurrent"]')).toHaveText('');
    await expect(settings.locator('#save')).toBeEnabled();
    await settings.click('#save');

    await expect.poll(() => settings.isClosed(), { timeout: SAVE_TIMEOUT }).toBe(true);
    expect(dashboardWindows(app)).toHaveLength(1);
    expect(dashboard.isClosed()).toBe(false);
    await expect.poll(() => dashboard.evaluate(() => (window as unknown as { __beforeSave?: boolean }).__beforeSave ?? null)).toBeNull();
    expect(new URL(dashboard.url()).port).toBe(String(ports.dashboard));

    const env = readEnv(envPath);
    expect(envValue(env, 'ORCH_RESOLVER_MAX_CONCURRENT_FIXES')).toBe('5');
    expect(envValue(env, 'PORT')).toBe(String(ports.dashboard));

    // The restarted server answers at the dashboard address.
    const res = await fetch(dashboardUrl);
    expect(res.status).toBeLessThan(500);
  });

  test('S6 new settings the server will not start with: message on the page, old .env restored byte for byte, dashboard still works', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page, envPath } = await launch();
    const ports = await freePorts();
    const dashboard = await firstRun(app, page, fake, testInfo.outputPath('data'), ports);
    const dashboardUrl = dashboard.url();
    const envBefore = readFileSync(envPath);

    // A regular file where the data folder should be: the server cannot use it as a folder.
    const notAFolder = testInfo.outputPath('not-a-folder');
    writeFileSync(notAFolder, 'a regular file, not a folder\n');

    const settings = await openSettings(app);
    await chooseDataFolder(app, settings, notAFolder);
    await settings.click('#save');

    await expect(settings.locator('#status')).toHaveClass(/error/, { timeout: SAVE_TIMEOUT });
    await expect(settings.locator('#status')).toContainText('did not start', { timeout: SAVE_TIMEOUT });
    expect(settings.isClosed()).toBe(false);

    // The .env is exactly what it was before the attempt.
    expect(readFileSync(envPath).equals(envBefore)).toBe(true);

    // The dashboard window is still there and the server behind it still answers.
    expect(dashboard.isClosed()).toBe(false);
    expect(dashboardWindows(app)).toHaveLength(1);
    expect(new URL(dashboard.url()).port).toBe(String(ports.dashboard));
    const res = await fetch(dashboardUrl);
    expect(res.status).toBeLessThan(500);
  });

  test('S7 break a field while editing: Save disabled and the message sits under the field', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page } = await launch();
    const ports = await freePorts();
    await firstRun(app, page, fake, testInfo.outputPath('data'), ports);

    const settings = await openSettings(app);
    await settings.fill('#port', '0');
    await expect(settings.locator('.msg[data-key="port"]')).toHaveText('Enter a port from 1 to 65535.');
    await expect(settings.locator('.msg[data-key="port"]')).toHaveClass(/error/);
    await expect(settings.locator('#port')).toHaveClass(/invalid/);
    await expect(settings.locator('#save')).toBeDisabled();

    // Restore the port (FixFlow's own, so it reads as free) before moving on.
    await settings.fill('#port', String(ports.dashboard));
    await expect(settings.locator('.msg[data-key="port"]')).toHaveText('Free.');
    await expect(settings.locator('#save')).toBeEnabled();

    // The same rule on another step.
    await jumpTo(settings, 3);
    await settings.fill('#maxConcurrent', '0');
    await expect(settings.locator('.msg[data-key="maxConcurrent"]')).toHaveText('Enter a whole number, 1 or more.');
    await expect(settings.locator('.msg[data-key="maxConcurrent"]')).toHaveClass(/error/);
    await expect(settings.locator('#save')).toBeDisabled();

    await settings.fill('#maxConcurrent', '3');
    await expect(settings.locator('.msg[data-key="maxConcurrent"]')).toHaveText('');
    await expect(settings.locator('#save')).toBeEnabled();
  });

  test('S8 stepper: every step is clickable in settings; in onboarding only reached steps are', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 2);
    const { app, page } = await launch();
    const ports = await freePorts();
    const dataDir = testInfo.outputPath('data');

    // Onboarding: on the first step no other step is clickable yet.
    await expect(page.locator('#stepper button.jump')).toHaveCount(0);
    await walkBasics(app, page, dataDir, ports);
    // On step 2, only Basics (already reached) is clickable; Errors and Resolver are not.
    await expect(page.locator('#stepper button.jump')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Go to step 3: Errors', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Go to step 4: Resolver', exact: true })).toHaveCount(0);

    await walkModel(page, fake, { ollamaModel: 'qwen3:14b' });
    await walkErrors(page, ports, {});
    await expect(page.locator('#stepper button.jump')).toHaveCount(3);
    await jumpTo(page, 0);
    await expect(page.locator('#stepper button.jump')).toHaveCount(3);
    // Finish the first run from the last step.
    await jumpTo(page, 3);
    const dashboardOpened = app.waitForEvent('window', { timeout: SAVE_TIMEOUT });
    await page.click('#save');
    const dashboard = await dashboardOpened;
    await expect.poll(() => new URL(dashboard.url()).port, { timeout: SAVE_TIMEOUT }).toBe(String(ports.dashboard));
    await expect.poll(() => page.isClosed(), { timeout: SAVE_TIMEOUT }).toBe(true);

    // Settings: every other step can be opened directly, and Save stays on each one.
    const settings = await openSettings(app);
    await expect(settings.locator('#stepper button.jump')).toHaveCount(3);
    await jumpTo(settings, 3);
    await expect(settings.locator('#save')).toBeVisible();
    await jumpTo(settings, 2);
    await expect(settings.locator('#save')).toBeVisible();
    await jumpTo(settings, 1);
    await expect(settings.locator('#useOllama')).toBeVisible();
    await expect(settings.locator('#save')).toBeVisible();
    await jumpTo(settings, 0);
    await expect(settings.locator('#port')).toBeVisible();
    await expect(settings.locator('#save')).toBeVisible();
  });

  test('S9 window size and position are remembered across launches, setup and dashboard separately', async ({ launch, fake }, testInfo) => {
    test.setTimeout(SAVE_TIMEOUT * 3);
    const first = await launch();
    const ports = await freePorts();
    const dashboard = await firstRun(first.app, first.page, fake, testInfo.outputPath('data'), ports);

    const SETUP_BOUNDS = { x: 240, y: 200, width: 600, height: 640 };
    const DASHBOARD_BOUNDS = { x: 160, y: 140, width: 1000, height: 700 };

    // Move and resize the settings window, then close it.
    const settings = await openSettings(first.app);
    await setWindowBounds(first.app, 'settings', SETUP_BOUNDS);
    await closeWindow(first.app, 'settings');
    await expect.poll(() => settings.isClosed(), { timeout: 15_000 }).toBe(true);

    // Move and resize the dashboard, then close it: that quits the app.
    await setWindowBounds(first.app, 'dashboard', DASHBOARD_BOUNDS);
    const quit = first.app.waitForEvent('close', { timeout: 60_000 });
    await closeWindow(first.app, 'dashboard');
    await quit;
    await expect.poll(() => isFree(ports.dashboard), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => isFree(ports.ingest), { timeout: 15_000 }).toBe(true);

    // Launch again: the dashboard opens at its own remembered bounds.
    const second = await launch();
    await expect.poll(() => new URL(second.page.url()).port, { timeout: SAVE_TIMEOUT }).toBe(String(ports.dashboard));
    expect(await getWindowBounds(second.app, 'dashboard')).toMatchObject(DASHBOARD_BOUNDS);

    // Then the settings window opens at its own remembered bounds, not the dashboard's.
    await openSettings(second.app);
    expect(await getWindowBounds(second.app, 'settings')).toMatchObject(SETUP_BOUNDS);
    expect(await getWindowBounds(second.app, 'dashboard')).toMatchObject(DASHBOARD_BOUNDS);
  });
});
