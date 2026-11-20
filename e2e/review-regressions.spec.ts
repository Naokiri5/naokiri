import { expect, test, type Route } from '@playwright/test';
import { signInTestOwner, TEST_OWNER_PASSPHRASE } from './owner-fixture';

const instrument = (base: string) => ({ instrument: { base, symbol: `${base}USDT` }, cross: {}, candles: [], features: null, indicators: [], prints: [] });

for (const staleStatus of [200, 401]) {
  test(`an obsolete full analysis (${staleStatus}) cannot open a modal for another asset or revoke its session`, async ({ page }) => {
    await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await signInTestOwner(page);
    // The delayed transport deliberately completes after cancellation, exercising logical ownership as well as abort.
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        return original(input, path.endsWith('/api/analyze') ? { ...options, signal: undefined } : options);
      };
    });
    await page.route('**/api/markets', route => route.fulfill({ json: { tickers: [{ symbol: 'REVIEWBUSDT', base: 'REVIEWB', last: 200, changePct: 0 }] } }));
    await page.route('**/api/instrument/REVIEWAUSDT?interval=1h', route => route.fulfill({ json: instrument('REVIEWA') }));
    await page.route('**/api/instrument/REVIEWBUSDT?interval=1h', route => route.fulfill({ json: instrument('REVIEWB') }));
    let old: Route | undefined;
    await page.route('**/api/analyze', route => {
      if (route.request().postDataJSON().symbol === 'REVIEWAUSDT') { old = route; return; }
      return route.fulfill({ json: { reason: 'Current REVIEWB analysis result' } });
    });
    await page.goto('/terminal/REVIEWAUSDT');
    await page.getByRole('button', { name: 'Run full analysis', exact: true }).click();
    await expect.poll(() => !!old).toBe(true);
    await page.getByRole('button', { name: 'Open REVIEWBUSDT in the terminal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Market Terminal · REVIEWB', exact: true })).toBeVisible();
    const delivered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/analyze'
      && response.request().postDataJSON().symbol === 'REVIEWAUSDT');
    await old!.fulfill({ status: staleStatus, json: staleStatus === 200 ? { reason: 'Obsolete REVIEWA analysis result' } : { error: 'obsolete analysis unauthorized' } });
    await (await delivered).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Run full analysis', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Current REVIEWB analysis result');
    await expect(page.getByRole('dialog')).not.toContainText('Obsolete REVIEWA');
  });
}

test('a rejected optional Privy chunk leaves passphrase sign-in functional', async ({ page }) => {
  await signInTestOwner(page);
  await page.request.post('/api/auth/logout', { data: {} });
  await page.route('**/api/auth/state', async route => {
    const state = await (await route.fetch()).json();
    return route.fulfill({ json: { ...state, mode: 'passphrase', setup: true, authenticated: false,
      privy: { enabled: true, appId: 'cmtestprivyapp00000000001', linked: true, ownerConfigured: true, embeddedWallets: false, walletActions: 'LOCKED' } } });
  });
  let rejected = false;
  await page.route('**/assets/*.js', async route => {
    if (route.request().url().includes('/PrivyPanels-')) { rejected = true; return route.abort('failed'); }
    return route.continue();
  });
  await page.goto('/');
  await expect.poll(() => rejected).toBe(true);
  await expect(page.getByText('Privy sign-in could not load. Use your passphrase to sign in.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Passphrase', { exact: true })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(TEST_OWNER_PASSPHRASE);
  await page.unroute('**/api/auth/state');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});
