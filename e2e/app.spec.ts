import { test, expect, type Page } from '@playwright/test';

/**
 * QA-02 Frontend Testing · end-to-end, in order: owner setup → risk policy → funding → PAPER mode →
 * every workspace renders with zero console errors → command palette → mobile layout.
 * Runs against an OFFLINE server (no live data), so pages must show honest empty/stale states, not crash.
 */
const PW = 'e2e owner passphrase';
const ROUTES = ['/', '/terminal/BTCUSDT', '/scanner', '/discover', '/intelligence', '/qhef', '/joe', '/bubbles', '/whales', '/copy', '/holders', '/news',
  '/bot', '/risk', '/portfolio', '/history', '/journal', '/calendar', '/lab', '/wallet', '/security', '/connections', '/notifications', '/qa', '/settings', '/academy'];
const errors: string[] = [];
function watch(page: Page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
}
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // Offline suite must not depend on Google Fonts availability or external TLS certificates.
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  watch(page);
});

test('owner setup and sign-in', async () => {
  await page.goto('/');
  const pws = page.locator('input[type=password]'); await pws.nth(0).fill(PW); await pws.nth(1).fill(PW);
  await page.getByRole('button', { name: 'Create owner' }).click();
  await expect(page.locator('.mode')).toHaveText('READ-ONLY');
  await expect(page.getByText('Market data is stale or disconnected')).toBeVisible(); // offline ⇒ honest stale banner
});

test('status ribbon tells the truth about an offline server', async () => {
  const ribbon = page.getByRole('group', { name: 'Autopilot status' });
  await expect(ribbon.locator('[data-seg=live]')).toHaveText(/LOCKED/);
  await expect(ribbon.locator('[data-seg=data]')).toHaveText(/OFFLINE/);
  await expect(ribbon.locator('[data-seg=data]')).toHaveAttribute('data-tone', 'bad');
  await expect(ribbon.locator('[data-seg=engine]')).toHaveText(/OFF \(OFFLINE\)/);
  await expect(ribbon.locator('[data-seg=risk]')).toHaveText(/NO POLICY/);
  for (const id of ['mode', 'live', 'data', 'engine', 'risk']) await expect(ribbon.locator(`[data-seg=${id}]`)).not.toHaveAttribute('data-tone', 'ok');
  await ribbon.locator('[data-seg=live]').click(); await expect(page).toHaveURL(/\/qa$/);
  await ribbon.locator('[data-seg=risk]').click(); await expect(page).toHaveURL(/\/risk$/);
  await ribbon.locator('[data-seg=engine]').click(); await expect(page).toHaveURL(/\/bot$/);
});

test('accept risk policy (step-up) → fund → PAPER mode', async () => {
  await page.goto('/risk'); await page.getByPlaceholder('Owner passphrase (step-up)').last().fill(PW);
  await page.getByRole('button', { name: 'Accept policy' }).click(); await expect(page.getByText(/Risk policy v1/)).toBeVisible();
  await page.goto('/bot'); await page.getByRole('button', { name: 'Allocate' }).click();
  await expect(page.getByText('$10,000.00').first()).toBeVisible();
  await page.getByPlaceholder('Owner passphrase (step-up)').fill(PW);
  await page.locator('label:has-text("Paper —")').getByRole('button', { name: 'Switch' }).click();
  await expect(page.locator('.mode')).toHaveText('PAPER');
  await expect(page.getByText('PAPER TRADING — all balances')).toBeVisible();
});

test('BOUNDED LIVE cannot be enabled', async () => {
  const before = errors.length;
  await page.goto('/bot'); await page.getByPlaceholder('Owner passphrase (step-up)').fill(PW);
  await page.locator('label:has-text("Bounded live")').getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByText(/BOUNDED_LIVE blocked/)).toBeVisible();
  await expect(page.locator('.mode')).toHaveText('PAPER');
  // the server's refusal (HTTP 400) is the expected outcome; the browser logs it as a failed resource
  const extra = errors.splice(before); expect(extra.every((e) => /status of 400/.test(e)), extra.join('\n')).toBe(true);
});

test('status ribbon goes STALE (never green) when the server stops answering, then recovers', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await page.context().storageState() }); // own tab: aborted requests are expected noise here
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto('/');
  const ribbon = p.getByRole('group', { name: 'Autopilot status' });
  await expect(ribbon.locator('[data-seg=mode] .mode')).toHaveText('PAPER');
  await p.route('**/api/shell', (r) => r.abort());
  await p.clock.fastForward('01:00');
  await expect(p.getByRole('alert').filter({ hasText: 'Lost contact with the MIA server' })).toBeVisible();
  await expect(ribbon.locator('[data-seg=link]')).toHaveText(/LOST/);
  await expect(ribbon.locator('[data-seg=mode] .mode')).toHaveText('PAPER · STALE');
  await expect(ribbon.locator('[data-tone=ok]')).toHaveCount(0);
  await p.unroute('**/api/shell');
  await p.clock.fastForward('00:16');
  await expect(p.getByText('Lost contact with the MIA server')).toHaveCount(0);
  await expect(ribbon.locator('[data-seg=mode] .mode')).toHaveText('PAPER');
  await ctx.close();
});

