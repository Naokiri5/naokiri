import { describe, expect, it } from 'vitest';
import { backtest } from '../src/lab/backtest.js';
import { listBacktests, strategyStats } from '../src/lab/lab.js';
import { newExitState, stepExit } from '../src/lab/exits.js';
import { closeDb, J, run } from '../src/db/db.js';
import { simulateTwin } from '../src/ditas/twin.js';
import { STRATEGIES, type StrategyDef } from '../src/lab/strategies.js';
import type { Candle } from '../src/market/types.js';
import { freshDb, seedBacktestFixture } from './helpers.js';

const HOUR = 3_600_000;
const candles = (n = 500): Candle[] => Array.from({ length: n }, (_, i) => ({
  t: i * HOUR, o: 100, h: 101, l: 99, c: 100, v: 1000, closeTime: (i + 1) * HOUR - 1,
}));
const fixtureStrategy: StrategyDef = {
  id: 'integrity-fixture', name: 'Synthetic integrity fixture', version: 'test-only', interval: '1h',
  suitableRegimes: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOLATILITY', 'COMPRESSION', 'UNKNOWN'],
  description: 'Deterministic correctness fixture, not a market strategy or performance claim.',
  generate: () => ({ direction: 'long', entryRef: 100, stop: 50, targets: [], maxHoldBars: 1,
    trailAfterR: null, trigger: 'synthetic fixture', invalidation: 'synthetic fixture', reasons: [] }),
};

describe('backtest evidence integrity', () => {
  it.each(['gap', 'duplicate', 'unordered', 'nan', 'invalid-range', 'negative-volume', 'early-close', 'late-close', 'forming'])('rejects %s history before evaluating a strategy', fault => {
    const history = candles(); let evaluated = false;
    if (fault === 'gap') history.splice(220, 1);
    if (fault === 'duplicate') history[220].t = history[219].t;
    if (fault === 'unordered') [history[220], history[221]] = [history[221], history[220]];
    if (fault === 'nan') history[220].c = NaN;
    if (fault === 'invalid-range') history[220].l = 102;
    if (fault === 'negative-volume') history[220].v = -1;
    if (fault === 'early-close') history[220].closeTime = history[220].t;
    if (fault === 'late-close') history[220].closeTime = history[221].t + 1;
    if (fault === 'forming') history[220].closeTime = history.at(-1)!.t + 2 * HOUR;
    expect(() => backtest({ ...fixtureStrategy, generate: f => { evaluated = true; return fixtureStrategy.generate(f); } }, 'fixture', history)).toThrow(/invalid backtest history/);
    expect(evaluated).toBe(false);
  });

  it('charges spread/slippage and both fees on a flat-price TIME exit', () => {
    const result = backtest(fixtureStrategy, 'fixture', candles(), { feeRate: 0.001, slippageBps: 3, spreadBps: 2 });
    const trade = result.trades[0];
    expect(trade).toBeDefined();
    expect(trade.reason).toBe('TIME');
    // 4 bps per side: buy 100.04, sell 99.96, fees 0.10004 + 0.09996 = 0.2.
    expect(trade.entry).toBeCloseTo(100.04, 10);
    expect(trade.exit).toBeCloseTo(99.96, 10);
    expect(trade.r).toBeCloseTo(-0.28 / 50.04, 10);
  });

  it('uses the observed gap open for a stop on the entry bar', () => {
    const strategy = {
      ...fixtureStrategy,
      generate: (features: Parameters<StrategyDef['generate']>[0]) => ({ ...fixtureStrategy.generate(features)!, stop: 100.02 }),
    };
    const trade = backtest(strategy, 'fixture', candles()).trades[0];
    expect(trade.exitT).toBe(trade.entryT);
    expect(trade.reason).toBe('STOP');
    expect(trade.entry).toBeCloseTo(100.04, 10);
    expect(trade.exit).toBeCloseTo(99.96, 10);
  });

  it('does not change completed-prefix outcomes when hidden future prices change', () => {
    const original = candles(); const changedFuture = structuredClone(original);
    for (const c of changedFuture.slice(300)) Object.assign(c, { o: 150, h: 151, l: 149, c: 150 });
    const first = backtest(fixtureStrategy, 'fixture', original);
    const altered = backtest(fixtureStrategy, 'fixture', changedFuture);
    const completedPrefix = first.trades.filter(t => t.exitT < 300 * HOUR);
    expect(completedPrefix.length).toBeGreaterThan(0);
    expect(altered.trades.filter(t => t.exitT < 300 * HOUR)).toEqual(completedPrefix);
  });

  it('allows full in-sample research and warns about excluded open-position PnL', () => {
    const neverClosed = { ...fixtureStrategy, generate: (f: Parameters<StrategyDef['generate']>[0]) => ({ ...fixtureStrategy.generate(f)!, maxHoldBars: 1000 }) };
    const result = backtest(neverClosed, 'fixture', candles(), undefined, 1);
    expect(result.trades).toEqual([]);
    expect(result.splitAt).toBe(Infinity);
    expect(result.warnings.join(' ')).toContain('open position');
    expect(result.warnings.join(' ')).toContain('exclude');
  });

  it('keeps legacy results readable and excludes them from current-model aggregates', () => {
    freshDb();
    try {
      const definition = STRATEGIES[0];
      seedBacktestFixture(definition.id);
      expect(strategyStats(definition.id)?.trades).toBe(1);
      expect(listBacktests()[0].warnings).toContain('This backtest used the earlier fill model. Rerun it to include the current cost and gap handling.');

      const current = backtest({ ...fixtureStrategy, id: definition.id, version: definition.version }, 'crypto:fixture:CURRENT', candles());
      run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)',
        'current-fixture', definition.id, Date.now(), current.instrument, current.interval, J(current));
      expect(current.outOfSample.trades).toBeGreaterThan(0);
      expect(strategyStats(definition.id)).toMatchObject({ trades: current.outOfSample.trades, instruments: 1 });
      expect(listBacktests()).toHaveLength(2);
    } finally {
      closeDb();
    }
  });
});

