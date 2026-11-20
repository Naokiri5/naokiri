import { test, expect, type Page } from '@playwright/test';
import { readTestSetupCode, TEST_OWNER_PASSPHRASE as PW } from './owner-fixture';

/**
 * PR A — six-destination navigation. Presentation only: every original URL must still open its page, and nothing in
 * the navigation can change the operating mode. Runs after app.spec.ts has created the owner (serial, same server).
 */
const GROUPS: [string, string[]][] = [
  ['Markets', ['/terminal', '/scanner', '/discover', '/bubbles', '/whales', '/holders', '/copy', '/news']],
  ['Autopilot', ['/bot', '/risk', '/lab']],
  ['Portfolio', ['/portfolio', '/history', '/journal', '/calendar', '/wallet']],
  ['AI Intelligence', ['/intelligence', '/ditas', '/qhef', '/academy']],
  ['Settings & Security', ['/connections', '/notifications', '/security', '/qa', '/settings']],
];
test.describe.configure({ mode: 'serial' });
let page: Page; const errors: string[] = [];
async function login(p: Page) {
  await p.context().route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('/'); const pw = p.locator('input[type=password]');
  await pw.first().fill(PW);
  if (await p.getByText('Owner setup').count()) {
    await pw.nth(1).fill(PW);
    await p.getByLabel('Setup code').fill(readTestSetupCode());
  }
  await p.locator('form button').first().click(); await expect(p.locator('h1')).toBeVisible();
}
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await login(page); });

test('every original route is reachable from its destination and keeps its URL', async () => {
  const side = page.getByRole('navigation', { name: 'Main' });
  await page.goto('/'); await expect(side.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.mode')).not.toHaveText(/^(…|CHECKING)$/); const modeBefore = await page.locator('.mode').textContent();
  for (const [group, paths] of GROUPS) {
    const btn = side.getByRole('button', { name: group });
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    for (const path of paths) {
      await side.locator(`#nav-${await btn.getAttribute('aria-controls').then((x) => x!.slice(4))} a[href="${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`)); await expect(page.locator('h1')).toBeVisible();
    }
  }
  await side.getByRole('link', { name: 'Trader Joe' }).click(); await expect(page).toHaveURL(/\/joe$/);
  expect(await page.locator('.mode').textContent()).toBe(modeBefore); // navigation never changes the operating mode
});

test('deep links still work and highlight their destination; sibling tabs link related pages', async () => {
  await page.goto('/terminal/BTCUSDT'); await expect(page.locator('h1')).toBeVisible();
  const markets = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Markets' });
  await expect(markets).toHaveAttribute('aria-expanded', 'true');
  const tabs = page.getByRole('navigation', { name: 'Markets pages' });
  await expect(tabs.getByRole('link')).toHaveCount(8);
  await tabs.getByRole('link', { name: 'AI Scanner' }).click(); await expect(page).toHaveURL(/\/scanner$/);
});

test('groups are keyboard operable', async () => {
  await page.goto('/');
  const btn = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Portfolio' });
  const before = await btn.getAttribute('aria-expanded');
  await btn.focus(); await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
  await page.keyboard.press('Enter'); await expect(btn).toHaveAttribute('aria-expanded', before ?? 'false');
});

test('collapsed rail keeps every destination one click away', async () => {
  await page.goto('/'); await page.getByRole('button', { name: 'Collapse menu' }).click();
  const side = page.getByRole('navigation', { name: 'Main' });
  await side.getByRole('link', { name: 'Autopilot' }).click(); await expect(page).toHaveURL(/\/bot$/);
  await page.getByRole('button', { name: 'Expand menu' }).click();
  await expect(side.getByRole('button', { name: 'Autopilot' })).toBeVisible();
});

test('command palette understands plain-language synonyms', async () => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  // Readiness belongs to this document's rendered shell, never a poll finishing from the previous document.
  await expect(page.locator('.mode')).not.toHaveText(/^(…|CHECKING)$/);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const box = palette.getByRole('textbox', { name: 'Command' }); const opts = palette.getByRole('option');
  await box.fill('profit'); await expect(opts.filter({ hasText: 'Portfolio' }).first()).toBeVisible(); await expect(opts.filter({ hasText: 'Profit Calendar' })).toBeVisible();
  await box.fill('ai bots'); await expect(opts.filter({ hasText: 'AI Intelligence' })).toBeVisible();
  await box.fill('fund'); await expect(opts.filter({ hasText: 'Bot Account' })).toBeVisible(); await expect(opts.filter({ hasText: 'Wallet & Withdrawals' })).toBeVisible();
  await box.fill('pause new'); await expect(opts.first()).toContainText('Pause new orders'); // actions named directly stay first
  await page.keyboard.press('Escape');
});

test('mobile: bottom bar + More, mode badge stays visible, Escape closes the menu', async ({ browser }) => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } }); await login(m);
  await expect(m.locator('.mode')).toBeVisible();
  const bar = m.getByRole('navigation', { name: 'Mobile' });
  await bar.getByRole('link', { name: 'Markets' }).click(); await expect(m).toHaveURL(/\/terminal$/);
  await bar.getByRole('button', { name: 'More pages' }).click();
  const side = m.getByRole('navigation', { name: 'Main' }); await expect(side).toBeVisible();
  await side.getByRole('button', { name: 'Settings & Security' }).click();
  await side.locator('a[href="/security"]').click(); await expect(m).toHaveURL(/\/security$/); await expect(side).toBeHidden();
  await bar.getByRole('button', { name: 'More pages' }).click(); await expect(side).toBeVisible();
  await m.keyboard.press('Escape'); await expect(side).toBeHidden();
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await m.close();
});

test('no console errors during navigation', async () => { expect(errors, errors.join('\n')).toEqual([]); });
