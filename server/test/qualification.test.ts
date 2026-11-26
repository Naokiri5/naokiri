import { describe, it, expect } from 'vitest';
import { qualifyEvidence, QUALIFICATION_RULES, type QualificationEvidence } from '../src/lab/qualification.js';
import { BACKTEST_MODEL_VERSION, type BtTrade } from '../src/lab/backtest.js';
import { freshDb, seedBacktestFixture } from './helpers.js';
import { listStrategies, oosCohort, setStrategyStatus, strategyQualification } from '../src/lab/lab.js';
import { get, run, J, P } from '../src/db/db.js';
import { STRATEGIES } from '../src/lab/strategies.js';

const trade = (r: number, i: number): BtTrade => ({ entryT: i, exitT: i + 1, entry: 100, exit: 100 + r, r, reason: 'TEST', regime: 'TREND_UP', segment: 'OOS', bars: 1, mfe: 0, mae: 0 });
/** Deterministic cohort: `wins` of every 5 trades win `win` R, the rest lose 1R. */
const cohort = (n: number, wins = 3, win = 1.5) => Array.from({ length: n }, (_, i) => trade(i % 5 < wins ? win : -1, i));
const evidence = (trades: BtTrade[], over: Partial<QualificationEvidence> = {}): QualificationEvidence =>
  ({ strategyVersion: '1.0.0', modelVersion: BACKTEST_MODEL_VERSION, instruments: 1, trades, runOosR: [trades.map((t) => t.r)], ...over });

describe('strategy qualification verdict', () => {
  it('qualifies a significant, post-cost positive OOS cohort from a single trial', () => {
    const q = qualifyEvidence(evidence(cohort(60)));
    expect(q).toMatchObject({ verdict: 'QUALIFIED', reasons: [], automaticPromotion: false, liveAuthority: false });
    expect(q.metrics).toMatchObject({ oosTrades: 60, trials: 1, sharpeVarianceSource: 'ESTIMATOR' });
    expect(q.metrics!.expectancyR).toBeCloseTo(0.5, 12);
    expect(q.metrics!.expectancyLowerR).toBeGreaterThan(0);
    expect(q.metrics!.deflatedSharpe).toBeGreaterThanOrEqual(QUALIFICATION_RULES.minDeflatedSharpe);
    expect(q.metrics!.breakevenExtraCostR).toBeCloseTo(0.5, 12);
  });

  it('refuses without a backtest', () => {
    expect(qualifyEvidence(null)).toMatchObject({ verdict: 'NOT_QUALIFIED', reasons: ['NO_BACKTEST'], metrics: null });
    expect(qualifyEvidence(evidence([]))).toMatchObject({ reasons: ['NO_BACKTEST'] });
  });

  it('refuses a cohort below the minimum sample even when it looks profitable', () => {
    expect(qualifyEvidence(evidence(cohort(29))).reasons).toContain('INSUFFICIENT_SAMPLE');
    expect(qualifyEvidence(evidence([trade(2, 0)])).reasons).toEqual(['INSUFFICIENT_SAMPLE']);
  });

  it('refuses evidence from the legacy fill model', () => {
    expect(qualifyEvidence(evidence(cohort(60), { modelVersion: 1 })).reasons).toContain('LEGACY_FILL_MODEL');
  });

  it('refuses non-positive and not-significant expectancy', () => {
    expect(qualifyEvidence(evidence(cohort(100, 2, 1.5))).reasons).toContain('NON_POSITIVE_EXPECTANCY'); // mean -0.0R
    const marginal = qualifyEvidence(evidence(cohort(40, 2, 1.6))); // mean +0.04R, wide interval
    expect(marginal.reasons).toContain('EXPECTANCY_NOT_SIGNIFICANT');
    expect(marginal.reasons).toContain('DEFLATED_SHARPE_TOO_LOW');
  });

  it('cannot be diluted by repeating a near-identical trial: the estimator variance is a floor', () => {
    const trades = cohort(60);
    const repeated = qualifyEvidence(evidence(trades, { runOosR: Array.from({ length: 50 }, () => trades.map((t) => t.r)) }));
    expect(repeated.metrics).toMatchObject({ trials: 50, sharpeVarianceSource: 'ESTIMATOR' });
    // Benchmark from the floor is strictly positive with 50 trials; a zero cross-trial variance would make it 0.
    expect(repeated.metrics!.deflatedSharpeBenchmark).toBeGreaterThan(0);
    expect(repeated.metrics!.deflatedSharpe).toBeLessThan(qualifyEvidence(evidence(trades)).metrics!.deflatedSharpe);
  });

  it('refuses a cohort with no dispersion, whose Sharpe is undefined', () => {
    const flat = qualifyEvidence(evidence(Array.from({ length: 40 }, (_, i) => trade(1, i))));
    expect(flat.reasons).toEqual(['DEFLATED_SHARPE_TOO_LOW']);
  });

  it('states the limits of what a verdict means', () => {
    expect(qualifyEvidence(evidence(cohort(60))).limitations.join(' ')).toMatch(/not measured executable depth.*not independent/s);
  });

  it('deflates the same cohort when it was selected from many dispersed trials', () => {
    const trades = cohort(60);
    // 200 runs whose OOS Sharpe ratios spread widely: the observed Sharpe is what the best no-skill trial would show.
    const runOosR = Array.from({ length: 200 }, (_, k) => cohort(30, k % 5, 1 + (k % 7) * 0.3).map((t) => t.r));
    const q = qualifyEvidence(evidence(trades, { runOosR }));
    expect(q.metrics).toMatchObject({ trials: 200, sharpeVarianceSource: 'CROSS_TRIAL' });
    expect(q.reasons).toEqual(['DEFLATED_SHARPE_TOO_LOW']);
    expect(q.metrics!.deflatedSharpeBenchmark).toBeGreaterThan(q.metrics!.sharpePerTrade);
  });
});

