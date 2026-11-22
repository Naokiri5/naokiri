import { test, expect, type Page } from '@playwright/test';

/** WIN UI flow: wallet follow is persisted READ_ONLY; no automatic trade controls. */
const PW = 'e2e owner passphrase';
let page: Page;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.context().route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('/app');
  const pw = page.locator('input[type=password]');
  if (await page.getByText('Owner setup').count()) {
    await pw.nth(0).fill(PW); await pw.nth(1).fill(PW);
  } else await pw.first().fill(PW);
  await page.locator('form button').first().click();
  await expect(page.locator('h1')).toBeVisible();
});
test.afterAll(async () => { await page.close(); });

test('FAST one-wallet selection cannot enable orders or LIVE', async () => {
  await page.goto('/copy');
  await expect(page.getByRole('heading', { name: 'Whale Intelligence' })).toBeVisible();
  await expect(page.getByText('Trading remains BLOCKED')).toBeVisible();
  const wallet = '1'.repeat(32);
  await page.getByRole('textbox', { name: 'Public Solana wallet address' }).fill(wallet);
  await page.getByRole('button', { name: 'Follow (read-only)' }).click();
  await expect(page.getByRole('status')).toContainText('Wallet saved for READ-ONLY monitoring');
  await expect(page.locator('code').filter({ hasText: wallet })).toBeVisible();
  await expect(page.getByText('No finalized, provider-verified wallet swaps')).toBeVisible();
  const status = await page.request.get('/api/copy');
  expect(status.ok()).toBe(true);
  const body = await status.json();
  expect(body.status).toBe('BLOCKED');
  expect(body.win.liveExecution).toBe('LOCKED_G01_G14');
  expect(body.win.followedWallet.executionMode).toBe('READ_ONLY');
  await page.getByRole('button', { name: 'Unfollow' }).click();
  await expect(page.getByRole('status')).toContainText('Wallet follow disabled');
});

test('DEEP shows only anonymous, non-executable research', async () => {
  await page.goto('/copy');
  await page.getByRole('tab', { name: 'DEEP · Footprints' }).click();
  await expect(page.getByText('These are anonymous Binance prints')).toBeVisible();
  const research = await page.request.get('/api/whales/deep');
  expect(research.ok()).toBe(true);
  const d = await research.json();
  expect(d.status).toBe('RESEARCH_ONLY');
  expect(d.attribution).toBe('INFERRED_ENTITY');
  expect(d.executable).toBe(false);
});
