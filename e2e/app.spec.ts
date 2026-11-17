import { test, expect, type Page } from '@playwright/test';

/**
 * QA-02 Frontend Testing · end-to-end, in order: owner setup → risk policy → funding → PAPER mode →
 * every workspace renders with zero console errors → command palette → mobile layout.
 * Runs against an OFFLINE server (no live data), so pages must show honest empty/stale states, not crash.
 */
const PW = 'e2e owner passphrase';
const ROUTES = ['/', '/terminal/BTCUSDT', '/scanner', '/discover', '/intelligence', '/qhef', '/joe', '/bubbles', '/whales', '/copy', '/holders', '/news',
  '/bot', '/risk', '/portfolio', '/history', '/journal', '/calendar', '/lab', '/wallet', '/security', '/connections', '/notifications', '/qa', '/settings'];
const errors: string[] = [];
function watch(page: Page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
}
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); watch(page); });

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

test('no console errors anywhere', async () => { expect(errors, errors.join('\n')).toEqual([]); });

test('mobile layout has no horizontal overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  for (const r of ['/', '/scanner', '/risk', '/qhef', '/history']) { await m.goto(r); await expect(m.locator('h1')).toBeVisible(); expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), r).toBe(true); }
  await expect(m.getByRole('group', { name: 'Autopilot status' }).locator('[data-seg=live]')).toBeInViewport();
  await ctx.close();
});
