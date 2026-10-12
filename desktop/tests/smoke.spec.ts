import { expect, test } from './fixtures';

test('opens on the Basics step with every switch off and Continue available once the port is free', async ({ launch }) => {
  const { page } = await launch();
  await expect(page.locator('section[data-step="0"] h1')).toHaveText('Where FixFlow runs');
  await expect(page.locator('#useOllama')).not.toBeChecked();
  await expect(page.locator('#errorsEnabled')).toHaveCount(0);
  await expect(page.locator('#resolverEnabled')).toHaveCount(0);
  await expect(page.locator('#next')).toBeEnabled();
});

test('choosing a data folder through the stubbed dialog fills the field', async ({ launch }, testInfo) => {
  const { chooseDataFolder } = await import('./fixtures');
  const { app, page } = await launch();
  const dir = testInfo.outputPath('data');
  await chooseDataFolder(app, page, dir);
  await expect(page.locator('#dataDir')).toHaveValue(dir);
});
