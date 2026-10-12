import { expect, freePort, OLLAMA_MODELS, test } from './fixtures';
import type { Page } from '@playwright/test';

const next = (page: Page) => page.locator('#next');
const modelSelect = (page: Page) => page.locator('#ollamaModel');
const ollamaMsg = (page: Page) => page.locator('.msg[data-key="ollamaUrl"]');
const modelsMsg = (page: Page) => page.locator('.msg[data-key="models"]');

/** Step 1 with a port that is free right now, then Continue into step 2 (Model). */
async function openModelStep(page: Page): Promise<void> {
  await page.fill('#port', String(await freePort()));
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(page.locator('section[data-step="1"] h1')).toBeVisible();
}

/**
 * Sets the Ollama address while the switch is still off. Typing it into the visible field after
 * switching on would first test the default http://localhost:11434, which tests must never hit.
 */
async function setOllamaUrlWhileOff(page: Page, value: string): Promise<void> {
  await page.locator('#ollamaUrl').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('B1 no model turned on shows "Turn on at least one model" and disables Continue', async ({ launch }) => {
  const { page } = await launch();
  await openModelStep(page);
  await expect(page.locator('#useOllama')).not.toBeChecked();
  await expect(modelsMsg(page)).toHaveClass(/\berror\b/);
  await expect(modelsMsg(page)).toContainText('Turn on at least one model');
  await expect(next(page)).toBeDisabled();
});

test('B2 Ollama on with an unreachable address shows an error naming Ollama, list and Continue disabled', async ({ launch, fake }) => {
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, fake.deadUrl);
  await page.locator('#useOllama').check();
  await expect(ollamaMsg(page)).toHaveClass(/\berror\b/);
  await expect(ollamaMsg(page)).toContainText('Ollama');
  await expect(modelSelect(page)).toBeDisabled();
  await expect(next(page)).toBeDisabled();
});

test('B3 Ollama reachable with no models shows an error with the ollama pull hint, list and Continue disabled', async ({ launch, fake }) => {
  fake.state.ollama = 'empty';
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, fake.url);
  await page.locator('#useOllama').check();
  await expect(ollamaMsg(page)).toHaveClass(/\berror\b/);
  await expect(ollamaMsg(page)).toContainText('ollama pull');
  await expect(modelSelect(page)).toBeDisabled();
  await expect(next(page)).toBeDisabled();
});

test('B4 Ollama answering HTTP 500 shows an error, list and Continue disabled', async ({ launch, fake }) => {
  fake.state.ollama = 'error';
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, fake.url);
  await page.locator('#useOllama').check();
  await expect(ollamaMsg(page)).toHaveClass(/\berror\b/);
  await expect(ollamaMsg(page)).toContainText('Ollama');
  await expect(modelSelect(page)).toBeDisabled();
  await expect(next(page)).toBeDisabled();
});

test('B5 an address that is not a full http(s) URL (localhost, ftp://x, empty) shows "Enter a full URL" and disables Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, 'localhost');
  await page.locator('#useOllama').check();
  for (const bad of ['localhost', 'ftp://x', '']) {
    await page.locator('#ollamaUrl').fill(bad);
    await expect(ollamaMsg(page)).toHaveClass(/\berror\b/);
    await expect(ollamaMsg(page)).toContainText('Enter a full URL');
    await expect(next(page)).toBeDisabled();
  }
  // Sanity check that the fake is not what made the error go away: a valid address clears it.
  await page.locator('#ollamaUrl').fill(fake.url);
  await expect(ollamaMsg(page)).not.toContainText('Enter a full URL');
});

test('B6 Ollama ok lists exactly the fake models, preselects qwen2.5-coder:7b and enables Continue', async ({ launch, fake }) => {
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, fake.url);
  await page.locator('#useOllama').check();
  await expect(modelSelect(page)).toBeEnabled();
  const values = await modelSelect(page).locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
  expect(values).toEqual(OLLAMA_MODELS);
  await expect(modelSelect(page)).toHaveValue('qwen2.5-coder:7b');
  await expect(next(page)).toBeEnabled();
});

test('B7 changing the Ollama address resets the list to disabled and keeps Continue disabled until the new test finishes', async ({ launch, fake }) => {
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, fake.url);
  await page.locator('#useOllama').check();
  await expect(modelSelect(page)).toBeEnabled();
  await expect(next(page)).toBeEnabled();

  // The reset happens on input, before the debounced test (about 600ms) runs.
  await page.locator('#ollamaUrl').fill(fake.deadUrl);
  await expect(modelSelect(page)).toBeDisabled();
  await expect(next(page)).toBeDisabled();

  // The new test finishes with an error; the list stays disabled and Continue stays blocked.
  await expect(ollamaMsg(page)).toHaveClass(/\berror\b/);
  await expect(modelSelect(page)).toBeDisabled();
  await expect(next(page)).toBeDisabled();
});

test('B8 turning Ollama off after an unreachable test removes the Ollama error and shows the no-model error', async ({ launch, fake }) => {
  const { page } = await launch();
  await openModelStep(page);
  await setOllamaUrlWhileOff(page, fake.deadUrl);
  await page.locator('#useOllama').check();
  await expect(ollamaMsg(page)).toHaveClass(/\berror\b/);

  await page.locator('#useOllama').uncheck();
  await expect(page.locator('#ollamaFields')).toBeHidden();
  await expect(ollamaMsg(page)).not.toHaveClass(/\berror\b/);
  await expect(modelsMsg(page)).toContainText('Turn on at least one model');
  await expect(modelsMsg(page)).toHaveClass(/\berror\b/);
  await expect(next(page)).toBeDisabled();
});

test('B9 the model list shows no options before a successful test: disabled with a placeholder on first load', async ({ launch }) => {
  const { page } = await launch();
  await openModelStep(page);
  await expect(modelSelect(page)).toBeDisabled();
  await expect(modelSelect(page).locator('option')).toHaveText(['Connecting to Ollama…']);
  await expect(modelSelect(page)).toHaveValue('');
});
