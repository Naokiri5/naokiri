import { test, expect, type Page } from '@playwright/test';

/**
 * Privy-mode sign-in screen. The e2e server runs offline in explicit passphrase mode, so these tests answer
 * /api/auth/state with a Privy-mode reply and block Privy's hosts: they check MIA's own screen (no passphrase fields,
 * honest states), not Privy's hosted login, which needs a real Privy app and network.
 */
const privyState = (privy: Record<string, unknown>) => ({
  mode: 'privy', setup: false, authenticated: false, setupCodeRequired: false,
  privy: { enabled: false, appId: null, linked: false, ownerConfigured: false, embeddedWallets: false, walletActions: 'LOCKED', ...privy },
});
async function mockState(page: Page, body: unknown) {
  await page.route('**/api/auth/state', (r) => r.fulfill({ json: body }));
  await page.route(/https:\/\/([a-z0-9-]+\.)*(privy\.io|walletconnect\.(com|org)|web3modal\.org)\//, (r) => r.abort());
}

test('Privy mode never shows the passphrase setup form; unconfigured server explains the administrator steps', async ({ page }) => {
  await mockState(page, privyState({}));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to MIA' })).toBeVisible();
  await expect(page.getByText('Your AI Trading Command Center')).toBeVisible();
  await expect(page.getByText("Sign-in isn't configured on this MIA server yet.")).toBeVisible();
  await expect(page.getByText(/MIA_PRIVY_APP_ID=/)).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText(/Owner setup|Create owner|Confirm/)).toHaveCount(0);
});

test('configured Privy shows only the Privy sign-in button (no fake bypass to the dashboard)', async ({ page }) => {
  await mockState(page, privyState({ enabled: true, appId: 'cmtestprivyapp00000000001' }));
  await page.goto('/');
  const button = page.getByRole('button', { name: /Continue with Privy|Loading Privy/ });
  await expect(button).toBeVisible();
  await expect(page.getByText(/After you sign in, MIA shows your Privy user id/)).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  // With Privy's hosts blocked the SDK never becomes ready: the button stays disabled rather than letting anyone in.
  await expect(button).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
});

test('an unreachable server is reported as such, with a retry, never as "signed out" or an open dashboard', async ({ page }) => {
  await page.route('**/api/auth/state', (r) => r.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByText("Can't reach the MIA server.")).toBeVisible();
  await expect(page.getByText(/port 8787/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  await page.unroute('**/api/auth/state');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("Can't reach the MIA server.")).toHaveCount(0);
});

test('a server error on the sign-in check is shown as a server error, not as a network outage', async ({ page }) => {
  await page.route('**/api/auth/state', (r) => r.fulfill({ status: 500, json: { error: 'internal server error' } }));
  await page.goto('/');
  await expect(page.getByText('The MIA server answered with an error.')).toBeVisible();
  await expect(page.getByText(/internal server error/)).toBeVisible();
});

test('the Privy sign-in screen fits a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await mockState(page, privyState({ enabled: true, appId: 'cmtestprivyapp00000000001', ownerConfigured: true }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to MIA' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
