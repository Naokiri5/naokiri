import { expect, test, type Route, type Page } from '@playwright/test';

import { signInTestOwner } from './owner-fixture';
const instrument = (base: string) => ({ instrument: { base, symbol: `${base}USDT` }, cross: {}, candles: [], features: null, indicators: [], prints: [] });

async function installFixtureStream(page: Page) {
  await page.addInitScript(() => {
    class FixtureStream {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      callbacks: Record<string, ((event: { data: string }) => void)[]> = {};
      constructor() { (window as unknown as { fixtureStream: FixtureStream }).fixtureStream = this; }
      addEventListener(topic: string, callback: (event: { data: string }) => void) { (this.callbacks[topic] ??= []).push(callback); }
      close() {}
      emit(topic: string) { for (const callback of this.callbacks[topic] ?? []) callback({ data: '{}' }); }
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureStream });
  });
}

test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await signInTestOwner(page);
});

for (const staleStatus of [200, 401]) {
  test(`an obsolete asset response (${staleStatus}) cannot replace the current resource or revoke its session`, async ({ page }) => {
    // Deliberately simulate a transport which completes despite cancellation. Logical request ownership must still hold.
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        return original(input, path.includes('/api/instrument/') ? { ...options, signal: undefined } : options);
      };
    });
    let previous: Route | undefined;
    await page.route('**/api/markets', route => route.fulfill({ json: { tickers: [{ symbol: 'RACEBUSDT', base: 'RACEB', last: 200, changePct: 0 }] } }));
    await page.route('**/api/instrument/RACEAUSDT?interval=1h', route => { previous = route; });
    await page.route('**/api/instrument/RACEBUSDT?interval=1h', route => route.fulfill({ json: instrument('RACEB') }));
    await page.goto('/terminal/RACEAUSDT');
    await expect.poll(() => !!previous).toBe(true);
    await page.getByRole('button', { name: 'Open RACEBUSDT in the terminal', exact: true }).click();
    await expect(page).toHaveURL(/\/terminal\/RACEBUSDT$/);
    await expect(page.getByRole('heading', { name: 'Market Terminal · RACEB', exact: true })).toBeVisible();
    await previous!.fulfill({ status: staleStatus, json: staleStatus === 200 ? instrument('RACEA') : { error: 'obsolete fixture unauthorized' } });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('heading', { name: 'Market Terminal · RACEB', exact: true })).toBeVisible();
    await expect(page.getByText('Market Terminal · RACEA', { exact: true })).toHaveCount(0);
    await expect(page.locator('input[type=password]')).toHaveCount(0);
  });
}

test('a stream debounce is cancelled when its subscribing page unmounts', async ({ page }) => {
  await installFixtureStream(page);
  let requests = 0; let afterUnmount = 0;
  await page.route('**/api/overview', route => {
    requests++;
    // Only a fetch issued after the app left the overview is an orphan. One issued while the overview is still shown
    // (a slow navigation) is legitimate, so the result no longer depends on navigation speed (CodeRabbit PR #18).
    if (/\/risk$/.test(page.url())) afterUnmount++;
    return route.fulfill({ json: { account: {}, alerts: [], opportunities: [], movers: [], activity: [] } });
  });
  await page.goto('/');
  await expect(page.locator('.mode')).not.toHaveText('…');
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(() => (window as unknown as { fixtureStream: { emit(topic: string): void } }).fixtureStream.emit('scan'));
  await page.locator('[data-seg="risk"]').click();
  await expect(page).toHaveURL(/\/risk$/);
  // The stream debounce is 600 ms. Observe beyond that deadline (negative check) to detect an orphaned fetch.
  await page.waitForTimeout(800);
  expect(afterUnmount).toBe(0);
});


test('history requests stay idle until filters change or a relevant stream event arrives', async ({ page }) => {
  await installFixtureStream(page);
  const urls: string[] = [];
  await page.route('**/api/history?*', async route => {
    urls.push(route.request().url());
    // Explicit fixture latency reproduces the old response/render-dependent request storm.
    await new Promise(resolve => setTimeout(resolve, 10));
    await route.fulfill({ json: { summary: { closedTrades: 0, netPnl: 0, orders: 0, filled: 0, rejected: 0, fees: 0 }, orders: [], trades: [] } });
  });
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Trading History', exact: true })).toBeVisible();
  await expect.poll(() => urls.length).toBe(1);
  // Negative check: a fixed observation window is required to prove NO further request (state-based waits cannot).
  await page.waitForTimeout(1000);
  expect(urls).toHaveLength(1);
  await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('7');
  await expect.poll(() => urls.length).toBe(2);
  expect(urls[1]).not.toBe(urls[0]);
  const filteredUrl = urls[1];
  await page.evaluate(() => (window as unknown as { fixtureStream: { emit(topic: string): void } }).fixtureStream.emit('order'));
  await expect.poll(() => urls.length).toBe(3);
  expect(urls[2]).toBe(filteredUrl);
  await page.waitForTimeout(100); // negative check: no duplicate refetch after the event
  expect(urls).toHaveLength(3);
});
