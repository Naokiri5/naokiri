import { expect, test, type Page } from '@playwright/test';

const PW = 'e2e owner passphrase';
const PRIVACY_KEY = 'mia-cockpit-privacy';
const TOGGLE = 'Hide cockpit amounts';
const SCOPE = 'Cockpit amounts hidden. Other workspaces and exports may still show account details.';
const monitor = (page: Page) => page.getByRole('region', { name: 'Read-only paper monitor' });
const headerToggle = (page: Page) => page.locator(`header > button[aria-label="${TOGGLE}"]`);

// Distinctive synthetic values make secondary labels, notification text and accessibility leaks observable.
const privateTokens = [
  '98765.43', '98,765.43', '87654.32', '87,654.32', '76543.21', '76,543.21',
  '65432.19', '65,432.19', '5432.18', '5,432.18', '4321.17', '4,321.17',
  '3210.16', '3,210.16', '210.15', '7.89', '8.76', '9.87', '2.34',
  'PRIVATE_ACTIVITY', 'PRIVATE_BRIEFING', 'PRIVATE_ALERT', 'PRIVATE_JOE', 'PRIVATE_ENGINE', 'PRIVATE_PROVIDER',
];

function shellFixture() {
  const now = Date.now();
  return {
    mode: 'PAPER', display: 'PAPER', offline: false, policyAccepted: true,
    control: { emergency: false, pausedNewOrders: false },
    bot: { running: true, cycles: 6, lastScanAt: now, lastTickerAt: now, lastMonitorAt: now,
      lastError: 'PRIVATE_ENGINE amount 5432.18' },
    account: { equity: 98765.43, deposits: 76543.21, dailyPnlPct: -7.89, weeklyPnlPct: -8.76,
      drawdownPct: 9.87, openRiskPct: 2.34, openCount: 1, consecutiveLosses: 2, marksMissing: 0 },
    riskLimits: { dailyLossPct: 3, weeklyLossPct: 6, drawdownWarnPct: 5, drawdownHaltPct: 12,
      maxOpenRiskPct: 4, maxConsecutiveLosses: 5 },
    dataHealth: { stale: false, tickersAt: now, scanAt: now, live: 1, degraded: 0 },
    unread: 1, gates: 'Live execution LOCKED', liveAllowed: false,
    scanIntervalMs: 60000, tickerIntervalMs: 15000, serverTime: now,
  };
}

function overviewFixture() {
  const now = Date.now();
  return {
    asOf: now,
    account: { equity: 98765.43, deposits: 76543.21, cash: 87654.32, positionsValue: 65432.19,
      unrealizedPnl: 5432.18, realizedToday: 3210.16, dailyPnlPct: -7.89, weeklyPnlPct: -8.76,
      drawdownPct: 9.87, openRiskPct: 2.34, openCount: 1, marksMissing: [] },
    risk: { mode: 'PAPER', emergency: true, pausedNewOrders: true, gates: 'Live execution LOCKED',
      policy: { version: 1, acceptedAt: now }, incidents: { open: 1, awaitingAck: 0 },
      limits: { dailyLossPct: { used: 7.89, limit: 3 }, weeklyLossPct: { used: 8.76, limit: 6 },
        drawdownPct: { used: 9.87, limit: 12 }, openRiskPct: { used: 2.34, limit: 4 }, positions: { used: 1, limit: 4 } } },
    pipeline: { scanner: { lastScanAt: now, ageMs: 0, universe: 1 },
      workers: { registered: 100, notYetEvaluated: 100, dataDriven: 86, providerBlocked: 11, productiveDataDriven: 0 },
      consensus: { recent: 0 }, providers: [{ id: 'fixture-provider', name: 'Public fixture feed', status: 'DOWN',
        realtime: 'REALTIME', lastError: 'PRIVATE_PROVIDER account 98765.43', lastOkAt: now, lastLatencyMs: 10 }] },
    performance: { realizedPnl: 4321.17, feesPaid: 210.15, closedTrades: 1 },
    breadth: { universe: 1, advancers: 1, decliners: 0, medianChangePct: 1.11 },
    opportunities: [],
    movers: [{ id: 'fixture-public', symbol: 'PUBLICUSDT', price: 456.78, changePct: 1.11, tags: [] }],
    activity: [{ at: now, firstAt: now, count: 1, kind: 'FILL', tone: 'info',
      title: 'PRIVATE_ACTIVITY fee 210.15', detail: 'PRIVATE_ACTIVITY 3210.16 @ 5432.18', link: '/history' }],
    briefing: 'PRIVATE_BRIEFING equity 98765.43 and day -7.89%',
    alerts: [{ id: 'private-alert', severity: 'CRITICAL', title: 'PRIVATE_ALERT loss 4321.17',
      body: 'PRIVATE_ALERT account 87654.32', ts: now }],
  };
}

