import { expect, test, type Page } from '@playwright/test';

const PW = 'e2e owner passphrase';
const monitor = (page: Page) => page.locator('section[aria-label="Read-only paper monitor"]');
const fixtureShell = (patch: Record<string, unknown> = {}) => {
  const now = Date.now();
  return { mode: 'PAPER', display: 'PAPER', offline: false, policyAccepted: true,
    control: { mode: 'PAPER', emergency: false, pausedNewOrders: false },
    account: { equity: 12345.67, dailyPnlPct: 1.25, openRiskPct: 0.5, drawdownPct: 0, openCount: 1, deposits: 12000 },
    dataHealth: { stale: false, tickersAt: now, scanAt: now, live: 1, degraded: 0 },
    unread: 1, ...patch };
};
const fixtureOverview = () => ({
  asOf: Date.now(), account: { equity: 12345.67, dailyPnlPct: 1.25, openRiskPct: 0.5, openCount: 1, deposits: 12000, cash: 12000, positionsValue: 345.67, unrealizedPnl: 5, marksMissing: [], realizedToday: 1, weeklyPnlPct: 2, drawdownPct: 0 },
  risk: { mode: 'PAPER', emergency: true, pausedNewOrders: true, policy: null, limits: { positions: { used: 1, limit: 4 } }, incidents: { open: 1, awaitingAck: 0 }, gates: 'LIVE LOCKED' },
  pipeline: { scanner: { lastScanAt: Date.now(), ageMs: 0, universe: 1 }, workers: { registered: 100, notYetEvaluated: 100, dataDriven: 86, providerBlocked: 11, productiveDataDriven: 0 }, consensus: { recent: 0 }, providers: [] },
  performance: { realizedPnl: 1, feesPaid: 0.2, closedTrades: 1 }, breadth: { universe: 0 }, opportunities: [], movers: [], activity: [], briefing: 'Explicit offline browser fixture; no prediction.',
  alerts: [{ id: 'fixture-critical', severity: 'CRITICAL', title: 'Fixture protection warning', body: 'Keep this warning visible in every view.', ts: Date.now() }],
});
const fixtureInstrument = (symbol: string) => ({
  instrument: { symbol, base: symbol.replace('USDT', ''), quote: 'USDT', venue: 'binance' }, quality: { status: 'OK', issues: [] }, ticker: { receivedAt: Date.now(), last: 102, changePct: 0, quoteVolume: 10000 }, features: null, cross: {}, book: null, impact: null, prints: [], indicators: [],
  candles: Array.from({ length: 3 }, (_, i) => ({ t: 1700000000000 + i * 3600000, o: 100 + i, h: 103 + i, l: 99 + i, c: 102 + i, v: 10 })),
});

async function fixtures(page: Page, shell = fixtureShell()) {
  await page.route('**/api/shell', route => route.fulfill({ json: shell }));
  await page.route('**/api/overview', route => route.fulfill({ json: fixtureOverview() }));
  await page.route('**/api/notifications', route => route.fulfill({ json: [...Array.from({ length: 3 }, (_, i) => ({ id: `warning-${i}`, severity: 'WARNING', title: `Newer fixture warning ${i}`, body: 'Explicit fixture.', ts: Date.now() + i })), { id: 'notice', severity: 'CRITICAL', title: 'Fixture monitor alert', body: 'Older critical fixture must remain visible.', ts: Date.now() - 10000 }] }));
  await page.route('**/api/joe', route => route.fulfill({ json: { history: [], llm: false } }));
  await page.route('**/api/instrument/*?interval=1h', route => {
    const symbol = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ json: fixtureInstrument(symbol) });
  });
}
async function disablePip(page: Page) {
  await page.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined }));
}
async function installMockPip(page: Page, pending = false) {
  await page.addInitScript(({ pending }) => {
    const host = window as Window & { __finishPip?: () => void; __pipRequests?: number; documentPictureInPicture?: unknown };
    Object.defineProperty(host, 'documentPictureInPicture', { configurable: true, value: { requestWindow: () => {
      host.__pipRequests = (host.__pipRequests ?? 0) + 1;
      const child = window.open('about:blank', '_blank', 'popup,width=390,height=560');
      if (!child) return Promise.reject(new Error('Mock popup blocked'));
      if (!pending) return Promise.resolve(child);
      return new Promise<Window>(resolve => { host.__finishPip = () => resolve(child); });
    } } });
  }, { pending });
}

