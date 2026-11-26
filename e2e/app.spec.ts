import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * QA-02 Frontend Testing · end-to-end, in order: owner setup → risk policy → funding → PAPER mode →
 * every workspace renders with zero console errors → command palette → mobile layout.
 * Runs against an OFFLINE server (no live data), so pages must show honest empty/stale states, not crash.
 */
const PW = 'e2e owner passphrase';
const ROUTES = ['/app', '/terminal/BTCUSDT', '/scanner', '/discover', '/intelligence', '/qhef', '/joe', '/bubbles', '/whales', '/copy', '/holders', '/news',
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
  await page.goto('/app');
  const pws = page.locator('input[type=password]'); await pws.nth(0).fill(PW); await pws.nth(1).fill(PW);
  await page.getByRole('button', { name: 'Create owner' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Autopilot', exact: true })).toBeVisible();
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

test('Central Command renders offline, paper reconciliation and research states from the backend', async () => {
  await page.goto('/bot');
  const command = page.getByRole('region', { name: 'MIA Central Command' });
  await expect(command.getByText('Engine authority', { exact: true })).toBeVisible();
  await expect(command.getByText('OFFLINE', { exact: true }).first()).toBeVisible();
  await expect(command.getByText('Reconciled', { exact: true })).toBeVisible();
  await expect(command.getByText('No open positions', { exact: true })).toBeVisible();
  await expect(command.getByText('Awaiting first comparison', { exact: true })).toBeVisible();
  await expect(command.getByText('Awaiting samples', { exact: true })).toHaveCount(2);
  await expect(command.getByRole('link', { name: 'Release gates' })).toHaveAttribute('href', '/qa');
});

test('FAST and DEEP inspect existing research without changing execution mode', async () => {
  await page.goto('/autopilot');
  const lanes = page.getByRole('group', { name: 'Intelligence view' });
  await expect(page.getByText('Awaiting a DEX research snapshot.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FAST market view' })).toBeVisible();
  const mode = page.locator('.mode');
  await expect(mode).toHaveText('READ-ONLY');
  const deep = lanes.getByRole('button', { name: 'DEEP' });
  await deep.focus();
  await deep.press('Enter');
  await expect(deep).toBeFocused();
  await expect(deep).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'DEEP spot chart' })).toBeVisible();
  const strategy = page.getByRole('region', { name: 'Strategy architect' });
  await strategy.getByText('Perpetual futures research').click();
  await expect(strategy).toContainText('Awaiting a futures research snapshot.');
  await expect(mode).toHaveText('READ-ONLY');
  const timeframe = page.getByRole('group', { name: 'Chart timeframe' });
  const candles = page.waitForResponse((response) => response.url().includes('/api/instrument/BTCUSDT?interval=4h'));
  const fourHours = timeframe.getByRole('button', { name: '4h' });
  await fourHours.focus();
  await fourHours.press('Enter');
  expect((await candles).ok()).toBe(true);
  await expect(fourHours).toBeFocused();
  await expect(page.getByText('Market candles unavailable')).toBeVisible();
});

test('server readiness explains the disabled session controls and the Live lock', async () => {
  await page.goto('/app');
  const session = page.getByRole('region', { name: 'MIA Autopilot' });
  await expect(session.getByText('Preflight checked', { exact: true })).toBeVisible();
  // FAST and DEEP report server readiness; neither research pathway is presented as executable.
  const lanes = page.getByRole('group', { name: 'Intelligence view' });
  for (const lane of ['FAST', 'DEEP']) {
    await expect(lanes.getByRole('button', { name: lane })).toContainText('Research only');
    await expect(lanes.getByRole('button', { name: lane })).toContainText('Execution is not certified.');
  }
  await expect(session.getByText(/No active mandate\. Run Session asks you to authorize capital/)).toBeVisible();
  await expect(session.getByRole('button', { name: 'Run Session' })).toBeDisabled();
  await expect(session.getByRole('button', { name: 'Close Session' })).toBeDisabled();
  await expect(session.getByRole('link', { name: 'Emergency controls' })).toHaveAttribute('href', '/risk');
  await session.getByText('Session readiness checklist').click();
  await expect(session.getByRole('link', { name: 'Review Risk Policy' })).toHaveAttribute('href', '/risk');
  const before = await (await page.request.get('/api/shell')).json();
  const live = page.getByRole('group', { name: 'Execution environment' }).getByRole('button', { name: 'Live locked' });
  const response = page.waitForResponse((result) => result.url().includes('/api/session/preflight?mind=FAST&environment=LIVE'));
  await live.click();
  expect(await (await response).json()).toMatchObject({ mind: 'FAST', environment: 'LIVE', canRun: false, canClose: false });
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(session.getByRole('button', { name: 'Run Session' })).toBeDisabled();
  const after = await (await page.request.get('/api/shell')).json();
  expect(after.control).toEqual(before.control);
});

test('accept risk policy (step-up) → fund → PAPER mode', async () => {
  await page.goto('/risk'); await page.getByPlaceholder('Owner passphrase (step-up)').last().fill(PW);
  await page.getByRole('button', { name: 'Accept policy' }).click(); await expect(page.getByText(/Risk policy v1/)).toBeVisible();
  await page.goto('/bot'); await page.getByRole('button', { name: 'Allocate' }).click();
  await expect(page.getByText('$10,000.00').first()).toBeVisible();
  await page.getByPlaceholder('Owner passphrase (step-up)').fill(PW);
  await page.getByRole('button', { name: 'Switch to Paper', exact: true }).click();
  await expect(page.locator('.mode')).toHaveText('PAPER');
  await expect(page.getByText('PAPER TRADING — all balances')).toBeVisible();
});