async function fixtures(page: Page) {
  await page.route('**/api/shell', route => route.fulfill({ json: shellFixture() }));
  await page.route('**/api/overview', route => route.fulfill({ json: overviewFixture() }));
  await page.route('**/api/notifications', route => route.fulfill({ json: [{ id: 'private-notice', severity: 'CRITICAL',
    title: 'PRIVATE_ALERT balance 98765.43', body: 'PRIVATE_ALERT pnl 5432.18', ts: Date.now() }] }));
  await page.route('**/api/joe', route => route.fulfill({ json: { llm: false,
    history: [{ id: 'private-joe', role: 'assistant', content: 'PRIVATE_JOE equity 98765.43 and fees 210.15' }] } }));
  await page.route('**/api/instrument/*?interval=1h', route => {
    const symbol = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ json: {
      instrument: { symbol, base: symbol.replace('USDT', ''), quote: 'USDT', venue: 'binance' },
      quality: { status: 'OK', issues: [] }, ticker: { receivedAt: Date.now(), last: 456.78 },
      features: null, cross: {}, book: null, impact: null, prints: [], indicators: [],
      candles: Array.from({ length: 3 }, (_, i) => ({ t: 1700000000000 + i * 3600000,
        o: 450 + i, h: 458 + i, l: 448 + i, c: 456 + i, v: 10 })),
    } });
  });
}

async function disablePip(page: Page) {
  await page.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined }));
}

async function installMockPip(page: Page) {
  // This verifies the React portal contract; it is deliberately not evidence of native platform PiP support.
  await page.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: {
    requestWindow: () => {
      const child = window.open('about:blank', '_blank', 'popup,width=390,height=560');
      return child ? Promise.resolve(child) : Promise.reject(new Error('Explicit fixture popup blocked'));
    },
  } }));
}

async function expectNoPrivateRender(page: Page) {
  // textContent also checks closed <details> and prevents CSS-only hiding from passing this test.
  const evidence = await page.locator('body').evaluate(body => {
    const attributes = Array.from(body.querySelectorAll('*')).flatMap(element =>
      Array.from(element.attributes).filter(attribute => attribute.name === 'title'
        || attribute.name.startsWith('aria-') || attribute.name.startsWith('data-')).map(attribute => attribute.value));
    const inputs = Array.from(body.querySelectorAll('input, textarea')).map(input => (input as HTMLInputElement).value);
    return [body.textContent, ...attributes, ...inputs].join('\n');
  });
  const accessibility = await page.locator('body').ariaSnapshot();
  for (const token of privateTokens) {
    expect(evidence, `Sensitive token ${token} remains in rendered text/attributes/inputs`).not.toContain(token);
    expect(accessibility, `Sensitive token ${token} remains in the accessibility tree`).not.toContain(token);
  }
}

test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const state = await (await page.request.get('/api/auth/state')).json();
  const response = await page.request.post(state.setup ? '/api/auth/login' : '/api/auth/setup', { data: { password: PW } });
  expect(response.status()).toBe(200);
});

