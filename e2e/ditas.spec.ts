import { test, expect } from '@playwright/test';

import { signInTestOwner } from './owner-fixture';
test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await signInTestOwner(page);
});

test('DITAS shows honest empty records and no fabricated simulation results', async ({ page }) => {
  await page.goto('/ditas');
  await expect(page.getByRole('heading', { name: 'DITAS · Decision intelligence' })).toBeVisible();
  await expect(page.getByText('Actual portfolio · PAPER', { exact: true })).toBeVisible();
  await expect(page.getByText('No market data loaded. No health status is inferred.')).toBeVisible();
  await page.getByRole('tab', { name: 'Decision Twin' }).click();
  await expect(page.getByText('No Decision Twin results recorded. No simulated performance is displayed.')).toBeVisible();
  await page.getByRole('tab', { name: 'Calibration', exact: true }).click();
  await expect(page.getByText('UNCALIBRATED', { exact: true })).toBeVisible();
  await expect(page.locator('[role=alert]')).toHaveCount(0);
});

test('DITAS separates hypothetical results and exposes stored decision evidence', async ({ page }) => {
  const stamp = 1_700_000_000_000;
  await page.route('**/api/ditas', route => route.fulfill({ json: {
    counts: { snapshots: 1, events: 1, twins: 1, forecasts: 0, outcomes: 0 },
    dataHealth: [{ instrumentId: 'fixture:BTC', status: 'OK', issues: [] }],
    actual: { label: 'PAPER', orders: 2, fills: 2, closedPositions: 1, realizedPnl: 12, fees: 1 },
    controls: { mode: 'OBSERVE', pausedNewOrders: true, emergency: false },
    events: [{ id: 'event-fixture', kind: 'DECISION', instrumentId: 'fixture:BTC', strategyId: 'fixture-strategy', createdAt: stamp, snapshotId: 'snapshot-fixture' }],
    fingerprints: [], passports: [], coverage: [{ foundation: 'Decision Twin', status: 'PARTIAL', detail: 'Fixture research evaluation only' }],
    calibration: { status: 'UNCALIBRATED', sample: 0, brierScore: null, logLoss: null, ece: null, bins: [], uncertainty: ['No matched forecasts.'] },
    twins: [{ id: 'twin-fixture', eventId: 'event-fixture', createdAt: stamp, result: {
      kind: 'HYPOTHETICAL', shadow: { state: 'CLOSED', netPnL: -5 }, counterfactual: { state: 'NO_FILL', netPnL: null }, waitBaseline: { action: 'WAIT', netPnL: 0 },
      assumptions: { feeRate: 0.001, availableNotional: 100 }, limitations: ['Hypothetical fills are conditional estimates.']
    } }]
  } }));
  await page.route('**/api/ditas/events/event-fixture', route => route.fulfill({ json: {
    event: { id: 'event-fixture', payload: { reason: 'Rejected because the fixture spread was too wide.' } },
    snapshot: { id: 'snapshot-fixture', source: 'test-fixture' }, relatedEvents: []
  } }));
  await page.goto('/ditas');
  await expect(page.getByText('$12.00', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Decision ledger' }).click();
  await page.getByRole('button', { name: 'Inspect decision' }).click();
  await expect(page.getByRole('dialog')).toContainText('Rejected because the fixture spread was too wide.');
  await expect(page.getByRole('dialog')).toContainText('snapshot-fixture');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Decision Twin' }).click();
  await expect(page.getByText('HYPOTHETICAL', { exact: true })).toBeVisible();
  await expect(page.getByText('-$5.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect simulation' }).click();
  await expect(page.getByRole('dialog')).toContainText('availableNotional');
  await expect(page.getByRole('dialog')).toContainText('Hypothetical fills are conditional estimates.');
});

test('DITAS remains usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ditas');
  await expect(page.getByRole('heading', { name: 'DITAS · Decision intelligence' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Foundation coverage' }).click();
  await expect(page.getByText('Implementation coverage', { exact: true })).toBeVisible();
});

test('DITAS evaluates only the selected exact forecast cohort', async ({ page }) => {
  const cohort = '["crypto","strategy-v1","1h"]';
  await page.route(/\/api\/ditas(?:\?|$)/, route => {
    const selected = new URL(route.request().url()).searchParams.get('cohort');
    return route.fulfill({ json: {
      counts: { snapshots: 0, events: 0, twins: 0, forecasts: 100, outcomes: 100 },
      dataHealth: [], actual: { label: 'PAPER', orders: 0, fills: 0, closedPositions: 0, realizedPnl: 0, fees: 0 },
      controls: { mode: 'OBSERVE' }, events: [], fingerprints: [], twins: [], passports: [], coverage: [],
      calibration: { status: selected ? 'EVALUATED' : 'UNCALIBRATED', sample: selected ? 100 : 0, brierScore: selected ? 0.25 : null, logLoss: selected ? 0.6931 : null, ece: selected ? 0 : null, bins: [], cohorts: [{ cohort, n: 100 }], uncertainty: [], note: 'Select an exact cohort. Evaluation does not prove a calibrated production model.' }
    } });
  });
  await page.goto('/ditas');
  await page.getByRole('tab', { name: 'Calibration', exact: true }).click();
  await expect(page.getByText('UNCALIBRATED', { exact: true })).toBeVisible();
  const request = page.waitForRequest(r => r.url().includes('/api/ditas?cohort='));
  await page.getByLabel('Forecast cohort', { exact: true }).selectOption(cohort);
  expect(new URL((await request).url()).searchParams.get('cohort')).toBe(cohort);
  await expect(page.getByText('EVALUATED', { exact: true })).toBeVisible();
  await expect(page.getByText('0.2500', { exact: true })).toBeVisible();
});
