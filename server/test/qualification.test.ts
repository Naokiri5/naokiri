import { describe, it, expect } from 'vitest';
import { qualifyEvidence, QUALIFICATION_RULES, type QualificationEvidence } from '../src/lab/qualification.js';
import { BACKTEST_MODEL_VERSION, type BtTrade } from '../src/lab/backtest.js';
import { freshDb, seedBacktestFixture } from './helpers.js';
import { listStrategies, oosCohort, setStrategyStatus, strategyQualification } from '../src/lab/lab.js';
import { get, run, J, P } from '../src/db/db.js';
import { STRATEGIES } from '../src/lab/strategies.js';

const trade = (r: number, i: number, costR: number | undefined = 0.05): BtTrade => ({ entryT: i, exitT: i + 1, entry: 100, exit: 100 + r, r, reason: 'TEST', regime: 'TREND_UP', segment: 'OOS', bars: 1, mfe: 0, mae: 0, ...(costR === undefined ? {} : { costR }) });
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

  it('reports a needed re-run, not a missing backtest, when only other-model runs exist', () => {
    const q = qualifyEvidence(evidence([], { otherModelRuns: 1 }));
    expect(q).toMatchObject({ verdict: 'NOT_QUALIFIED', reasons: ['LEGACY_FILL_MODEL'] });
    expect(qualifyEvidence(evidence([], { otherModelRuns: 0 })).reasons).toEqual(['NO_BACKTEST']);
  });

  it('judges n not divisible by 3 (31 trades) with uneven periods by the other rules', () => {
    const q = qualifyEvidence(evidence(cohort(31)));
    expect(q.metrics!.periodExpectancyR).toHaveLength(3);
    expect(q.reasons).not.toContain('INSUFFICIENT_SAMPLE');
    expect(q.reasons).not.toContain('PERIOD_INCONSISTENT');
    // 31 trades split 10/11/10; a losing final period of 10 is still refused.
    const bad = [...cohort(21), ...Array.from({ length: 10 }, (_, i) => trade(-1, 21 + i))];
    expect(qualifyEvidence(evidence(bad)).reasons).toContain('PERIOD_INCONSISTENT');
  });

  it('with no losing trades (profit factor Infinity) is still judged by the other rules', () => {
    const wins = qualifyEvidence(evidence(Array.from({ length: 40 }, (_, i) => trade(1 + (i % 2) * 0.5, i))));
    expect(wins.metrics!.profitFactor).toBe(Infinity);
    expect(wins.reasons).not.toContain('PROFIT_FACTOR_TOO_LOW');
    expect(wins.verdict).toBe('QUALIFIED');
    const few = qualifyEvidence(evidence(Array.from({ length: 10 }, (_, i) => trade(1 + (i % 2) * 0.5, i))));
    expect(few.reasons).toEqual(['INSUFFICIENT_SAMPLE']);
    const stressed = qualifyEvidence(evidence(Array.from({ length: 40 }, (_, i) => trade(1 + (i % 2) * 0.5, i, 2))));
    expect(stressed.reasons).toContain('COST_STRESS_FAILED');
  });

  it('orders tied exits losing-first, so drawdown is conservative and independent of input order', () => {
    // 20 identical-time (entryT, exitT) trades: ten +1R and ten -1R. Losses first gives a 10R drawdown, wins first 0R.
    const tied = (r: number, k: number): BtTrade => ({ ...trade(r, 100), entryT: 100, exitT: 101, reason: `t${k}` });
    const wins = Array.from({ length: 10 }, (_, k) => tied(1, k)); const losses = Array.from({ length: 10 }, (_, k) => tied(-1, k));
    const pad = Array.from({ length: 30 }, (_, i) => trade(i % 2 ? 2 : 1, 200 + i));
    const a = qualifyEvidence(evidence([...wins, ...losses, ...pad])); const b = qualifyEvidence(evidence([...losses, ...wins, ...pad]));
    expect(a.metrics!.maxDrawdownR).toBeCloseTo(10, 9);
    expect(b.metrics!.maxDrawdownR).toBeCloseTo(10, 9);
    expect(a.metrics!.periodExpectancyR).toEqual(b.metrics!.periodExpectancyR);
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

/** `n` trades around mean `m` (alternating m+0.3 / m-0.3), placed from index `from` so exit order is chronological. */
const block = (n: number, m: number, from: number, costR = 0.01) => Array.from({ length: n }, (_, i) => trade(i % 2 ? m - 0.3 : m + 0.3, from + i, costR));
const periods = (...means: number[]) => means.flatMap((m, j) => block(20, m, j * 20));

describe('qualification rulebook gates (Q6-Q10)', () => {
  it('profit factor must be at least 1.2', () => {
    const pf = (w: number) => Array.from({ length: 60 }, (_, i) => trade(i % 2 ? -1 : w, i));
    expect(qualifyEvidence(evidence(pf(1.19))).reasons).toContain('PROFIT_FACTOR_TOO_LOW');
    expect(qualifyEvidence(evidence(pf(1.21))).reasons).not.toContain('PROFIT_FACTOR_TOO_LOW');
    expect(qualifyEvidence(evidence(pf(1.21))).metrics!.profitFactor).toBeCloseTo(1.21, 9);
  });

  it('max drawdown must not exceed 10R', () => {
    expect(QUALIFICATION_RULES.maxDrawdownR).toBe(10);
    const streak = (losses: number) => Array.from({ length: 60 }, (_, i) => trade(i >= 25 && i < 25 + losses ? -1 : 2, i));
    const ok = qualifyEvidence(evidence(streak(10)));
    expect(ok.metrics!.maxDrawdownR).toBeCloseTo(10, 9);
    expect(ok.reasons).not.toContain('DRAWDOWN_TOO_LARGE');
    const bad = qualifyEvidence(evidence(streak(11)));
    expect(bad.metrics!.maxDrawdownR).toBeCloseTo(11, 9);
    expect(bad.reasons).toContain('DRAWDOWN_TOO_LARGE');
  });

  it('rejects the owner example: strong first period, negative later periods, positive pooled edge', () => {
    const q = qualifyEvidence(evidence(periods(1.1, -0.1, -0.1)));
    expect(q.metrics!.expectancyR).toBeGreaterThan(0);
    expect(q.metrics!.expectancyLowerR).toBeGreaterThan(0);
    expect(q.metrics!.periodExpectancyR.map((v) => Math.round(v * 10) / 10)).toEqual([1.1, -0.1, -0.1]);
    expect(q.reasons).toContain('PERIOD_INCONSISTENT');
    expect(q.verdict).toBe('NOT_QUALIFIED');
  });

  it('rejects a negative most recent period even when earlier periods are strong', () => {
    const q = qualifyEvidence(evidence(periods(1, 1, -0.2)));
    expect(q.metrics!.expectancyLowerR).toBeGreaterThan(0);
    expect(q.reasons).toContain('PERIOD_INCONSISTENT');
  });

  it('allows one weak early period when the recent period is positive', () => {
    const q = qualifyEvidence(evidence(periods(-0.2, 0.9, 0.9)));
    expect(q.reasons).not.toContain('PERIOD_INCONSISTENT');
    expect(q.verdict).toBe('QUALIFIED');
  });

  it('orders periods by exit time, not input order', () => {
    const shuffled = [...periods(1.1, -0.1, -0.1)].reverse();
    expect(qualifyEvidence(evidence(shuffled)).reasons).toContain('PERIOD_INCONSISTENT');
  });

  it('fails the 2x cost stress when extra cost removes the edge, passes when it is small', () => {
    const withCost = (c: number) => cohort(60).map((t) => ({ ...t, costR: c }));
    const bad = qualifyEvidence(evidence(withCost(0.6)));
    expect(bad.reasons).toContain('COST_STRESS_FAILED');
    expect(bad.metrics!.stressedExpectancyR).toBeCloseTo(-0.1, 9);
    const ok = qualifyEvidence(evidence(withCost(0.05)));
    expect(ok.reasons).not.toContain('COST_STRESS_FAILED');
    expect(ok.metrics!.stressedExpectancyR).toBeCloseTo(0.45, 9);
  });

  it('fails closed when any trade lacks a finite non-negative costR', () => {
    const base = cohort(60);
    const missing = base.map((t, i) => (i === 7 ? (({ costR: _omit, ...rest }) => rest)(t) : t));
    const q = qualifyEvidence(evidence(missing));
    expect(q.reasons).toContain('COST_STRESS_FAILED');
    expect(q.metrics!.stressedExpectancyR).toBeNull();
    for (const bad of [NaN, Infinity, -0.1]) {
      expect(qualifyEvidence(evidence(base.map((t, i) => (i === 3 ? { ...t, costR: bad } : t)))).reasons).toContain('COST_STRESS_FAILED');
    }
  });

  it('qualifies the default seeded 60-trade fixture under every rule', () => {
    freshDb(false);
    seedBacktestFixture(STRATEGIES[0].id);
    const q = strategyQualification(STRATEGIES[0].id);
    expect(q.reasons).toEqual([]);
    expect(q.verdict).toBe('QUALIFIED');
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

  it('treats a model-version-2 backtest as re-run needed, not qualifying evidence, yet still a deflation trial', () => {
    freshDb(false);
    seedBacktestFixture(id, { modelVersion: 2 });
    expect(strategyQualification(id)).toMatchObject({ verdict: 'NOT_QUALIFIED', reasons: ['LEGACY_FILL_MODEL'] });
    expect(() => setStrategyStatus('owner', id, 'PAPER')).toThrow(/re-run under the current fill model/);
    expect(oosCohort(id)).toMatchObject({ trades: [], otherModelRuns: 1, backtestRuns: 1 });
    // Add a qualifying current-model run on another instrument: v3 is the evidence, the v2 run still counts as a trial.
    seedBacktestFixture(id, { id: 'bt_v3', instrument: 'crypto:fixture:V3' });
    expect(strategyQualification(id).verdict).toBe('QUALIFIED');
    expect(oosCohort(id)).toMatchObject({ backtestRuns: 2, instruments: 1, modelVersion: BACKTEST_MODEL_VERSION });
    expect(strategyQualification(id).metrics?.trials).toBe(2);
  });

  it('every registered strategy runs on 1h', () => {
    // The live scanner checks regime stability on the 1h engine for every strategy, while the backtest checks it on the
    // strategy's own interval. If this fails, the scanner's stability check must be made per-interval first.
    for (const s of STRATEGIES) expect(s.interval).toBe('1h');
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
    freshDb(false);
    run("UPDATE strategies SET status='PAPER'"); // promoted directly with no evidence, as before this rule existed
    const listed = listStrategies().find((s: { id: string }) => s.id === id);
    expect(listed).toMatchObject({ status: 'PAPER', qualification: { verdict: 'NOT_QUALIFIED', reasons: ['NO_BACKTEST'] } });
  });
});