test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const state = await (await page.request.get('/api/auth/state')).json();
  const result = await page.request.post(state.setup ? '/api/auth/login' : '/api/auth/setup', { data: { password: PW } });
  expect(result.status()).toBe(200);
});

test('presentation presets persist without hiding critical warnings or mutating the account', async ({ page }, testInfo) => {
  await fixtures(page, fixtureShell({ control: { mode: 'PAPER', emergency: true, pausedNewOrders: true } }));
  await disablePip(page);
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) mutations.push(request.url()); });
  await page.goto('/');
  const selector = page.getByRole('combobox', { name: 'Presentation mode' });
  const details = page.locator('details.overview-details');
  for (const mode of ['simple', 'analyst', 'engineer']) {
    await selector.selectOption(mode);
    await expect(selector).toHaveValue(mode);
    expect(await details.getAttribute('open')).toBe(mode === 'simple' ? null : '');
    await expect(page.getByText('PAPER ACCOUNT — SIMULATED', { exact: true })).toBeVisible();
    await expect(page.getByText('Fixture protection warning', { exact: true })).toBeVisible();
    await expect(page.getByText(/Emergency stop is active — no new orders/)).toBeVisible();
    await expect(page.locator('.compact-overview').getByText('$12,345.67', { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Snapshot diagnostics', { exact: true })).toBeVisible();
  await page.reload(); await expect(selector).toHaveValue('engineer');
  await selector.selectOption('simple');
  await page.getByText('Account, market and analysis details', { exact: true }).focus();
  await page.keyboard.press('Enter'); await expect(details).toHaveAttribute('open', '');
  await page.keyboard.press('Enter'); await expect(details).not.toHaveAttribute('open');
  expect(mutations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('cockpit-simple-offline-fixture.png'), fullPage: true });
});

test('invalid saved presentation falls back to Simple and existing navigation and Joe remain available', async ({ page }) => {
  await fixtures(page); await disablePip(page);
  await page.addInitScript(() => localStorage.setItem('mia-presentation', 'invalid-fixture-mode'));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Presentation mode' })).toHaveValue('simple');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  for (const name of ['Markets', 'Autopilot', 'Portfolio', 'AI Intelligence', 'Settings & Security']) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Ask Trader Joe/ }).click();
  const joe = page.getByRole('dialog', { name: 'Trader Joe' });
  await expect(joe).toBeVisible(); await expect(joe.getByText('context: /', { exact: true })).toBeVisible();
});

test('unsupported PiP uses one read-only in-page monitor and preserves observed asset navigation', async ({ page }) => {
  await fixtures(page); await disablePip(page);
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) mutations.push(request.url()); });
  await page.goto('/'); await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
  const panel = monitor(page); await expect(panel).toHaveCount(1); await expect(panel).toBeVisible();
  await expect(panel.getByText('PAPER ACCOUNT', { exact: true })).toBeVisible();
  await expect(panel.getByText('READ ONLY', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Floating windows are unsupported/)).toBeVisible();
  await expect(panel.getByText('Fixture monitor alert', { exact: true })).toBeVisible();
  await panel.getByRole('combobox', { name: 'Monitor asset' }).selectOption('ETHUSDT');
  await expect(panel.getByRole('img', { name: 'Candlestick price chart' })).toBeVisible();
  await panel.getByRole('button', { name: 'Open full terminal' }).click(); await expect(page).toHaveURL(/\/terminal\/ETHUSDT$/);
  expect(mutations).toEqual([]);
  await panel.getByRole('button', { name: 'Close monitor', exact: true }).click(); await expect(panel).toHaveCount(0);
});

