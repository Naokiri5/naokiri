import { test, expect } from '@playwright/test';

const PW = 'e2e owner passphrase';
test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  const state = await (await page.request.get('/api/auth/state')).json();
  expect((await page.request.post(state.setup ? '/api/auth/login' : '/api/auth/setup', { data: { password: PW } })).status()).toBe(200);
});

test('Prediction Markets lives under AI Intelligence and states it is research only', async ({ page }) => {
  await page.goto('/prediction');
  await expect(page.getByRole('heading', { name: 'Prediction Markets' })).toBeVisible();
  await expect(page.getByText(/MIA has no prediction-market order path/)).toBeVisible();
  // Offline e2e server: the venue list cannot load, and the page says so instead of inventing markets.
  await expect(page.getByText(/No markets|unavailable|offline/i).first()).toBeVisible();
});

test('the sample book replay runs end to end and labels its result hypothetical', async ({ page }) => {
  await page.goto('/prediction');
  await page.getByRole('tab', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: 'Run hypothetical replay' }).click();
  await expect(page.getByText('Result (hypothetical)')).toBeVisible();
  await expect(page.getByText(/resolution 1/)).toBeVisible();
  await expect(page.getByText(/Resting quotes fill only when the next snapshot trades strictly through them/)).toBeVisible();
});

test('the Kelly calculator explains that the probability is the owner\'s own estimate', async ({ page }) => {
  await page.goto('/prediction');
  await page.getByRole('tab', { name: 'Calculators' }).click();
  await page.getByRole('button', { name: 'Calculate' }).first().click();
  await expect(page.getByText(/stake/)).toBeVisible();
  await expect(page.getByText(/Uses YOUR belief/)).toBeVisible();
});
