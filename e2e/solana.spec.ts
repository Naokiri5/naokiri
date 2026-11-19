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

test('on-chain mint checks show per row, a block is explained, and a failed check is reported', async ({ page }) => {
  const blocked = { ...candidate, mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'BLK', status: 'REJECT', blockers: ['BLOCK_ACTIVE_MINT_AUTHORITY'],
    mintCheck: { status: 'BLOCK', reasons: ['BLOCK_ACTIVE_MINT_AUTHORITY'], tokenProgram: 'SPL_TOKEN', slot: 999, checkedAt: Date.now() } };
  const passed = { ...candidate, mintCheck: { status: 'PASS_MINT_CHECKS_ONLY', reasons: [], tokenProgram: 'SPL_TOKEN', slot: 998, checkedAt: Date.now() } };
  await page.route('**/api/discover**', async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, solanaHunter: { asOf: Date.now(), stale: false, executionReady: false, note: 'DEX Screener watchlist only.',
      mintChecks: { configured: true, lastRunAt: Date.now(), lastError: 'HTTP_429', checked: 2 }, candidates: [passed, blocked] } } });
  });
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  await expect(page.getByRole('columnheader', { name: 'Mint check' })).toBeVisible();
  await expect(page.getByText('authorities revoked')).toBeVisible();
  await expect(page.getByText('blocked', { exact: true })).toBeVisible();
  await expect(page.getByText('BLOCK_ACTIVE_MINT_AUTHORITY')).toBeVisible();
  await expect(page.getByText(/last on-chain mint check failed \(HTTP_429\)/)).toBeVisible();
  await expect(page.getByText(/Mint and freeze authority are read on-chain/)).toBeVisible();
  const card = page.locator('.card', { hasText: 'Watchlist only. Not a trade signal.' });
  await expect(card.getByRole('button')).toHaveCount(0);
});

test('Settings offers opt-in Solana watchlist alerts for Telegram, off by default, and saves the choice', async ({ page }) => {
  let saved: unknown = null;
  await page.route('**/api/settings/notify', async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/settings');
  const box = page.getByRole('checkbox', { name: 'Send Solana watchlist alerts to Telegram' });
  await expect(box).not.toBeChecked();
  await expect(page.getByText(/never a buy button or a trading-bot link/)).toBeVisible();
  await box.check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect.poll(() => (saved as { solanaWatchlistTelegram?: boolean } | null)?.solanaWatchlistTelegram).toBe(true);
});

test('the read-only Pump.fun feed shows launches and graduations with no actions, and explains how to turn it on', async ({ page }) => {
  const launch = { signature: 'sig-l', mint: 'GS6Ab6FQbmv8cthkYXJRsazhy2wXMVzymmiQrcc2pump', creator: '8sd7SVuBC3fhNHWqhyPrLLscRPhbtYMRq1Co1PaykRki', name: 'Demo', symbol: 'DEMO', createdAt: Date.now() - 30_000 };
  const grad = { signature: 'sig-g', mint: 'Fch8UPaxDCz1QMR2ZMwcDykk9FNih26LmgyGKveRpump', pool: '88drjfVSrKQBdgj6cT6CdemKjkQuugZsZw5NiuMMsjpp', graduatedAt: Date.now() - 60_000 };
  let feed: Record<string, unknown> = { enabled: true, connected: true, lastEventAt: Date.now(), reconnects: 0, lastError: null, launchesSeen: 1, graduationsSeen: 1, launches: [launch], graduations: [grad] };
  await page.route('**/api/discover**', async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, solanaHunter: { asOf: Date.now(), stale: false, executionReady: false, note: 'x', candidates: [], pumpfun: feed } } });
  });
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  const panel = page.getByLabel('Pump.fun live feed');
  await expect(panel.getByText('Pump.fun live (read-only, from Solana)')).toBeVisible();
  await expect(panel.getByText(launch.mint)).toBeVisible();
  await expect(panel.getByText(grad.mint)).toBeVisible();
  await expect(panel.getByText(/Not a trade signal/)).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  await expect(panel.getByRole('link')).toHaveCount(0);
  feed = { ...feed, enabled: false };
  await page.reload();
  await page.getByRole('tab', { name: 'Solana watchlist' }).click();
  await expect(page.getByText(/Pump.fun live feed: off\. To turn it on, set MIA_PUMPFUN_FEED=1/)).toBeVisible();
});
