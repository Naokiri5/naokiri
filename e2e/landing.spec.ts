import { test, expect } from '@playwright/test';

/** Public marketing page must never require auth or expose live trading data. */
test('public landing has editorial content and authenticated terminal entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /THE ART OF INTELLIGENT DECISIONS/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Landing navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Enter Terminal/i }).first()).toHaveAttribute('href', '/app');
  for (const id of ['philosophy','engine','guardian','joe','preview','architecture','roadmap']) {
    await expect(page.locator('#' + id)).toHaveCount(1);
  }
  await expect(page.getByText(/Live execution remains locked/i).first()).toBeVisible();
  await page.getByRole('link', { name: 'Explore MIA' }).click();
  await expect(page).toHaveURL(/#philosophy$/);
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
  expect(calls).toEqual([]);
});

test('kinetic editorial manifesto is usable and visual motion can be switched off', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /NOT EVERY SIGNAL DESERVES ACTION/i })).toBeVisible();
  const motion = page.getByRole('button', { name: 'Turn off visual motion' });
  await expect(motion).toBeVisible();
  await motion.click();
  await expect(page.locator('.palazzo')).toHaveAttribute('data-motion', 'off');
  await expect(page.getByRole('button', { name: 'Turn on visual motion' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('link', { name: /ENTER THE RESEARCH TERMINAL/i })).toHaveAttribute('href', '/app');
});

test('honors reduced motion and keeps editorial text visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.palazzo')).toHaveAttribute('data-motion', 'off');
  await expect(page.getByRole('heading', { name: /THE ART OF INTELLIGENT DECISIONS/i })).toBeVisible();
});