describe('Strategy Lab qualification and PAPER promotion', () => {
  const id = STRATEGIES[0].id;

  it('counts each distinct stored configuration of the current version as one trial', () => {
    freshDb(false);
    seedBacktestFixture(id, { qualifying: false });
    seedBacktestFixture(id);
    expect(oosCohort(id)).toMatchObject({ backtestRuns: 2, instruments: 2 });
    expect(strategyQualification(id).metrics?.trials).toBe(2);
    // An identical re-run is the same trial; a run of another strategy version is not evidence for this one.
    const stored = get<{ result: string; interval: string; instrument: string }>("SELECT result, interval, instrument FROM backtests WHERE id LIKE 'bt_fixture_%_60'")!;
    run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)', 'rerun', id, Date.now() - 1, stored.instrument, stored.interval, stored.result);
    run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)', 'old-version', id, Date.now() - 2, 'crypto:fixture:OLD', stored.interval, J({ ...P<Record<string, unknown>>(stored.result), strategyVersion: '0.0.1', instrument: 'crypto:fixture:OLD' }));
    expect(oosCohort(id)).toMatchObject({ backtestRuns: 2, instruments: 2 });
  });

  it('refuses owner promotion to PAPER until the evidence qualifies, and never promotes on its own', () => {
    freshDb(false);
    expect(() => setStrategyStatus('owner', id, 'PAPER')).toThrow(/at least one stored backtest/);
    seedBacktestFixture(id, { qualifying: false });
    expect(() => setStrategyStatus('owner', id, 'PAPER')).toThrow(/requires strategy qualification: .*INSUFFICIENT_SAMPLE/);
    seedBacktestFixture(id);
    expect(strategyQualification(id).verdict).toBe('QUALIFIED');
    // Qualified evidence never changes the lifecycle by itself.
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', id)!.status).not.toBe('PAPER');
    expect(() => setStrategyStatus('strategy-health-monitor', id, 'PAPER')).toThrow(/only the owner/);
    setStrategyStatus('owner', id, 'PAPER');
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', id)!.status).toBe('PAPER');
  });

  it('shows a strategy already in PAPER as NOT_QUALIFIED without demoting it', () => {
    freshDb(true); // every strategy promoted directly, as before this rule existed
    const listed = listStrategies().find((s: { id: string }) => s.id === id);
    expect(listed).toMatchObject({ status: 'PAPER', qualification: { verdict: 'NOT_QUALIFIED', reasons: ['NO_BACKTEST'] } });
  });
});
