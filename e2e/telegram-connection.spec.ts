import { expect, test } from '@playwright/test';

const password = 'e2e owner passphrase';

test('owner can pair and unlink Telegram from the Connections Hub', async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const auth = await (await page.request.get('/api/auth/state')).json();
  const session = await page.request.post(auth.setup ? '/api/auth/login' : '/api/auth/setup', { data: { password } });
  expect(session.ok()).toBe(true);

  // Keep the browser test independent of Telegram credentials and network access.
  let configured = false;
  let linked = false;
  let expiresAt: number | null = null;
  await page.route('**/api/integrations/telegram/status', route => route.fulfill({ json: {
    webhookEnabled: configured,
    botTokenConfigured: configured,
    link: { linked, pendingCode: expiresAt !== null, pendingExpiresAt: expiresAt },
  } }));
  await page.route('**/api/integrations/telegram/link/start', route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ password });
    expect(route.request().headers()['x-mia-csrf']).toBe('1');
    expiresAt = Date.now() + 600_000;
    return route.fulfill({ json: { code: 'E2ETEST1', expiresAt } });
  });
  await page.route('**/api/integrations/telegram/link/cancel', route => {
    expect(route.request().method()).toBe('POST');
    expiresAt = null;
    return route.fulfill({ json: { ok: true, canceled: true } });
  });
  await page.route('**/api/integrations/telegram/unlink', route => {
    expect(route.request().method()).toBe('POST');
    linked = false;
    return route.fulfill({ json: { ok: true, unlinked: true } });
  });

  await page.goto('/connections');
  await expect(page.getByText('SETUP REQUIRED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate pairing code' })).toHaveCount(0);
  configured = true;

  const passphrase = page.getByLabel('Owner passphrase');
  await passphrase.fill(password, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Generate pairing code' }).click();
  await expect(page.getByText('/link E2ETEST1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel pairing code' }).click();
  await expect(page.getByText('UNLINKED', { exact: true })).toBeVisible();
  await expect(page.getByText('/link E2ETEST1', { exact: true })).toHaveCount(0);
  await expect(passphrase).toHaveValue('');
  await passphrase.fill(password);
  await page.getByRole('button', { name: 'Generate pairing code' }).click();
  await expect(page.getByText('/link E2ETEST1', { exact: true })).toBeVisible();

  linked = true;
  expiresAt = null;
  await expect(page.getByText('LINKED', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('/link E2ETEST1', { exact: true })).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Unlink Telegram' }).click();
  await expect(page.getByText('UNLINKED', { exact: true })).toBeVisible();
});
