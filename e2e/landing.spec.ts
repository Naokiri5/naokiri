import { test, expect } from '@playwright/test';

/** Public marketing page must never require auth or expose live trading data. */
test('public landing has editorial content and authenticated terminal entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /One MIA\. Two minds\. Infinite possibilities\./i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Landing navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enter MIA' }).first()).toHaveAttribute('href', '/autopilot');
  for (const id of ['philosophy', 'engine', 'architecture', 'strategy', 'autopilot', 'joe', 'preview', 'guardian', 'roadmap']) {
    await expect(page.locator('#' + id)).toHaveCount(1);
  }
  await expect(page.getByText(/Live execution remains locked/i).first()).toBeVisible();
  await page.getByRole('link', { name: 'Explore Intelligence' }).click();
  await expect(page).toHaveURL(/#engine$/);
});

test('mode previews, strategy stages, and Joe examples are interactive and illustrative', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview DEEP' }).click();
  await expect(page.getByRole('button', { name: 'Preview DEEP' })).toHaveAttribute('aria-pressed', 'true');
  const comparison = page.getByRole('group', { name: 'Intelligence comparison' });
  await expect(comparison.getByRole('button', { name: 'DEEP' })).toHaveAttribute('aria-pressed', 'true');
  await comparison.getByRole('button', { name: 'FAST' }).click();
  await expect(page.getByText('Illustrative discovery radar')).toBeVisible();
  await page.getByRole('group', { name: 'Strategy reconstruction stages' }).getByRole('button', { name: 'Risk analysis' }).click();
  await expect(page.getByText(/lower band identifies/)).toBeVisible();
  await page.getByRole('button', { name: 'How does Paper work?' }).click();
  await expect(page.getByText('Example conversation')).toBeVisible();
  await expect(page.getByText(/simulated allocation and records simulated fills/)).toBeVisible();
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
  await expect(menu).toBeFocused();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('public page does not depend on authenticated API data', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/**', route => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(calls).toEqual([]);
});

test('motion preference is honored and can be saved', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.atelier-hero-mia')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Reduce motion' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reduce motion' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.atelier-hero-mia')).toHaveCSS('animation-name', 'none');
});
