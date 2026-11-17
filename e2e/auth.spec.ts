import { test, expect } from '@playwright/test';

/**
 * SEC-SETUP UI contract: when the server says a setup code is required (browser not on the MIA machine), the setup form
 * asks for it, explains where to find it, and sends it. The server side is covered by server/test/auth-setup.test.ts;
 * here the API is mocked so this spec does not depend on, or change, the shared e2e server's owner.
 */
test('remote owner setup asks for the one-time code and sends it', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/auth/state', (r) => r.fulfill({ json: { setup: false, authenticated: false, setupCodeRequired: true } }));
  let sent: any = null;
  await page.route('**/api/auth/setup', async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ status: 403, json: { error: 'first-time setup from another device needs the one-time setup code' } }); });
  await page.goto('/');
  await expect(page.getByText('Owner setup')).toBeVisible();
  const code = page.getByLabel('Setup code');
  await expect(code).toBeVisible();
  await expect(page.getByText(/printed in the MIA server console/)).toBeVisible();
  const pws = page.locator('input[type=password]'); await pws.nth(0).fill('remote owner passphrase'); await pws.nth(1).fill('remote owner passphrase');
  await code.fill('ABCDE-FGHJK-LMNPQ-RSTUV');
  await page.getByRole('button', { name: 'Create owner' }).click();
  await expect(page.getByText(/needs the one-time setup code/)).toBeVisible();
  expect(sent).toEqual({ password: 'remote owner passphrase', setupCode: 'ABCDE-FGHJK-LMNPQ-RSTUV' });
});

test('local owner setup has no setup-code field', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/auth/state', (r) => r.fulfill({ json: { setup: false, authenticated: false, setupCodeRequired: false } }));
  await page.goto('/');
  await expect(page.getByText('Owner setup')).toBeVisible();
  await expect(page.getByLabel('Setup code')).toHaveCount(0);
});
