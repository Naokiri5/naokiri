import { test, expect, type Page, type Locator } from '@playwright/test';

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
async function refuseStepUp(button: Locator, passphrase: Locator, path: string) {
  const before = errors.length;
  await passphrase.fill('incorrect e2e passphrase');
  const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith(path) && r.request().method() === 'POST'), button.click()]);
  expect(response.status()).toBe(403);
  await expect(page.locator('.err').filter({ hasText: /step-up authentication failed/ })).toBeVisible();
  await expect(passphrase).toHaveValue('');
  const expectedErrors = errors.splice(before); expect(expectedErrors.every((e) => /status of 403/.test(e)), expectedErrors.join('\n')).toBe(true);
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
  await page.goto('/bot');
  // The UI no longer offers a Switch for live mode (MIA-WEB-017): it is shown as LOCKED.
  const live = page.locator('label:has-text("Bounded live")');
  await expect(live.getByRole('button', { name: 'Switch' })).toHaveCount(0);
  await expect(live.getByText('LOCKED', { exact: true })).toBeVisible();
  // The server still refuses it directly, even with the correct passphrase (the authoritative check).
  const r = await page.evaluate(async (pw) => { const res = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mia-csrf': '1' }, body: JSON.stringify({ mode: 'BOUNDED_LIVE', password: pw }) }); return { status: res.status, body: await res.json() }; }, PW);
  expect(r.status).toBe(400); expect(r.body.error).toMatch(/BOUNDED_LIVE blocked/);
  await page.reload(); await expect(page.locator('.mode')).toHaveText('PAPER');
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
    await page.goto(r); await expect(page.locator('h1')).toBeVisible(); await page.waitForLoadState('networkidle'); // every API call answered
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

test('Bot resume and strategy re-enable refuse a wrong passphrase, then succeed', async () => {
  await page.goto('/bot'); const passphrase = page.getByPlaceholder('Owner passphrase (step-up)');
  await expect(page.locator('.mode')).toHaveText('PAUSED · PAPER');
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await refuseStepUp(resume, passphrase, '/api/control');
  await expect(page.locator('.mode')).toHaveText('PAUSED · PAPER');
  expect((await (await page.request.get('/api/shell')).json()).control.pausedNewOrders).toBe(true);
  await passphrase.fill(PW); await resume.click();
  await expect(page.locator('.mode')).toHaveText('PAPER'); await expect(passphrase).toHaveValue('');

  const strategy = page.getByRole('row').filter({ hasText: 'Trend Pullback' });
  await strategy.getByRole('button', { name: 'Revoke', exact: true }).click();
  const reenable = strategy.getByRole('button', { name: 'Re-enable', exact: true }); await expect(reenable).toBeVisible();
  await refuseStepUp(reenable, passphrase, '/api/control');
  expect((await (await page.request.get('/api/shell')).json()).control.disabledStrategies).toContain('trend_pullback');
  await passphrase.fill(PW); await reenable.click();
  await expect(strategy.getByRole('button', { name: 'Revoke', exact: true })).toBeVisible(); await expect(passphrase).toHaveValue('');
  expect((await (await page.request.get('/api/shell')).json()).control.disabledStrategies).not.toContain('trend_pullback');
});

test('Risk resume refuses a wrong passphrase, then succeeds', async () => {
  await page.goto('/risk');
  await page.getByRole('button', { name: 'Pause new orders', exact: true }).click(); await expect(page.locator('.mode')).toHaveText('PAUSED · PAPER');
  const passphrase = page.getByPlaceholder('Owner passphrase (step-up)').first(); const resume = page.getByRole('button', { name: 'Resume new orders (step-up)', exact: true });
  await refuseStepUp(resume, passphrase, '/api/control');
  await expect(page.locator('.mode')).toHaveText('PAUSED · PAPER');
  await passphrase.fill(PW); await resume.click(); await expect(page.locator('.mode')).toHaveText('PAPER'); await expect(passphrase).toHaveValue('');
});

test('Lab promotion refuses a wrong passphrase, then succeeds; suspension needs only a session', async () => {
  await page.goto('/lab');
  const strategy = page.getByRole('row').filter({ hasText: 'Trend Pullback' }); const passphrase = page.getByPlaceholder('Owner passphrase (step-up)');
  await expect(strategy.getByText('RESEARCH', { exact: true })).toBeVisible();
  const promote = strategy.getByRole('button', { name: 'Promote to paper', exact: true });
  await refuseStepUp(promote, passphrase, '/api/lab/strategy/trend_pullback/status');
  await expect(strategy.getByText('RESEARCH', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/lab')).json()).strategies.find((s: { id: string }) => s.id === 'trend_pullback').status).toBe('RESEARCH');
  await passphrase.fill(PW); await promote.click(); await expect(strategy.getByText('PAPER', { exact: true })).toBeVisible(); await expect(passphrase).toHaveValue('');
  await strategy.getByRole('button', { name: 'Suspend', exact: true }).click(); await expect(strategy.getByText('SUSPENDED', { exact: true })).toBeVisible();
});

test('Intelligence quarantine release refuses a wrong passphrase, then succeeds', async () => {
  await page.goto('/intelligence');
  const worker = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Release', exact: true }) }).first();
  await expect(worker.getByText('QUARANTINED', { exact: true })).toBeVisible(); const id = await worker.getByRole('cell').first().innerText();
  const passphrase = page.getByPlaceholder('Owner passphrase (step-up)'); const release = worker.getByRole('button', { name: 'Release', exact: true });
  await refuseStepUp(release, passphrase, `/api/workers/${id}/release`);
  expect((await (await page.request.get('/api/intelligence')).json()).workers.find((w: { id: string }) => w.id === id).quarantined).toBe(true);
  await passphrase.fill(PW); await release.click(); await expect(page.getByRole('button', { name: 'Release', exact: true })).toHaveCount(0);
  expect((await (await page.request.get('/api/intelligence')).json()).workers.find((w: { id: string }) => w.id === id).quarantined).toBe(false);
  await expect(passphrase).toHaveCount(0);
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
  await page.getByLabel('Presentation mode').selectOption('analyst');
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
  for (const r of ['/', '/scanner', '/bot', '/risk', '/lab', '/intelligence', '/qhef', '/history', '/academy']) { await m.goto(r); await expect(m.locator('h1')).toBeVisible(); expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), r).toBe(true); }
  await expect(m.getByRole('group', { name: 'Autopilot status' }).locator('[data-seg=live]')).toBeInViewport();
  await ctx.close();
});

test('Trader Joe: a failed send shows the error and gives the message back (MIA-WEB-011)', async () => {
  await page.goto('/joe');
  await page.route('**/api/joe', (r) => r.request().method() === 'POST' ? r.fulfill({ status: 429, json: { error: 'rate limit: Trader Joe is limited to 10/min — try again shortly' } }) : r.fallback());
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill('what is the risk on ETH today?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Not sent: rate limit/)).toBeVisible();
  await expect(box).toHaveValue('what is the risk on ETH today?');
  await page.unroute('**/api/joe');
});

test('terminal never shows the previous symbol after an in-app switch to one that fails (MIA-WEB-013)', async () => {
  await page.route('**/api/instrument/BTCUSDT*', (r) => r.fulfill({ json: { instrument: { base: 'BTC', symbol: 'BTCUSDT' }, cross: {}, ticker: { last: 50_000, receivedAt: Date.now() }, candles: [], features: null } }));
  await page.route('**/api/instrument/FOOUSDT*', (r) => r.fulfill({ status: 404, json: { error: 'unknown symbol FOOUSDT' } }));
  await page.goto('/terminal/BTCUSDT');
  await expect(page.getByRole('heading', { name: /Market Terminal · BTC$/ })).toBeVisible();
  await page.evaluate(() => { history.pushState({}, '', '/terminal/FOOUSDT'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByText('No data for FOOUSDT')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Market Terminal · BTC$/ })).toHaveCount(0);
  await page.unroute('**/api/instrument/BTCUSDT*'); await page.unroute('**/api/instrument/FOOUSDT*');
});

test('trading history loads once instead of refetching in a loop (MIA-WEB-030)', async () => {
  let n = 0; const count = (r: any) => { if (r.url().includes('/api/history?')) n++; };
  page.on('request', count);
  await page.goto('/history'); await expect(page.locator('h1')).toHaveText('Trading History');
  await page.waitForTimeout(2000);
  page.off('request', count);
  expect(n, `history requests in ~2 s: ${n}`).toBeLessThanOrEqual(3); // was 753 in 3 s
});

test('academy rejects an over-limit file before uploading it (MIA-WEB-032)', async () => {
  await page.route('**/api/academy/stats', async (r) => { const res = await r.fetch(); const j = await res.json(); await r.fulfill({ json: { ...j, uploadLimitBytes: 1024 } }); });
  let uploads = 0; const watchUploads = (r: any) => { if (r.method() === 'POST' && r.url().includes('/api/academy/documents')) uploads++; };
  page.on('request', watchUploads);
  await page.goto('/academy'); await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByLabel('Document file').setInputFiles({ name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(4096, 'a') });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(/big\.txt is 0\.0 MB; the limit is 0 MB/)).toBeVisible();
  page.off('request', watchUploads); await page.unroute('**/api/academy/stats');
  expect(uploads).toBe(0);
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
