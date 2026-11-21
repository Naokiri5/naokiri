import { test, expect } from '@playwright/test';
const state = (appId: string | null) => ({
  mode: 'privy', setup: false, authenticated: false,
  privy: {
    enabled: !!appId, appId, linked: false,
    ownerConfigured: !!appId, embeddedWallets: false,
    walletActions: 'LOCKED',
  },
});

test('production wallet-only mode never renders the old passphrase form', async ({ page }) => {
  await page.route('**/api/auth/state', route => route.fulfill({
    json: state('cmtestprivyapp00000000001'),
  }));
  await page.route(/https:\/\/([a-z0-9-]+\.)*(privy\.io|walletconnect\.(com|org))\//,
    route => route.abort());
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect wallet with Privy|Loading Privy/ })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText('Owner setup')).toHaveCount(0);
});

test('missing Privy configuration never falls back to owner passphrase', async ({ page }) => {
  await page.route('**/api/auth/state', route => route.fulfill({ json: state(null) }));
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Privy setup required' })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
});
