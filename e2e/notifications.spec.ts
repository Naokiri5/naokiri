import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

/**
 * S6 attention surfaces against the real OFFLINE server: severity notification center, sticky CRITICAL strip and the
 * "Why MIA is not trading" board. Rows are written straight into the e2e database (WAL, same file the server uses),
 * so grouping, acknowledgement and the board projection run through the real API. Runs after app.spec.ts (owner exists).
 */
const PW = 'e2e owner passphrase';
const DB = resolve(__dirname, '.data', 'mia.db');
const BTC = 'Protection unverified: crypto:binance:BTCUSDT';
const TTL = 2 * 3600_000;
let seq = 0;

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  try { return fn(db); } finally { db.close(); }
}
function seedNotification(db: DatabaseSync, severity: string, title: string, body: string, source: string, ts: number) {
  db.prepare('INSERT INTO notifications(id,ts,severity,title,body,source,delivery) VALUES (?,?,?,?,?,?,?)')
    .run('ntf_e2e_' + (++seq), ts, severity, title, body, source, JSON.stringify({ inApp: 'DELIVERED', telegram: 'NOT_CONFIGURED' }));
}
function seedDecision(db: DatabaseSync, symbol: string, state: string, createdAt: number, report: object | string) {
  const id = 'dec_e2e_' + (++seq); const instrument = 'crypto:binance:' + symbol;
  const body = typeof report === 'string' ? report : JSON.stringify({ id, asset: symbol, instrumentId: instrument, decision: state, steps: [], risk: null, ...report });
  db.prepare('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, 'cand_' + id, instrument, 'crypto', 'NO_POSITION', 'trend_pullback', state, 55, null, null, createdAt, body);
  return id;
}

async function login(p: Page) {
  await p.context().route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  const state = await (await p.request.get('/api/auth/state')).json();
  expect((await p.request.post(state.setup ? '/api/auth/login' : '/api/auth/setup', { data: { password: PW } })).status()).toBe(200);
}

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  const now = Date.now();
  withDb((db) => {
    for (let i = 0; i < 3; i++) seedNotification(db, 'CRITICAL', BTC, 'Order book 400s old. The paper position stays open (no synthetic fill).', 'risk', now - (3 - i) * 60_000);
    for (let i = 0; i < 2; i++) seedNotification(db, 'WARNING', 'Strategy auto-suspended', 'breakout_momentum: expectancy below zero over 20 trades', 'strategy-health', now - (5 - i) * 60_000);
    for (let i = 0; i < 4; i++) seedNotification(db, 'INFO', 'Paper entry: ETH', '0.5 @ 3120.00, stop 3050.00', 'oms', now - (10 - i) * 60_000);
    seedDecision(db, 'BTCUSDT', 'REJECTED', now - 12 * 60_000, { risk: { decision: 'DENY', reasonCodes: ['DAILY_LOSS_BREAKER -2.10%', 'SPREAD 9.0bps > 8'], policyVersion: 1, ts: new Date(now - 12 * 60_000).toISOString() } });
    seedDecision(db, 'ETHUSDT', 'REJECTED', now - 50 * 60_000, { steps: [{ step: 3, name: 'Asset eligibility / safety', result: 'FAIL', detail: 'CAUTION: thin float' }] });
    seedDecision(db, 'ETHUSDT', 'WAIT_FOR_CONFIRMATION', now - 30 * 60_000, { consensus: { state: 'NO_QUORUM' }, missingInformation: ['news domain abstained'] });
    seedDecision(db, 'SOLUSDT', 'INSUFFICIENT_DATA', now - 5 * 60_000, { steps: [{ step: 1, name: 'Market data freshness', result: 'FAIL', detail: 'quote 400s old' }] });
    seedDecision(db, 'XRPUSDT', 'REJECTED', now - 3 * 3600_000, { risk: { decision: 'DENY', reasonCodes: ['NO_PRICE'], policyVersion: 1, ts: new Date(now - 3 * 3600_000).toISOString() } });
    seedDecision(db, 'DOGEUSDT', 'REJECTED', now - 8 * 60_000, '{not json');
    seedDecision(db, 'ADAUSDT', 'REJECTED', now - 40 * 60_000, { risk: { decision: 'DENY', reasonCodes: ['SPREAD 12bps > 8'], policyVersion: 1, ts: 'x' } });
    seedDecision(db, 'ADAUSDT', 'PAPER_TRADE', now - 20 * 60_000, {});
  });
  page = await browser.newPage(); await login(page);
});

test('notification center groups repeats by severity and pins unacknowledged CRITICAL', async () => {
  await page.goto('/notifications');
  const pinned = page.locator('section.card', { hasText: 'Needs acknowledgement (1)' });
  await expect(pinned).toContainText(BTC); await expect(pinned).toContainText('×3 · 3 unread');
  await expect(pinned.getByRole('link', { name: 'Root cause →' })).toHaveAttribute('href', '/risk');
  await expect(page.locator('section.card', { hasText: 'Warning (1)' })).toContainText('×2');
  await expect(page.locator('section.card', { hasText: 'Warning (1)' }).getByRole('link', { name: 'Root cause →' })).toHaveAttribute('href', '/lab');
  await expect(page.locator('section.card', { hasText: 'Info (' })).toContainText('Paper entry: ETH');
  await page.getByLabel('Hide INFO').check();
  await expect(page.getByText('Paper entry: ETH')).toHaveCount(0);
  await expect(page.locator('section.card', { hasText: 'Needs acknowledgement (1)' })).toBeVisible();
  await expect(page.locator('section.card', { hasText: 'Warning (1)' })).toBeVisible();
  await page.getByLabel('Hide INFO').uncheck();
  await page.getByRole('button', { name: 'Mark non-critical read' }).click();
  await expect(page.locator('section.card', { hasText: 'Needs acknowledgement (1)' })).toContainText('3 unread');
});

