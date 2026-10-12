import type { Page } from '@playwright/test';
import { ANTHROPIC_MODELS, DEEPSEEK_MODELS, GOOD_KEY, expect, test } from './fixtures';

// Section C of CASES.md: the hosted model providers (DeepSeek and Anthropic) on wizard step 2.
// Every case runs once per provider. Only the fake provider answers; no real key or URL is used.

interface Provider {
  name: string;
  box: string;
  key: string;
  keyField: string;
  verify: string;
  model: string;
  urlEnv: string;
  models: string[];
}

const PROVIDERS: Provider[] = [
  {
    name: 'DeepSeek',
    box: '#useDeepseek',
    key: '#deepseekKey',
    keyField: 'deepseekKey',
    verify: '#verifyDeepseek',
    model: '#deepseekModel',
    urlEnv: 'ORCH_DEEPSEEK_API_URL',
    models: DEEPSEEK_MODELS,
  },
  {
    name: 'Anthropic',
    box: '#useAnthropic',
    key: '#anthropicKey',
    keyField: 'anthropicKey',
    verify: '#verifyAnthropic',
    model: '#anthropicModel',
    urlEnv: 'ORCH_ANTHROPIC_API_URL',
    models: ANTHROPIC_MODELS,
  },
];

const otherProvider = (p: Provider): Provider => PROVIDERS.find((x) => x !== p)!;
const fieldMsg = (page: Page, field: string) => page.locator(`.msg[data-key="${field}"]`);
const continueButton = (page: Page) => page.locator('#next');

/** Clicks Continue on step 1 once it is enabled, and waits for the Model step to show. */
async function openModelStep(page: Page) {
  await expect(continueButton(page)).toBeEnabled();
  await continueButton(page).click();
  await expect(page.locator('section[data-step="1"] h1')).toBeVisible();
}

