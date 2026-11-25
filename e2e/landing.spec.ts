import { test, expect } from '@playwright/test';

const SLOGAN = /Trading reimagined for the age of intelligence/i;

/** Public marketing page must never require auth or expose live trading data. */
test('public landing tells the five-chapter story with an authenticated terminal entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: SLOGAN })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Landing navigation' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'MIA AI' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Enter MIA/i }).first()).toHaveAttribute('href', '/app');
  for (const id of ['top', 'meet', 'brainos', 'action', 'fast', 'deep', 'guardian', 'journey']) {
    await expect(page.locator('#' + id)).toHaveCount(1);
  }
  await expect(page.locator('[data-chapter]')).toHaveCount(5);
  await expect(page.getByText(/live execution locked/i).first()).toBeVisible();
  await expect(page.getByText(/Planned mode · not live/i)).toHaveCount(2);
  await page.getByRole('link', { name: 'Discover the experience' }).click();
  await expect(page).toHaveURL(/#meet$/);
  await expect(page.getByRole('heading', { name: 'Meet the intelligence behind MIA.' })).toBeVisible();
});

test('product demo shows a blocked trade without any API call', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/**', route => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('/#action');
  await page.getByRole('button', { name: /03 DEFEND/ }).click();
  await page.getByRole('button', { name: 'Show a blocked trade' }).click();
  await expect(page.getByText('Risk gate REJECTED · order book 74 s old (limit 60 s)')).toBeVisible();
  await page.getByRole('button', { name: 'Run Session' }).click();
  await expect(page.getByText('Demo session running')).toBeVisible();
  expect(calls).toEqual([]);
});

test('public landing has no overflow on mobile and menu opens with keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const menu = page.getByRole('button', { name: 'Open menu' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Mobile landing navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Mobile landing navigation' })).toHaveCount(0);
});

test('public page does not depend on authenticated API data', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/**', route => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  expect(calls).toEqual([]);
});

test('scrolling never opens sign-in; only an explicit Enter MIA click does', async ({ page }) => {
  await page.goto('/');
  for (const f of [0.25, 0.5, 0.75, 1]) {
    await page.evaluate((f) => window.scrollTo(0, document.documentElement.scrollHeight * f), f);
    await page.waitForTimeout(150);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  // Cancel returns to the landing page.
  await page.locator('.v5-nav-cta').click();
  await expect(page.getByRole('dialog', { name: 'Opening secure sign-in' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page).not.toHaveURL(/\/app$/);

  // The final call to action hands off to the protected app (offline test server: passphrase owner setup).
  await page.locator('#v5-enter-final').click();
  await expect(page.getByRole('dialog', { name: 'Opening secure sign-in' })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});

test('reduced motion keeps every chapter readable without pinning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.v5')).toHaveAttribute('data-motion', 'reduced');
  const pin = await page.locator('.v5-pin').evaluate((el) => getComputedStyle(el).position);
  expect(pin).toBe('relative');
  const risk = page.locator('[data-layer="risk"]');
  await risk.scrollIntoViewIfNeeded();
  expect(Number(await risk.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
});
