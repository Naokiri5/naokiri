import { test, expect, type Page, type Locator } from '@playwright/test';
import { readTestSetupCode, TEST_OWNER_PASSPHRASE as PW } from './owner-fixture';

/**
 * QA-02 Frontend Testing · end-to-end, in order: owner setup → risk policy → funding → PAPER mode →
 * every workspace renders with zero console errors → command palette → mobile layout.
 * Runs against an OFFLINE server (no live data), so pages must show honest empty/stale states, not crash.
 */
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
  await page.getByLabel('Setup code').fill(readTestSetupCode());
  await page.getByRole('button', { name: 'Create owner' }).click();
  await expect(page.locator('.mode')).toHaveText('READ-ONLY');
  await expect(page.getByText('Market data is stale or disconnected')).toBeVisible(); // offline ⇒ honest stale banner
});

test('Discover: Vike research tab is research-only and shows PENDING_CREDENTIALS without a server key', async () => {
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Vike research' }).click();
  await expect(page.getByText(/research only/i).first()).toBeVisible();
  await expect(page.getByText('PENDING CREDENTIALS')).toBeVisible(); // Badge renders underscores as spaces
  await expect(page.getByText(/MIA_VIKE_API_KEY/)).toBeVisible();
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
  await expect(page.getByText(/NOT_CERTIFIED: no live venue adapter or isolated signer/)).toBeVisible();
  await expect(page.getByLabel('Paper execution status')).toHaveText('ACTIVE');
  // The server still refuses it directly, even with the correct passphrase (the authoritative check).
  const r = await page.evaluate(async (pw) => { const res = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mia-csrf': '1' }, body: JSON.stringify({ mode: 'BOUNDED_LIVE', password: pw }) }); return { status: res.status, body: await res.json() }; }, PW);
  expect(r.status).toBe(400); expect(r.body.error).toMatch(/BOUNDED_LIVE is locked/); // SAFE-01: refused in the core
  await page.reload(); await expect(page.locator('.mode')).toHaveText('PAPER');
  // the server's refusal (HTTP 400) is the expected outcome; the browser logs it as a failed resource
  const extra = errors.splice(before); expect(extra.every((e) => /status of 400/.test(e)), extra.join('\n')).toBe(true);
});

test('Bot Account shows measured NEXUS outbox health and drops stale counts after an error', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    const p = await ctx.newPage();
    const path = /\/api\/fabric\/outbox\?view=summary$/;
    await p.clock.install();
    await p.goto('/bot');
    const card = p.locator('section').filter({ has: p.getByRole('heading', { name: 'NEXUS outbox health' }) });
    await expect(card).toContainText('No consumers registered');
    await expect(card).toContainText(/Oldest pending\s*None/);

    let unavailable = false;
    await p.route(path, route => {
      expect(route.request().method()).toBe('GET');
      return unavailable ? route.fulfill({ status: 503, json: { error: 'internal endpoint details' } }) : route.fulfill({ json: {
        counts: { PENDING: 3, DELIVERED: 5, NO_CONSUMER: 2, DEAD: 1 }, oldestPendingAgeMs: 45_000,
        deadLetters: [{ lastError: 'internal relay failure details' }], consumers: [{ id: 'fixture', topics: ['ditas.outcome.recorded.v1'] }],
      } });
    });
    await p.clock.fastForward('00:20');
    await expect(card).toContainText(/Pending\s*3/);
    await expect(card).toContainText(/Oldest pending\s*45s ago/);
    await expect(card).toContainText(/Delivered\s*5/);
    await expect(card).toContainText(/No consumer\s*2/);
    await expect(card).toContainText(/Dead letters\s*1/);
    await expect(card).toContainText(/Registered consumers\s*1/);
    await expect(card).not.toContainText('internal relay failure details');
    await expect(card.getByRole('button')).toHaveCount(0);

    unavailable = true;
    await p.clock.fastForward('00:20');
    await expect(card.getByRole('alert')).toHaveText('Outbox health is unavailable.');
    await expect(card).not.toContainText('Pending');
    await expect(card).not.toContainText('internal endpoint details');

    unavailable = false;
    await p.clock.fastForward('00:20');
    await expect(card).toContainText(/Pending\s*3/);
  } finally {
    await ctx.close();
  }
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

test('terminal displays timeframe conflicts, anchored VWAP and chart evidence', async () => {
  await page.route('**/api/instrument/CHARTFIXTURE?interval=1h', async route => route.fulfill({ json: {
    instrument: { base: 'CHARTFIXTURE', symbol: 'CHARTFIXTURE' }, cross: {}, candles: [], indicators: [],
    cexActivity: {
      source: 'binance', baseAsset: 'BASE', quoteAsset: 'USDT',
      volume: [
        { window: '5m', status: 'UNAVAILABLE', reason: 'NO_CANDLE_FEED' },
        { window: '1h', status: 'AVAILABLE', baseVolume: 400, closedAt: 43200000, relativeToMedian: 2,
          baselineWindows: 5, changeVsPreviousPct: 100, aggressiveFlow: { deltaBase: 120, tradeCount: 100 } },
      ],
      book: {
        status: 'AVAILABLE', spreadBps: 1, quoteAgeMs: 250, bidDepth1pctQuote: 3000, askDepth1pctQuote: 1000,
        bidShare1pct: 0.75, exit: { conservativeBaseCapacity: 12 },
        impactCurve: [{ side: 'sell', requestedQuote: 50000, filledFully: false }],
      },
      depthExhaustion: { status: 'MEASURED', pressure: 'ASK_DEPTH_AND_SELLING', bookSource: 'BINANCE_SPOT_DEPTH_STREAM',
        bookAt: 43200000, bookUpdateId: 220, bandBps: 15, depthRatioThreshold: 3, bidDepthQuote: 200, askDepthQuote: 810,
        tradeSource: 'BINANCE_SPOT_AGG_TRADES', polledAt: 43200100, flowStart: 43197000, flowEndExclusive: 43200000,
        firstCoverageId: 10, lastCoverageId: 13, tradeCount: 2, takerDeltaQuote: -300 },
    },
    featuresResearch: {
      candleOpenAt: 39600000, wma20: 104, hma20: 106, keltner: null, parabolicSar: null,
      ichimoku: { conversion9: 100, base26: 100, leadingA: 100, leadingB52: null, laggingClose: 105, displacementBars: 26 },
      parkinson20: null, garmanKlass20: null,
    },
    timeframeAgreement: { state: 'CONFLICTING_SIGNALS', asOf: 43200000, readings: [
      { timeframe: '15m', trend: 'BULLISH', status: 'VALID', closedAt: 43200000, issues: [] },
      { timeframe: '1h', trend: 'UNKNOWN', status: 'UNAVAILABLE', closedAt: null, issues: ['No closed candles in the market cache'] },
      { timeframe: '4h', trend: 'BEARISH', status: 'VALID', closedAt: 43200000, issues: [] },
    ] },
    chartIntelligence: { status: 'VALID', trend: 'UNKNOWN', note: 'Fixture evidence only; confidence is not calibrated.', issues: [],
      anchoredVwap: [
        { anchor: 'UTC_DAY', anchorAt: 0, price: 100, deviationPct: 5 },
        { anchor: 'UTC_WEEK', anchorAt: -259200000, price: null, deviationPct: null },
      ],
      detections: [{ kind: 'BREAKOUT_UP', confidence: 0.6, calibration: 'NOT_CALIBRATED', boundaries: { low: 100, high: 105 }, evidence: ['close=105'], method: 'Prior 20-bar high', invalidation: 'Close back below 100', expiresAt: 3600000 }] }
  } }));
  await page.goto('/terminal/CHARTFIXTURE');
  await expect(page.getByText('Chart intelligence · closed candles')).toBeVisible();
  const agreement = page.getByRole('table', { name: /Timeframe agreement · CONFLICTING SIGNALS/ });
  await expect(agreement.getByRole('row', { name: /15m/ })).toContainText('BULLISH');
  await expect(agreement.getByRole('row', { name: /1h/ })).toContainText('No closed candles in the market cache');
  await expect(agreement.getByRole('row', { name: /4h/ })).toContainText('BEARISH');
  await expect(page.getByRole('cell', { name: /BREAKOUT_UP/ })).toBeVisible();
  await expect(page.getByText('Close back below 100')).toBeVisible();
  await expect(page.getByRole('row', { name: /UTC DAY/ })).toContainText('+5.00%');
  await expect(page.getByRole('row', { name: /UTC WEEK/ })).toContainText('Unavailable');
  await expect(page.getByText(/60% rule strength/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Hull moving average/ })).toContainText('106.0000');
  const activity = page.getByRole('table', { name: 'Binance closed-candle observations' });
  await expect(activity.getByRole('row', { name: /5m/ })).toContainText('Unavailable');
  await expect(activity.getByRole('row', { name: /1h/ })).toContainText('2.00×');
  await expect(page.getByRole('row', { name: /sell 50,000/ })).toContainText('Insufficient visible depth');
  await expect(page.getByText('Ask depth and taker selling aligned')).toBeVisible();
  await expect(page.getByText('-300.00 USDT · 2 aggregate trades')).toBeVisible();
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

test('market coverage uses the saved IANA timezone and shows unsupported venues', async () => {
  await page.goto('/settings');
  await page.getByRole('textbox', { name: 'IANA timezone' }).fill('Asia/Manila');
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/calendar/tz') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save timezone' }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(page.getByRole('textbox', { name: 'IANA timezone' })).toHaveValue('Asia/Manila');
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Market coverage' }).click();
  await expect(page.getByText(/Asia\/Manila/)).toBeVisible();
  await expect(page.getByRole('row', { name: /U.S. equities/ })).toContainText('PENDING CREDENTIALS');
  await expect(page.getByRole('row', { name: /Tokenized equities/ })).toContainText('Unavailable');
  await expect(page.getByRole('row', { name: /Forex/ })).toContainText('Reference only');
  await expect(page.getByRole('row', { name: /DEX tokens and memecoins/ })).toContainText('Research only');
  await page.goto('/calendar');
  await expect(page.getByText('Asia/Manila', { exact: true })).toBeVisible();
});

test('SEC research keeps acceptance and report dates separate', async () => {
  const sourceUrl = 'https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/0000123456-26-000001-index.htm';
  await page.route('**/api/research/filings/123456', route => route.fulfill({ json: {
    cik: '0000123456', note: 'Fixture SEC filing metadata.',
    filings: [{
      accessionNumber: '0000123456-26-000001', form: '10-Q', filingDate: '2026-05-06',
      reportDate: '2026-03-31', acceptedAt: '2026-05-06T20:00:00Z', items: [], sourceUrl,
    }],
  } }));
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'SEC filings' }).click();
  await page.getByRole('textbox', { name: 'Company CIK' }).fill('123456');
  await page.getByRole('button', { name: 'Find filings' }).click();
  await expect(page.getByRole('link', { name: '10-Q' })).toHaveAttribute('href', sourceUrl);
  const filing = page.getByRole('row', { name: /10-Q/ });
  await expect(filing).toContainText('2026-05-06T20:00:00Z');
  await expect(filing).toContainText('2026-03-31');
  await page.unroute('**/api/research/filings/123456');
});