test.describe('Step 2: hosted models', () => {
  for (const p of PROVIDERS) {
    test(`C1 ${p.name}: turned on with an empty key asks to verify the key and blocks Continue`, async ({ launch }) => {
      const { page } = await launch();
      await openModelStep(page);
      await page.locator(p.box).check();
      await expect(fieldMsg(page, p.keyField)).toContainText(`Enter your ${p.name} API key`);
      await expect(page.locator(p.model)).toBeDisabled();
      await expect(continueButton(page)).toBeDisabled();
    });

    test(`C2 ${p.name}: a wrong key is rejected in words, list stays disabled and Continue is blocked`, async ({ launch }) => {
      const { page } = await launch();
      await openModelStep(page);
      await page.locator(p.box).check();
      await page.locator(p.key).fill('sk-wrong');
      await page.locator(p.verify).click();
      await expect(fieldMsg(page, p.keyField)).toContainText(`${p.name} rejected this key`);
      await expect(page.locator(p.model)).toBeDisabled();
      await expect(continueButton(page)).toBeDisabled();
    });

    test(`C3 ${p.name}: an unreachable provider is reported and Continue is blocked`, async ({ launch, fake }) => {
      const { page } = await launch({ env: { [p.urlEnv]: fake.deadUrl } });
      await openModelStep(page);
      await page.locator(p.box).check();
      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(fieldMsg(page, p.keyField)).toContainText(`Could not reach ${p.name}`);
      await expect(page.locator(p.model)).toBeDisabled();
      await expect(continueButton(page)).toBeDisabled();
    });

    test(`C4 ${p.name}: the right key loads exactly the provider's models and enables Continue`, async ({ launch }) => {
      const { page } = await launch();
      await openModelStep(page);
      await page.locator(p.box).check();
      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(page.locator(p.model)).toBeEnabled();
      await expect(page.locator(`${p.model} option`)).toHaveText(p.models);
      await expect(continueButton(page)).toBeEnabled();
    });

    test(`C5 ${p.name}: editing the key after a good check resets the list and blocks Continue until verified again`, async ({ launch }) => {
      const { page } = await launch();
      await openModelStep(page);
      await page.locator(p.box).check();
      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(continueButton(page)).toBeEnabled();

      await page.locator(p.key).fill(`${GOOD_KEY}x`);
      await expect(page.locator(p.model)).toBeDisabled();
      await expect(continueButton(page)).toBeDisabled();

      // Let the automatic check (about 700ms after typing) run on the edited key; it must still block.
      await page.waitForTimeout(1200);
      await expect(page.locator(p.model)).toBeDisabled();
      await expect(continueButton(page)).toBeDisabled();

      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(continueButton(page)).toBeEnabled();
    });

    test(`C6 ${p.name}: a slow check shows "Checking the key" and Continue waits for the answer`, async ({ launch, fake }) => {
      fake.state.hostedDelayMs = 3000;
      const { page } = await launch();
      await openModelStep(page);
      await page.locator(p.box).check();
      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(fieldMsg(page, p.keyField)).toContainText('Checking the key');
      await expect(page.locator(p.model)).toBeDisabled();
      await expect(continueButton(page)).toBeDisabled();
      await expect(continueButton(page)).toBeEnabled();
      await expect(page.locator(`${p.model} option`)).toHaveText(p.models);
    });

    test(`C7 ${p.name}: the key is in a password field and its text appears nowhere else on the page`, async ({ launch }) => {
      const { page } = await launch();
      await openModelStep(page);
      await page.locator(p.box).check();
      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(page.locator(p.model)).toBeEnabled();

      await expect(page.locator(p.key)).toHaveAttribute('type', 'password');
      const html = await page.content();
      expect(html).not.toContain(GOOD_KEY);
      const visibleText = await page.locator('body').innerText();
      expect(visibleText).not.toContain(GOOD_KEY);
      const otherValues = await page.evaluate((keyId) =>
        [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => el.id !== keyId.slice(1))
          .map((el) => (el as HTMLInputElement).value),
      p.key);
      expect(otherValues.filter((v) => v.includes(GOOD_KEY))).toEqual([]);
    });

    test(`C8 ${p.name}: with two providers verified the order list appears and moving a provider changes the order`, async ({ launch }) => {
      const other = otherProvider(p);
      const { page } = await launch();
      await openModelStep(page);

      await page.locator(other.box).check();
      await page.locator(other.key).fill(GOOD_KEY);
      await page.locator(other.verify).click();
      await expect(page.locator(other.model)).toBeEnabled();

      await page.locator(p.box).check();
      await page.locator(p.key).fill(GOOD_KEY);
      await page.locator(p.verify).click();
      await expect(page.locator(p.model)).toBeEnabled();

      await expect(page.locator('#providerOrderBox')).toBeVisible();
      const rows = page.locator('#providerList > li > span');
      await expect(rows).toHaveText(['1. DeepSeek', '2. Anthropic']);

      // First row: Up is disabled. Last row: Down is disabled.
      await expect(page.getByRole('button', { name: 'Move DeepSeek up' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Move Anthropic down' })).toBeDisabled();

      // Move this provider one place and check the order really changed.
      const direction = p.name === 'DeepSeek' ? 'down' : 'up';
      await page.getByRole('button', { name: `Move ${p.name} ${direction}` }).click();
      await expect(rows).toHaveText(['1. Anthropic', '2. DeepSeek']);
      await expect(page.getByRole('button', { name: 'Move Anthropic up' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Move DeepSeek down' })).toBeDisabled();
    });

    test(`C9 ${p.name}: turning a broken provider off clears its error and Continue works with the other provider`, async ({ launch }) => {
      const other = otherProvider(p);
      const { page } = await launch();
      await openModelStep(page);

      await page.locator(other.box).check();
      await page.locator(other.key).fill(GOOD_KEY);
      await page.locator(other.verify).click();
      await expect(page.locator(other.model)).toBeEnabled();

      await page.locator(p.box).check();
      await page.locator(p.key).fill('sk-wrong');
      await page.locator(p.verify).click();
      await expect(fieldMsg(page, p.keyField)).toContainText(`${p.name} rejected this key`);
      await expect(continueButton(page)).toBeDisabled();

      await page.locator(p.box).uncheck();
      await expect(fieldMsg(page, p.keyField)).toHaveText('');
      await expect(continueButton(page)).toBeEnabled();
    });
  }
});
