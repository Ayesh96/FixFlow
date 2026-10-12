import { chooseDataFolder, expect, freePort, occupyPort, test, type Fake } from './fixtures';
import type { Page } from '@playwright/test';

const ERR_RANGE = 'Enter a port from 1 to 65535.';
const BUSY = 'Another program is using this port';

/** A free port that is not in `avoid`, so two port fields never clash by accident. */
async function distinctFreePort(avoid: number[]): Promise<number> {
  for (;;) {
    const p = await freePort();
    if (!avoid.includes(p)) return p;
  }
}

/**
 * Passes Basics (a free dashboard port) and the Model step (Ollama on, pointed at the fake), then
 * lands on the Errors step (section data-step=2) with a free ingest port, so Continue is enabled.
 */
async function reachErrorsStep(page: Page, fake: Fake): Promise<{ dashboard: number; ingest: number }> {
  const dashboard = await freePort();
  await page.fill('#port', String(dashboard));
  await expect(page.locator('#next')).toBeEnabled();
  await page.click('#next');

  await page.check('#useOllama');
  await page.fill('#ollamaUrl', fake.url);
  await expect(page.locator('#ollamaModel')).toBeEnabled();
  await expect(page.locator('#next')).toBeEnabled();
  await page.click('#next');

  await expect(page.locator('section[data-step="2"] h1')).toBeVisible();
  const ingest = await distinctFreePort([dashboard]);
  await page.fill('#ingestPort', String(ingest));
  await expect(page.locator('#next')).toBeEnabled();
  return { dashboard, ingest };
}

// ---- A. Step 1: Basics ------------------------------------------------------------------------

test('A1 dashboard port empty shows an error, blocks Continue and marks the Basics step', async ({ launch }) => {
  const { page } = await launch();
  await page.fill('#port', '');
  await expect(page.locator('.msg[data-key="port"]')).toHaveText(ERR_RANGE);
  await expect(page.locator('.msg[data-key="port"]')).toHaveClass(/error/);
  await expect(page.locator('#next')).toBeDisabled();
  await expect(page.locator('#stepper')).toContainText('Basics (needs attention)');
});