test('saved cockpit privacy masks all overview modes, free text and accessible attributes without financial writes', async ({ page }) => {
  await fixtures(page); await disablePip(page);
  await page.addInitScript(() => localStorage.setItem('mia-cockpit-privacy', 'true'));
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url()); });
  await page.goto('/');
  const toggle = headerToggle(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const risk = page.locator('header [data-seg="risk"]');
  await expect(risk).toContainText('BREAKER');
  await expect(page.getByText(SCOPE, { exact: true })).toBeVisible();
  for (const mode of ['simple', 'analyst', 'engineer']) {
    await page.getByRole('combobox', { name: 'Presentation mode' }).selectOption(mode);
    await expect(page.locator('.compact-overview').getByText('Hidden', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.compact-overview .stat').filter({ hasText: 'Daily paper P&L' }).locator('.v'))
      .not.toHaveClass(/\b(up|down)\b/);
    await expect(page.getByText('CRITICAL alert — details hidden', { exact: true })).toBeVisible();
    await expect(page.getByText(/Emergency stop is active — no new orders/)).toBeVisible();
    await expect(page.getByText('PAPER ACCOUNT — SIMULATED', { exact: true })).toBeVisible();
    await expectNoPrivateRender(page);
  }
  await expect(page.getByText('456.7800', { exact: true }).first()).toBeVisible(); // Public market evidence stays visible.
  await page.getByRole('button', { name: /Ask Trader Joe/ }).click();
  await expect(page.getByRole('dialog', { name: 'Trader Joe' })).toBeVisible();
  await expectNoPrivateRender(page);
  await page.getByRole('dialog', { name: 'Trader Joe' }).getByRole('button', { name: /Close/ }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.compact-overview').getByText('$98,765.43', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), PRIVACY_KEY)).toBe('false');
  expect(writes).toEqual([]);
});

test('inline monitor shares privacy with the header and restores values when revealed', async ({ page }) => {
  await fixtures(page); await disablePip(page); await page.goto('/');
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
  const panel = monitor(page);
  await expect(panel.getByText('$98,765.43', { exact: true })).toBeVisible();
  await headerToggle(page).click();
  await expect(panel.getByRole('button', { name: TOGGLE, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText('CRITICAL alert — details hidden', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Review protection incidents', exact: true })).toBeVisible();
  await expectNoPrivateRender(page);
  await panel.getByRole('button', { name: TOGGLE, exact: true }).click();
  await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByText('$98,765.43', { exact: true })).toBeVisible();
});

test('mocked PiP stays synchronized with opener privacy and restores masked inline content after close', async ({ page }) => {
  await fixtures(page); await installMockPip(page); await page.goto('/');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url()); });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
  const child = await popup;
  await expect(monitor(child)).toBeVisible();
  await expect(monitor(child).getByText('$98,765.43', { exact: true })).toBeVisible();
  await headerToggle(page).click();
  const childToggle = monitor(child).getByRole('button', { name: TOGGLE, exact: true });
  await expect(childToggle).toHaveAttribute('aria-pressed', 'true');
  await expectNoPrivateRender(child); await expectNoPrivateRender(page);
  await childToggle.click();
  await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(monitor(child).getByText('$98,765.43', { exact: true })).toBeVisible();
  await childToggle.click();
  await child.close();
  await expect(monitor(page)).toBeVisible();
  await expect(monitor(page).getByRole('button', { name: TOGGLE, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectNoPrivateRender(page);
  await page.reload();
  await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expectNoPrivateRender(page);
  expect(writes).toEqual([]);
});

test('cockpit privacy remains usable when browser preference storage is unavailable', async ({ page }) => {
  await fixtures(page); await disablePip(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Explicit fixture storage denied', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Explicit fixture storage denied', 'SecurityError'); };
  });
  await page.goto('/');
  await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await headerToggle(page).click();
  await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expectNoPrivateRender(page);
  await headerToggle(page).click();
  await expect(page.locator('.compact-overview').getByText('$98,765.43', { exact: true })).toBeVisible();
});

test('mobile cockpit privacy remains reachable and keeps safety state visible', async ({ page }) => {
  await fixtures(page); await disablePip(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(headerToggle(page)).toBeVisible();
  await headerToggle(page).click();
  await expect(page.getByText(/Emergency stop is active — no new orders/)).toBeVisible();
  await page.getByRole('button', { name: 'Float monitor', exact: true }).click();
  await expect(monitor(page).getByRole('button', { name: TOGGLE, exact: true })).toBeVisible();
  await expectNoPrivateRender(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
