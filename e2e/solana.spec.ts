import { test, expect } from '@playwright/test';
import { signInTestOwner } from './owner-fixture';

/** Omega PR-01: the Solana watchlist is read-only and says so; it never offers a buy action. */
const candidate = {
  mint: 'So11111111111111111111111111111111111111112', symbol: 'TEST', pairAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', dex: 'raydium',
  ageMinutes: 12, liquidityUsd: 100_000, volume1hUsd: 30_000, observedBuys1h: 35, observedSells1h: 15, momentum1hPct: 4, rankScore: 61,
  status: 'WATCH', blockers: [], notes: ['not verified'], tradingEligible: false,
};

test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await signInTestOwner(page);
});

test('the Solana watchlist shows candidates read-only with no trade action', async ({ page }) => {
  await page.route('**/api/discover**', async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, solanaHunter: { asOf: Date.now(), stale: false, skippedUntrustedQuote: 2, executionReady: false, note: 'DEX Screener watchlist only.', candidates: [candidate] } } });
  });
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  await expect(page.getByText('Watchlist only. Not a trade signal.')).toBeVisible();
  await expect(page.getByText(/2 Solana pools left out: priced against a token other than SOL, USDC or USDT/)).toBeVisible();
  await expect(page.getByRole('cell', { name: /TEST/ })).toBeVisible();
  await expect(page.getByText(candidate.mint, { exact: true })).toBeVisible(); // full mint, because tickers can be faked
  await expect(page.getByText('not a probability of profit', { exact: false })).toBeVisible();
  // The watchlist card itself offers no action at all (the app shell's own emergency controls are outside it).
  const card = page.locator('.card', { hasText: 'Watchlist only. Not a trade signal.' });
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(card.getByRole('link', { name: /buy|trade|order|swap/i })).toHaveCount(0);
});

test('stale DEX data shows a stale warning and no candidates', async ({ page }) => {
  await page.route('**/api/discover**', async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, solanaHunter: { asOf: null, stale: true, executionReady: false, note: 'DEX Screener watchlist only.', candidates: [] } } });
  });
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  await expect(page.getByText(/stale, missing or future-dated/)).toBeVisible();
  await expect(page.getByText('Waiting for fresh DEX Screener data…')).toBeVisible();
});

test('a ranker failure shows its own warning, not a stale-data or "no pairs" message', async ({ page }) => {
  await page.route('**/api/discover**', async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, solanaHunter: { asOf: Date.now(), stale: false, rankerFailed: true, executionReady: false, note: 'DEX Screener watchlist only.', candidates: [] } } });
  });
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  await expect(page.getByText(/could not process the current DEX Screener sample/)).toBeVisible();
  await expect(page.getByText(/stale, missing or future-dated/)).toHaveCount(0);
  await expect(page.getByText('No Solana pairs in the current DEX Screener sample.')).toHaveCount(0);
});

test('a server without the watchlist block says so instead of claiming there are no pairs', async ({ page }) => {
  await page.route('**/api/discover**', async (route) => {
    const { solanaHunter: _omitted, ...real } = await (await route.fetch()).json();
    await route.fulfill({ json: real });
  });
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  await expect(page.getByText('This server does not report a Solana watchlist.')).toBeVisible();
  await expect(page.getByText('Watchlist only. Not a trade signal.')).toBeVisible();
});