for (const r of ROUTES) {
  test(`renders ${r}`, async () => {
    await page.goto(r); await expect(page.locator('h1')).toBeVisible(); await page.waitForTimeout(400);
    await expect(page.locator('[role=alert]')).toHaveCount(0); // no API error lines
  });
}

test('command palette navigates and runs a risk-reducing action', async () => {
  await page.goto('/'); await expect(page.locator('h1')).toBeVisible(); await page.keyboard.press('Control+k');
  const box = page.getByRole('dialog', { name: 'Command palette' }); await expect(box).toBeVisible();
  await box.getByRole('textbox', { name: 'Command', exact: true }).fill('security'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/security$/); await expect(page.locator('h1')).toHaveText('Security Center');
  await page.keyboard.press('Control+k'); await page.getByRole('textbox', { name: 'Command', exact: true }).fill('pause new'); await page.keyboard.press('Enter');
  await expect(page.locator('.mode')).toHaveText('PAUSED · PAPER');
});

test('trading history CSV export downloads', async () => {
  await page.goto('/history');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export orders CSV' }).click()]);
  expect(dl.suggestedFilename()).toBe('mia-orders-paper.csv');
});

test('terminal displays chart intelligence evidence and invalidation', async () => {
  await page.route('**/api/instrument/CHARTFIXTURE?interval=1h', async route => route.fulfill({ json: {
    instrument: { base: 'CHARTFIXTURE', symbol: 'CHARTFIXTURE' }, cross: {}, candles: [], indicators: [],
    chartIntelligence: { status: 'VALID', trend: 'UNKNOWN', note: 'Fixture evidence only; confidence is not calibrated.', issues: [], detections: [{ kind: 'BREAKOUT_UP', confidence: 0.6, calibration: 'NOT_CALIBRATED', boundaries: { low: 100, high: 105 }, evidence: ['close=105'], method: 'Prior 20-bar high', invalidation: 'Close back below 100', expiresAt: 3600000 }] }
  } }));
  await page.goto('/terminal/CHARTFIXTURE');
  await expect(page.getByText('Chart intelligence · closed candles')).toBeVisible();
  await expect(page.getByRole('cell', { name: /BREAKOUT_UP/ })).toBeVisible();
  await expect(page.getByText('Close back below 100')).toBeVisible();
  await expect(page.getByText(/60% rule strength/)).toBeVisible();
  await page.unroute('**/api/instrument/CHARTFIXTURE?interval=1h');
});

test('academy: upload a document, see it indexed, search it with a cited source', async () => {
  await page.goto('/academy');
  await expect(page.getByText('Knowledge is evidence, not authority')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Trading and Exchanges' })).toBeVisible(); // catalog, AWAITING DOCUMENT
  await page.getByRole('tab', { name: 'Library' }).click();
  // Synthetic study note written for this test.
  await page.getByLabel('Document file').setInputFiles({ name: 'e2e-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# E2E Volatility Notes\n\nVolatility clustering means large price changes tend to be followed by large changes, and quiet periods by quiet periods.') });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Uploaded — processing in the background.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /E2E Volatility Notes/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('INDEXED', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: 'Search & ask' }).click();
  await page.getByLabel('Query').fill('volatility clustering');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/E2E Volatility Notes, chapter/).first()).toBeVisible();
  await page.getByRole('button', { name: 'What does the research say?' }).click();
  await expect(page.getByText(/Extractive mode|LLM answer/)).toBeVisible();
});

test('overview dashboard shows account, market intelligence, risk monitor, data sources and activity from the backend', async () => {
  await page.goto('/');
  for (const t of ['Paper account', 'Market intelligence', 'Risk monitor', 'Data sources', 'Activity', 'Trader Joe daily briefing']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Equity', { exact: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Daily loss' })).toBeVisible(); // policy accepted earlier in this suite
  await expect(page.getByText(/gates passed — live execution LOCKED/)).toBeVisible();
});

test('DITAS execution quality tab lists actual paper orders only', async () => {
  await page.goto('/ditas');
  await page.getByRole('tab', { name: 'Execution quality' }).click();
  await expect(page.getByText('Paper execution quality')).toBeVisible();
  await expect(page.getByText(/Actual paper OMS records only/)).toBeVisible();
});

test('no console errors anywhere', async () => { expect(errors, errors.join('\n')).toEqual([]); });

test('mobile layout has no horizontal overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  for (const r of ['/', '/scanner', '/risk', '/qhef', '/history', '/academy']) { await m.goto(r); await expect(m.locator('h1')).toBeVisible(); expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), r).toBe(true); }
  await expect(m.getByRole('group', { name: 'Autopilot status' }).locator('[data-seg=live]')).toBeInViewport();
  await ctx.close();
});

test('sign-out that fails on the network keeps the session and says so (MIA-WEB-001)', async () => {
  await page.goto('/');
  await page.route('**/api/auth/logout', (r) => r.abort('failed'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-out failed' })).toBeVisible();
  await expect(page.locator('.mode')).toBeVisible(); // still in the app, matching the server session
  expect((await page.evaluate(async () => (await fetch('/api/auth/state')).json())).authenticated).toBe(true);
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect((await page.evaluate(async () => (await fetch('/api/auth/state')).json())).authenticated).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible(); // a reload does not sign back in
});
