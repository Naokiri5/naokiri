import { test, expect } from '@playwright/test';

/**
 * SEC-SETUP UI contract: when the server says a setup code is required, the setup form
 * asks for it, explains where to find it, and sends it. The server side is covered by server/test/auth-setup.test.ts;
 * here the API is mocked so this spec does not depend on, or change, the shared e2e server's owner.
 */
test('first owner setup asks for the one-time code and sends it', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/auth/state', (r) => r.fulfill({ json: { setup: false, authenticated: false, setupCodeRequired: true } }));
  let sent: any = null;
  await page.route('**/api/auth/setup', async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ status: 403, json: { error: 'first-time setup needs the one-time setup code' } }); });
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

test('existing owner sign-in has no setup-code field', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/auth/state', (r) => r.fulfill({ json: { setup: true, authenticated: false, setupCodeRequired: false } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel('Setup code')).toHaveCount(0);
});

test('a malformed /api/shell response never blanks the app (CodeRabbit PR #9)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/**', (r) => r.fulfill({ json: {} })); // every other API answers 200 {} (stays "signed in")
  await page.route('**/api/stream', (r) => r.abort());
  await page.route('**/api/auth/state', (r) => r.fulfill({ json: { setup: true, authenticated: true } }));
  await page.route('**/api/shell', (r) => r.fulfill({ json: {} })); // HTTP 200 without control/dataHealth
  const shell = page.waitForResponse('**/api/shell');
  await page.goto('/');
  await shell; await page.waitForLoadState('networkidle'); // the shell response arrived and was rendered
  await expect(page.getByRole('group', { name: 'Autopilot status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible(); // the whole shell is still mounted
  await expect(page.getByRole('group', { name: 'Autopilot status' }).locator('[data-seg=engine]')).not.toHaveAttribute('data-tone', 'ok');
  expect(errors.filter((e) => /Cannot read properties of undefined/.test(e))).toEqual([]);
});
