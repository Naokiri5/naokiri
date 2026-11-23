import { test, expect, type Page } from '@playwright/test';

/** MIA 6.0 four-section navigation. Real pages and existing authority stay unchanged. */
const PW = 'e2e owner passphrase';
const DESTINATIONS = [
  ['Autopilot', '/autopilot'],
  ['Trader Joe', '/trader-joe'],
  ['Smart Portfolio', '/smart-portfolio'],
  ['Settings', '/settings'],
] as const;

test.describe.configure({ mode: 'serial' });
let page: Page;
const errors: string[] = [];
async function login(p: Page) {
  await p.context().route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('/app');
  const pw = p.locator('input[type=password]');
  if (await p.getByText('Owner setup').count()) {
    await pw.nth(0).fill(PW);
    await pw.nth(1).fill(PW);
  } else {
    await pw.first().fill(PW);
  }
  await p.locator('form button').first().click();
  await expect(p.locator('h1')).toBeVisible();
}
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page);
});

test('exactly four main links lead to existing functional views without altering trading mode', async () => {
  await page.goto('/app');
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  await expect(sidebar.getByRole('link')).toHaveCount(4);
  await expect(page.locator('.mode')).not.toHaveText(/^(CHECKING|…|UNKNOWN)$/);
  const before = await page.locator('.mode').textContent();
  for (const [name, path] of DESTINATIONS) {
    const link = sidebar.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
    await expect(page.locator('h1')).toBeVisible();
  }
  expect(await page.locator('.mode').textContent()).toBe(before);
  await expect(page.getByRole('group', { name: 'Autopilot status' }).locator('[data-seg=live]')).toHaveText(/LOCKED/);
});

test('legacy deep links stay functional and highlight the owning primary section', async () => {
  const pairs = [
    ['/terminal/BTCUSDT', 'Autopilot'],
    ['/bot', 'Autopilot'],
    ['/joe', 'Trader Joe'],
    ['/ditas', 'Trader Joe'],
    ['/portfolio', 'Smart Portfolio'],
    ['/history', 'Smart Portfolio'],
    ['/risk', 'Settings'],
    ['/lab', 'Settings'],
    ['/security', 'Settings'],
  ] as const;
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  for (const [path, section] of pairs) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: section, exact: true })).toHaveClass(/active/);
  }
});

test('command palette still discovers old screens and the existing risk-reducing action', async () => {
  await page.goto('/app');
  await expect(page.locator('h1')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Command' });
  const options = page.getByRole('option');
  await input.fill('ai bots');
  await expect(options.filter({ hasText: 'AI Intelligence' })).toBeVisible();
  await input.fill('profit calendar');
  await expect(options.filter({ hasText: 'Profit Calendar' })).toBeVisible();
  await input.fill('pause new');
  await expect(options.first()).toContainText('Pause new orders');
  await page.keyboard.press('Escape');
});

test('mobile navigation exposes the same four destinations and More control without overflow', async ({ browser }) => {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(mobile);
  const bar = mobile.getByRole('navigation', { name: 'Mobile' });
  for (const [name, path] of DESTINATIONS) {
    const link = bar.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', path);
  }
  await bar.getByRole('link', { name: 'Smart Portfolio' }).click();
  await expect(mobile).toHaveURL(/\/smart-portfolio$/);
  await bar.getByRole('button', { name: 'More pages' }).click();
  const sidebar = mobile.getByRole('navigation', { name: 'Main' });
  await expect(sidebar).toBeVisible();
  await mobile.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.close();
});

test('no uncaught frontend errors during navigation', async () => {
  expect(errors, errors.join('\n')).toEqual([]);
});