describe('TIME exit execution cost', () => {
  it('leaves TARGET and TIME prices raw for the caller execution-cost layer', () => {
    const state = newExitState(100, 50, 2, [{ r: 0.1, fraction: 0.5 }], null, 1);
    const fills = stepExit(state, { o: 100, h: 106, l: 99, c: 102 }, 0.01);
    expect(fills).toEqual([
      { reason: 'TARGET', price: 105, qty: 1 },
      { reason: 'TIME', price: 102, qty: 1 },
    ]);
    expect(state.qtyLeft).toBe(0);
  });

  it('retains the zero-slip contract used by the paper OMS', () => {
    const state = newExitState(100, 50, 1, [], null, 1);
    expect(stepExit(state, { o: 100, h: 101, l: 99, c: 100 }, 0)[0]).toEqual({ reason: 'TIME', price: 100, qty: 1 });
  });

  it('preserves exactly one TIME slippage charge in the existing Decision Twin caller', () => {
    const signal = { ...fixtureStrategy.generate({} as Parameters<StrategyDef['generate']>[0])!, targets: [{ r: 10, fraction: 1 }] };
    const result = simulateTwin({ instrumentId: 'fixture', decisionAt: 0, timeframe: '1h', signal }, candles(3), {
      feeRate: 0.001, slippageBps: 3, spreadBps: 2, notional: 1000, maxParticipationRate: 1,
      availableNotional: 1000, liquidityObservedAt: 0,
    }).shadow;
    expect(result.state).toBe('CLOSED');
    expect(result.fills[1].reason).toBe('TIME');
    expect(result.fills[1].price).toBeCloseTo(99.96, 10);
    expect(result.netPnL).toBeCloseTo((1000 / 100.04) * (99.96 - 100.04) - 1 - (1000 / 100.04) * 99.96 * 0.001, 10);
  });
});