test('BOUNDED LIVE cannot be enabled', async () => {
  await page.goto('/bot');
  const environment = page.getByRole('group', { name: 'Execution environment' });
  await expect(environment.getByRole('button', { name: 'Live locked' })).toBeVisible();
  const response = await page.request.post('/api/control', { headers: { 'x-mia-csrf': '1' }, data: { mode: 'BOUNDED_LIVE', password: PW } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('BOUNDED_LIVE blocked') });
  await expect(page.locator('.mode')).toHaveText('PAPER');
});

test('Trader Joe and the portfolio use the recorded paper balance', async () => {
  await page.goto('/trader-joe');
  await page.getByRole('button', { name: 'Paper portfolio' }).click();
  await expect(page.getByRole('log', { name: 'Trader Joe conversation' })).toContainText('Paper equity $10000.00');
  await page.goto('/smart-portfolio');
  await expect(page.getByText('$10,000.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('PASS', { exact: true })).toBeVisible();
});

test('Trader Joe explains the real preflight and Academy exposes the capability contracts', async () => {
  await page.goto('/trader-joe');
  await page.getByRole('button', { name: 'FAST paper readiness' }).click();
  const conversation = page.getByRole('log', { name: 'Trader Joe conversation' });
  await expect(conversation).toContainText('FAST · PAPER · Run Session is unavailable');
  await expect(conversation).toContainText('Source: Autopilot session preflight.');

  await page.goto('/academy');
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await page.getByText('Autopilot capability evidence · 11').click();
  await page.getByText('Settings capability evidence · 7').click();
  await expect(page.getByRole('rowheader', { name: 'holder map' })).toBeVisible();
  const release = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'release gates' }) });
  await release.getByText('View source and freshness').click();
  await expect(release).toContainText('releaseGates()');
});

test('status ribbon goes STALE (never green) when the server stops answering, then recovers', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await page.context().storageState() }); // own tab: aborted requests are expected noise here
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto('/app');
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
  await page.goto('/app'); await expect(page.locator('h1')).toBeVisible(); await page.keyboard.press('Control+k');
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

test('Lab batch retries rate limits and reports partial results', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    const lab = await context.newPage();
    const now = Date.now();
    await lab.clock.install({ time: now });
    const attempted: string[] = [];
    await lab.route('**/api/lab', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), universe: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] } });
    });
    await lab.route('**/api/lab/backtest', async route => {
      const { symbol } = route.request().postDataJSON();
      attempted.push(symbol);
      if (attempted.length === 1) return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, json: { error: 'rate limit' } });
      if (symbol === 'ETHUSDT') return route.fulfill({ status: 502, json: { error: 'upstream market-data provider unavailable (binance)' } });
      return route.fulfill({ json: {} });
    });

    await lab.goto('/lab');
    const batch = lab.getByRole('button', { name: 'Run first 3 symbols' });
    await expect(batch).toBeEnabled();
    await lab.clock.pauseAt(now + 60_000);
    await batch.click();
    await expect(lab.getByRole('status').filter({ hasText: 'Waiting for the rate limit' })).toBeVisible();
    await expect(lab.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    await lab.clock.runFor(999);
    expect(attempted).toEqual(['BTCUSDT']);
    await lab.clock.runFor(1);
    await expect.poll(() => attempted).toEqual(['BTCUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    await expect(lab.getByText(/2 of 3 backtests completed.*ETHUSDT.*upstream market-data provider unavailable/)).toBeVisible();
    await expect(lab.getByRole('button', { name: 'Run first 3 symbols' })).toBeEnabled();
  } finally {
    await context.close();
  }
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
  await page.goto('/overview');
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

test('DITAS intelligence evaluation reports areas without evidence honestly', async () => {
  await page.goto('/ditas');
  await page.getByRole('tab', { name: 'Intelligence evaluation' }).click();
  await expect(page.getByText('BrainOS intelligence evaluation')).toBeVisible();
  await expect(page.getByText('PROBABILITY', { exact: true })).toBeVisible();
  await expect(page.getByText('NEEDS_EVIDENCE').first()).toBeVisible();
  await expect(page.getByText(/Research scores and QCI votes are not probabilities/)).toBeVisible();
  await expect(page.getByText('Evidence coverage')).toBeVisible();
  await expect(page.getByText(/Session to settled outcome, every link checked/)).toBeVisible();
});

test('no console errors anywhere', async () => { expect(errors, errors.join('\n')).toEqual([]); });

test('mobile layout has no horizontal overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  for (const r of ['/', '/app', '/scanner', '/bot', '/risk', '/lab', '/intelligence', '/qhef', '/history', '/academy']) { await m.goto(r); await expect(m.locator('h1')).toBeVisible(); expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), r).toBe(true); }
  await expect(m.getByRole('group', { name: 'Autopilot status' }).locator('[data-seg=live]')).toBeInViewport();
  await m.goto('/autopilot');
  const chart = await m.getByRole('heading', { name: 'FAST market view' }).boundingBox();
  const positions = await m.getByRole('heading', { name: 'Open positions', exact: true }).boundingBox();
  const activity = await m.getByRole('heading', { name: 'MIA Activity' }).boundingBox();
  expect(chart!.y).toBeLessThan(positions!.y);
  expect(positions!.y).toBeLessThan(activity!.y);
  await ctx.close();
});