test('A2 dashboard port 0, 65536, -1, 1.5 or abc shows the same error and blocks Continue', async ({ launch }) => {
  const { page } = await launch();
  for (const value of ['0', '65536', '-1', '1.5']) {
    await page.fill('#port', value);
    await expect.soft(page.locator('.msg[data-key="port"]'), `port ${value}`).toHaveText(ERR_RANGE);
    await expect.soft(page.locator('#next'), `port ${value}`).toBeDisabled();
    await expect.soft(page.locator('#stepper'), `port ${value}`).toContainText('Basics (needs attention)');
  }
  // A number input drops letters as they are typed, so the page only ever sees an empty value.
  await page.locator('#port').evaluate((el: HTMLInputElement) => {
    el.value = 'abc';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.soft(page.locator('.msg[data-key="port"]'), 'port abc').toHaveText(ERR_RANGE);
  await expect.soft(page.locator('#next'), 'port abc').toBeDisabled();
});

test('A3 dashboard port held by another program shows a message in words and blocks Continue', async ({ launch }) => {
  const { page } = await launch();
  const busy = await occupyPort();
  try {
    await page.fill('#port', String(busy.port));
    await expect(page.locator('.msg[data-key="port"]')).toContainText(BUSY);
    await expect(page.locator('.msg[data-key="port"]')).toHaveClass(/error/);
    await expect(page.locator('#next')).toBeDisabled();
  } finally {
    await busy.close();
  }
});

test('A4 fixing the dashboard port after A1 to A3 clears the error and the needs-attention mark', async ({ launch }) => {
  const { page } = await launch();
  const busy = await occupyPort();
  try {
    await page.fill('#port', '');
    await expect(page.locator('.msg[data-key="port"]')).toHaveText(ERR_RANGE);
    await page.fill('#port', String(busy.port));
    await expect(page.locator('.msg[data-key="port"]')).toContainText(BUSY);
    await expect(page.locator('#next')).toBeDisabled();

    await page.fill('#port', String(await freePort()));
    await expect(page.locator('.msg[data-key="port"]')).toHaveText('Free.');
    await expect(page.locator('.msg[data-key="port"]')).not.toHaveClass(/error/);
    await expect(page.locator('#port')).not.toHaveClass(/invalid/);
    // Only the Basics item is checked: Model correctly still needs a model switched on.
    await expect(page.locator('#stepper li').first()).not.toContainText('needs attention');
    await expect(page.locator('#next')).toBeEnabled();
  } finally {
    await busy.close();
  }
});

test('A5 typing into the data folder field changes nothing; only Choose folder changes it', async ({ launch }, testInfo) => {
  const { app, page } = await launch();
  const dataDir = page.locator('#dataDir');
  const before = await dataDir.inputValue();

  await dataDir.click();
  await page.keyboard.type('/should/not/appear');
  await expect(dataDir).toHaveValue(before);
  await expect(page.locator('.msg[data-key="dataDir"]')).toHaveText('');

  const picked = testInfo.outputPath('data');
  await chooseDataFolder(app, page, picked);
  await expect(dataDir).toHaveValue(picked);
});

test('A6 cancelling the folder dialog keeps the old folder and shows no error', async ({ launch }, testInfo) => {
  const { app, page } = await launch();
  const first = testInfo.outputPath('first');
  await chooseDataFolder(app, page, first);
  await expect(page.locator('#dataDir')).toHaveValue(first);

  await app.evaluate(({ dialog }) => {
    const g = globalThis as { __picks?: number };
    dialog.showOpenDialog = (async () => {
      g.__picks = (g.__picks ?? 0) + 1;
      return { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
  });
  await page.click('#chooseFolder');
  await expect.poll(() => app.evaluate(() => (globalThis as { __picks?: number }).__picks ?? 0)).toBe(1);

  await expect(page.locator('#dataDir')).toHaveValue(first);
  await expect(page.locator('.msg[data-key="dataDir"]')).toHaveText('');
  await expect(page.locator('#status')).not.toHaveClass(/error/);
  await expect(page.locator('#next')).toBeEnabled();
});

test('A7 Continue moves focus to the heading of the next step', async ({ launch }) => {
  const { page } = await launch();
  await page.fill('#port', String(await freePort()));
  await expect(page.locator('#next')).toBeEnabled();
  await page.click('#next');

  const heading = page.locator('section[data-step="1"] h1');
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Choose a model');
});

// ---- D. Step 3: Errors ------------------------------------------------------------------------

test('D1 the Errors step has no on/off switch and its fields are always shown', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  await expect(page.locator('#errorsEnabled')).toHaveCount(0);
  await expect(page.locator('section[data-step="2"] input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('#errorsFields')).toBeVisible();
  await expect(page.locator('#ingestPort')).toBeVisible();
  await expect(page.locator('#retentionDays')).toBeVisible();
});

test('D2 ingest port equal to the dashboard port is refused and blocks Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  const { dashboard } = await reachErrorsStep(page, fake);

  await page.fill('#ingestPort', String(dashboard));
  await expect(page.locator('.msg[data-key="ingestPort"]')).toHaveText('Must differ from the dashboard port.');
  await expect(page.locator('.msg[data-key="ingestPort"]')).toHaveClass(/error/);
  await expect(page.locator('#next')).toBeDisabled();
});

test('D3 ingest port busy, 0 or 70000 shows an error and blocks Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  const busy = await occupyPort();
  try {
    await page.fill('#ingestPort', String(busy.port));
    await expect.soft(page.locator('.msg[data-key="ingestPort"]'), 'busy').toContainText(BUSY);
    await expect.soft(page.locator('#next'), 'busy').toBeDisabled();
  } finally {
    await busy.close();
  }

  await page.fill('#ingestPort', '0');
  await expect.soft(page.locator('.msg[data-key="ingestPort"]'), 'port 0').toHaveText(ERR_RANGE);
  await expect.soft(page.locator('#next'), 'port 0').toBeDisabled();

  await page.fill('#ingestPort', '70000');
  await expect.soft(page.locator('.msg[data-key="ingestPort"]'), 'port 70000').toHaveText(ERR_RANGE);
  await expect.soft(page.locator('#next'), 'port 70000').toBeDisabled();
});

test('D4 "Any machine on the network" shows a warning in words and does not block Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  await page.selectOption('#ingestHost', '0.0.0.0');
  const msg = page.locator('.msg[data-key="ingestHost"]');
  await expect(msg).toContainText('Anyone on your network can send error reports');
  await expect(msg).toHaveClass(/warn/);
  await expect(msg).not.toHaveClass(/error/);
  await expect(page.locator('#next')).toBeEnabled();
});

test('D5 retention of -1, empty or 1.5 days shows an error and blocks Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  for (const value of ['-1', '', '1.5']) {
    await page.fill('#retentionDays', value);
    await expect.soft(page.locator('.msg[data-key="retentionDays"]'), `retention "${value}"`).toHaveText('Enter a whole number, 0 or more.');
    await expect.soft(page.locator('#next'), `retention "${value}"`).toBeDisabled();
  }
});

test('D6 comment counts that are not whole numbers of 2 or more show an error before Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  // Expected: the page refuses every value the server would refuse, so each one shows an error.
  for (const value of ['abc', '100,,200', '1', '100,1']) {
    await page.fill('#commentThresholds', value);
    await expect.soft(page.locator('.msg[data-key="commentThresholds"]'), `counts "${value}"`).toHaveClass(/error/);
    await expect.soft(page.locator('#next'), `counts "${value}"`).toBeDisabled();
  }
});

test('D7 Generate key fills the access key with 24 hex characters that are readable on screen', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  await page.click('#generateDsn');
  const key = page.locator('#dsnKey');
  await expect(key).toHaveValue(/^[0-9a-f]{24}$/);
  await expect(key).toBeVisible();
  await expect(key).toHaveAttribute('type', 'text');
});

test('D8 the lowest level list is debug, info, warning, error, fatal with error selected', async ({ launch, fake }) => {
  const { page } = await launch();
  await reachErrorsStep(page, fake);

  const select = page.locator('#minLevel');
  await expect(select).toBeEnabled();
  await expect(page.locator('#minLevel option')).toHaveText(['debug', 'info', 'warning', 'error', 'fatal']);
  await expect(select).toHaveValue('error');
});