for (const variant of ['stale', 'future', 'missing'] as const) {
  test(`monitor marks ${variant} market timestamps instead of implying current evidence`, async ({ page }) => {
    const stamp = variant === 'stale' ? Date.now() - 120000 : variant === 'future' ? Date.now() + 120000 : undefined;
    await fixtures(page, fixtureShell({ dataHealth: { stale: false, tickersAt: stamp, scanAt: Date.now(), live: 1, degraded: 0 } }));
    await disablePip(page); await page.goto('/'); await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
    const panel = monitor(page);
    await expect(panel.getByText(/Waiting for current market data/)).toBeVisible();
    await expect(panel.getByText(new RegExp(`^${variant === 'stale' ? 'STALE' : 'UNKNOWN'} ·`))).toBeVisible();
  });
}

test('late old-asset response cannot erase or relabel the new monitor chart', async ({ page }) => {
  await fixtures(page); await disablePip(page);
  let finish: (() => void) | undefined; let settled = false;
  await page.route('**/api/instrument/BTCUSDT?interval=1h', async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    try { await route.fulfill({ json: fixtureInstrument('BTCUSDT') }); } catch { /* Aborted obsolete request is expected. */ }
    settled = true;
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
  await expect.poll(() => !!finish).toBe(true);
  const panel = monitor(page);
  await panel.getByRole('combobox', { name: 'Monitor asset' }).selectOption('ETHUSDT');
  await expect(panel.getByRole('img', { name: 'Candlestick price chart' })).toBeVisible();
  finish!(); await expect.poll(() => settled).toBe(true); await page.waitForLoadState('networkidle'); // the late response has been delivered
  await expect(panel.getByRole('combobox', { name: 'Monitor asset' })).toHaveValue('ETHUSDT');
  await expect(panel.getByRole('img', { name: 'Candlestick price chart' })).toBeVisible();
});

test('mocked PiP contract moves one monitor, syncs theme, restores inline on close and closes on logout', async ({ page }) => {
  await fixtures(page); await installMockPip(page);
  await page.goto('/');
  expect(await page.evaluate(() => (window as Window & { __pipRequests?: number }).__pipRequests ?? 0)).toBe(0);
  const childPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click(); const child = await childPromise;
  await expect(monitor(child)).toBeVisible(); await expect(monitor(page)).toHaveCount(0);
  await expect(child).toHaveTitle('MIA — read-only paper monitor');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect.poll(() => child.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await child.close(); await expect(monitor(page)).toBeVisible();
  const secondPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click(); const second = await secondPromise;
  await expect(monitor(second)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => second.isClosed()).toBe(true);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('mocked pending PiP result is closed when it resolves after logout unmounts the monitor', async ({ page }) => {
  await fixtures(page); await installMockPip(page, true); await page.goto('/');
  const childPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click(); const child = await childPromise;
  await expect(page.getByRole('button', { name: 'Opening monitor…', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.evaluate(() => (window as Window & { __finishPip?: () => void }).__finishPip?.());
  await expect.poll(() => child.isClosed()).toBe(true);
});

test('mobile cockpit keeps safety and paper origin visible in Simple mode', async ({ page }, testInfo) => {
  await fixtures(page, fixtureShell({ control: { mode: 'PAPER', emergency: true, pausedNewOrders: true } }));
  await disablePip(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('.mode')).toBeVisible();
  await expect(page.getByText('PAPER ACCOUNT — SIMULATED', { exact: true })).toBeVisible();
  await expect(page.getByText('Fixture protection warning', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
  await expect(monitor(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cockpit-mobile-offline-fixture.png'), fullPage: true });
});