test('risk center shows research-only paper scenarios', async () => {
  await page.goto('/risk');
  await expect(page.getByText('Paper portfolio stress', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Flash crash/ })).toContainText('NO EXPOSURE');
  await expect(page.getByRole('row', { name: /USDT cash depeg/ })).toContainText('MODELED');
});

test('decision record displays a recorded paper rejection separately from strategy and risk', async () => {
  const url = '**/api/decisions/omega-fixture';
  await page.route(url, route => route.fulfill({ json: {
    report: {
      asset: 'OMEGA', market: 'crypto', venue: 'binance',
      strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
      decision: 'PAPER_TRADE', finalDecision: 'ENTER', direction: 'LONG',
      consensus: { id: 'q-fixture', state: 'STRONG_CONSENSUS' }, createdAt: '2026-06-01T00:00:00Z',
      reason: 'Fixture strategy decision', disclaimer: 'Paper research fixture.', takeProfit: [],
      expectedCosts: { funding: 'N/A' }, dataFreshness: { status: 'OK', quoteAgeMs: 500, bookAgeMs: 500 },
      opportunity: { score: 70, version: 'fixture' }, riskAssessment: [], missingInformation: [],
      supportingEvidence: [], opposingEvidence: [], risk: { decision: 'ALLOW', policyVersion: 1, traceId: 'fixture' },
    },
    paperEntry: { orderId: 'ord-omega-test', status: 'REJECTED', filledQty: 0, averageFillPrice: null, rejectReason: 'ORDER_BOOK_STALE' },
  } }));
  await page.goto('/decision/omega-fixture');
  await expect(page.getByText('Defend · Risk assessment')).toBeVisible();
  await expect(page.getByText('Execute · Paper OMS')).toBeVisible();
  await expect(page.getByText('ord-omega-test')).toBeVisible();
  await expect(page.getByText('ORDER_BOOK_STALE')).toBeVisible();
  await page.unroute(url);
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
