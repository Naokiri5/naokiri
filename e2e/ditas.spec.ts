import { test, expect } from '@playwright/test';

const PW = 'e2e owner passphrase';
test.beforeEach(async ({ page }) => {
  await page.context().route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const auth = await page.request.get('/api/auth/state');
  const state = await auth.json();
  const response = await page.request.post(state.setup ? '/api/auth/login' : '/api/auth/setup', { data: { password: PW } });
  expect(response.status()).toBe(200);
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
  let behaviorUnavailable = false;
  await page.route('**/api/ditas/events/event-fixture/behavior-evidence', route => behaviorUnavailable
    ? route.fulfill({ status: 409, json: { error: 'frozen evidence integrity check failed' } })
    : route.fulfill({ json: {
      schemaVersion: 'bmind.evidence.v1', use: 'RESEARCH_ONLY', asOf: stamp, status: 'AVAILABLE', dataQuality: 'WARN',
      evidence: [
        { kind: 'TICKER', status: 'AVAILABLE', originId: 'a'.repeat(64), dependencyGroup: 'binance',
          eventTimeMs: stamp - 1000, receivedTimeMs: stamp, requestStartedAtMs: null },
        { kind: 'BOOK', status: 'STALE', reason: 'BOOK_EXPIRED_AT_CAPTURE' },
      ],
    } }));
  await page.goto('/ditas');
  await expect(page.getByText('$12.00', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Decision ledger' }).click();
  await page.getByRole('button', { name: 'Inspect decision' }).click();
  const behavior = page.getByRole('region', { name: 'B-MIND evidence' });
  await expect(behavior).toContainText('Research only');
  await expect(behavior).toContainText('binance');
  await expect(behavior).toContainText('The order book was stale at capture.');
  await expect(page.getByRole('dialog')).toContainText('Rejected because the fixture spread was too wide.');
  await expect(page.getByRole('dialog')).toContainText('snapshot-fixture');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  behaviorUnavailable = true;
  await page.getByRole('button', { name: 'Inspect decision' }).click();
  await expect(behavior.getByRole('alert')).toContainText('frozen evidence integrity check failed');
  await expect(page.getByRole('dialog')).toContainText('Rejected because the fixture spread was too wide.');
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
  const cohortKey = (strategy: string) => JSON.stringify(['crypto', strategy, '1.0.0', '1h', 'model-v1', 'prompt-v1', 'CLOSE_ABOVE_REFERENCE', 3, 12, 0]);
  const cohort = cohortKey('fixture-strategy');
  const otherCohort = cohortKey('other-strategy');
  let releaseOther!: () => void;
  const otherResponse = new Promise<void>(resolve => { releaseOther = resolve; });
  await page.route(/\/api\/ditas(?:\?|$)/, async route => {
    const selected = new URL(route.request().url()).searchParams.get('cohort');
    if (selected === otherCohort) await otherResponse;
    return route.fulfill({ json: {
      counts: { snapshots: 0, events: 0, twins: 0, forecasts: 100, outcomes: 100 },
      dataHealth: [], actual: { label: 'PAPER', orders: 0, fills: 0, closedPositions: 0, realizedPnl: 0, fees: 0 },
      controls: { mode: 'OBSERVE' }, events: [], fingerprints: [], twins: [], passports: [], coverage: [],
      calibration: { cohort: selected, status: selected ? 'EVALUATED' : 'UNCALIBRATED', sample: selected ? 100 : 0, brierScore: selected === otherCohort ? 0.5 : selected ? 0.25 : null, logLoss: selected ? 0.6931 : null, ece: selected ? 0 : null, bins: [], cohorts: [{ cohort, n: 100 }, { cohort: otherCohort, n: 100 }], uncertainty: [], note: 'Select an exact cohort. Evaluation does not prove a calibrated production model.' }
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
  await page.getByLabel('Forecast cohort', { exact: true }).selectOption(otherCohort);
  try {
    await expect(page.getByText('0.2500', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Inspect calibration evidence' })).toBeDisabled();
  } finally {
    releaseOther();
  }
  await expect(page.getByText('0.5000', { exact: true })).toBeVisible();
});