test('critical strip links to the root cause, survives a failed acknowledgement, clears on a real one', async () => {
  await page.goto('/');
  const strip = page.locator('.crit-strip');
  await expect(strip).toContainText(BTC);
  await strip.getByRole('link', { name: 'Root cause →' }).click(); await expect(page).toHaveURL(/\/risk$/);
  await page.route('**/api/notifications/ack', (r) => r.fulfill({ status: 500, json: { error: 'internal server error' } }));
  await strip.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(strip).toContainText('internal server error');
  await page.reload(); await expect(page.locator('.crit-strip')).toContainText(BTC);
  await page.unroute('**/api/notifications/ack');
  await page.locator('.crit-strip').getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.locator('.crit-strip')).toHaveCount(0);
  const audit = await (await page.request.get('/api/audit')).json();
  expect(audit.some((a: any) => a.action === 'notification.ack' && JSON.parse(a.detail).title === BTC)).toBe(true);
});

test('a failed refresh after an empty critical summary shows UNKNOWN, never a silent all-clear', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await page.context().storageState() }); const p = await ctx.newPage();
  await p.clock.install();
  await p.route('**/api/notifications/critical', (r) => r.fulfill({ json: { groups: 0, unread: 0, top: [] } }));
  await p.goto('/'); await expect(p.locator('h1')).toBeVisible(); await expect(p.locator('.crit-strip')).toHaveCount(0);
  await p.unroute('**/api/notifications/critical');
  await p.route('**/api/notifications/critical', (r) => r.fulfill({ status: 500, json: { error: 'internal server error' } }));
  await p.clock.fastForward('00:16');
  await expect(p.locator('.crit-strip')).toContainText('Critical notification status unknown');
  await ctx.close();
});

test('why MIA is not trading: grouped reasons, superseded history, unreadable reports, trades omitted', async () => {
  await page.goto('/scanner'); await page.getByRole('tab', { name: 'Why not trading' }).click();
  await expect(page.getByText('known blockers, not execution clearance')).toBeVisible();
  await expect(page.getByText('STALE DATA', { exact: true })).toBeVisible();
  const btc = page.locator('.nt-card', { hasText: 'BTCUSDT' });
  await expect(btc).toContainText('DAILY_LOSS_BREAKER -2.10%'); await expect(btc).toContainText('SPREAD 9.0bps > 8'); await expect(btc).toContainText('policy v1');
  const eth = page.locator('.nt-card', { hasText: 'ETHUSDT' });
  await expect(eth).toContainText('NO QUORUM'); await expect(eth).toContainText('superseded by'); await expect(eth).toContainText('news domain abstained');
  await expect(page.locator('.nt-card', { hasText: 'DOGEUSDT' })).toContainText('REPORT UNREADABLE');
  await expect(page.locator('.nt-card', { hasText: 'ADAUSDT' })).toHaveCount(0);
  await expect(page.getByText('1 instrument(s) left out because their latest decision was a trade.')).toBeVisible();
  await expect(page.locator('details.nt-stale summary')).toContainText('1 stale decision(s)');
});

test('board evidence ages on the client and turns STALE at the 2h TTL between polls', async ({ browser }) => {
  withDb((db) => seedDecision(db, 'AVAXUSDT', 'REJECTED', Date.now() - TTL + 15_000, { risk: { decision: 'DENY', reasonCodes: ['NO_ORDER_BOOK (cannot estimate slippage)'], policyVersion: 1, ts: 'x' } }));
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const board = await context.newPage();
    await board.clock.install();
    await board.goto('/scanner');
    await board.getByRole('tab', { name: 'Why not trading' }).click();
    const avax = board.locator('.nt-current > .nt-card', { hasText: 'AVAXUSDT' });
    await expect(avax).toContainText('RECENT');
    await board.clock.fastForward('00:16');
    await expect(board.locator('details.nt-stale summary')).toContainText('2 stale decision(s)');
    await expect(avax).toHaveCount(0);
  } finally { await context.close(); }
});

test('an empty board never invents a recommendation', async () => {
  await page.route('**/api/no-trade', (r) => r.fulfill({ json: { asOf: Date.now(), ttlMs: TTL, windowMs: 86_400_000, globalLabel: 'known blockers, not execution clearance', global: [], rows: [], omittedTrades: [] } }));
  await page.goto('/scanner'); await page.getByRole('tab', { name: 'Why not trading' }).click();
  await expect(page.getByText('No recorded non-trade decisions in the last 24 hours, so there is nothing to explain.')).toBeVisible();
  await expect(page.getByText(/This is not execution clearance/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/recommend|should (buy|trade)|NO SIGNAL/i);
  await page.unroute('**/api/no-trade');
});

test('notifications and the board fit a 390px screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  await m.goto('/notifications'); await expect(m.locator('h1')).toHaveText('Notifications');
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await m.goto('/scanner'); await m.getByRole('tab', { name: 'Why not trading' }).click(); await expect(m.locator('.nt-card').first()).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
