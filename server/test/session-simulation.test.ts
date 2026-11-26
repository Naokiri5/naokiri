import { afterEach, describe, expect, it } from 'vitest';
import { all, closeDb } from '../src/db/db.js';
import { simulateSession, simulatedEntrySizing, type SessionSimulationOptions } from '../src/lab/sessionSimulation.js';
import type { StrategyDef } from '../src/lab/strategies.js';
import type { HistoricalEvent } from '../src/lab/tape-reader.js';
import { market } from '../src/market/store.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { freshDb, seedInstrument, synthCandles } from './helpers.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);
const CANDLES = synthCandles(260, { step: HOUR, t0: T0, start: 100, drift: 0, vol: 0.004, seed: 7 });
const SIGNAL_INDEX = 214; // FeatureEngine snapshot n === 215
const P = CANDLES[SIGNAL_INDEX].c;
const C = CANDLES[SIGNAL_INDEX].t + HOUR; // close boundary of the signal candle
const ALL_REGIMES: StrategyDef['suitableRegimes'] = ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOLATILITY', 'COMPRESSION', 'UNKNOWN'];

/** Deterministic fixture capsule: signals on chosen snapshots, 5% stop, single 1R target. */
function fixtureStrategy(signalAt: number[] = [SIGNAL_INDEX + 1], stopPct = 5): StrategyDef {
  return {
    id: 'fixture_capsule', name: 'Fixture', version: '0.0.1', interval: '1h', suitableRegimes: ALL_REGIMES,
    description: 'Test-only capsule', generate: (f) => signalAt.includes(f.n) ? {
      direction: 'long', entryRef: f.close, stop: f.close * (1 - stopPct / 100), targets: [{ r: 1, fraction: 1 }], maxHoldBars: 5,
      trailAfterR: null, trigger: 'fixture', invalidation: 'fixture', reasons: ['fixture'],
    } : null,
  };
}
const fp = (x: number) => BigInt(Math.round(x * 1e9));
const book = (tsMs: number, mid: number, opts: { bidQty?: number; askQty?: number; spreadBps?: number; symbol?: string } = {}): HistoricalEvent => {
  const half = (opts.spreadBps ?? 2) / 20_000;
  return { type: 'BOOK_TICK', venue: 'BINANCE_SPOT', symbol: opts.symbol ?? 'ETHUSDT', tsMs,
    bidFp: fp(mid * (1 - half)), askFp: fp(mid * (1 + half)), bidQtyFp: fp(opts.bidQty ?? 1_000), askQtyFp: fp(opts.askQty ?? 1_000) };
};
const OPTIONS: SessionSimulationOptions = {
  venue: 'BINANCE_SPOT', symbol: 'ETHUSDT', startingCashUsd: 10_000,
  capitalCeilingUsd: 5_000, maxSessionLossUsd: 200, latencyMs: 1_000, maxWaitMs: 5_000, slippageBps: 5,
};
const run = (tape: HistoricalEvent[], options: Partial<SessionSimulationOptions> = {}, strategy = fixtureStrategy()) =>
  simulateSession(strategy, CANDLES, tape, { ...OPTIONS, ...options });
const bidOf = (mid: number) => Number(fp(mid * (1 - 1e-4))) / 1e9;
const askOf = (mid: number) => Number(fp(mid * (1 + 1e-4))) / 1e9;

afterEach(() => { closeDb(); market.reset(); });

describe('isolated historical session simulation', () => {
  it('trades a closed-candle signal causally at the later ask, exits at the bid and is reproducible', async () => {
    freshDb();
    const tape = [book(C - 1_000, P), book(C, P), book(C + 1_000, P), book(C + 2_000, P * 1.08)];
    const report = await run(tape);
    expect(await run(tape)).toEqual(report);

    const sizing = simulatedEntrySizing(DEFAULT_POLICY, 10_000, 10_000, askOf(P), P * 0.95);
    const entry = askOf(P) * 1.0005;
    const exit = bidOf(P * 1.08) * 0.9995;
    const fees = sizing.qty * entry * 0.001 + sizing.qty * exit * 0.001;
    const net = sizing.qty * (exit - entry) - fees;
    expect(report).toMatchObject({ tradingAuthority: false, evidence: 'RESEARCH_UNVERIFIED_TAPE', signals: 1, entries: 1,
      booksUsed: 4, candlesUsed: SIGNAL_INDEX + 1, openPosition: null, lossLimit: null });
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]).toMatchObject({ signalTs: C, entryTs: C + 1_000, exitTs: C + 2_000, reason: 'TARGET' });
    expect(report.trades[0].qty).toBeCloseTo(sizing.qty, 12);
    expect(report.trades[0].entryPrice).toBeCloseTo(entry, 9);
    expect(report.trades[0].netPnlUsd).toBeCloseTo(net, 6);
    expect(report.endingEquityUsd).toBeCloseTo(10_000 + net, 6);
    expect(report.records.map((r) => [r.ts, r.kind])).toEqual([[C, 'SIGNAL'], [C + 1_000, 'ENTRY'], [C + 2_000, 'EXIT']]);
    expect(report.determinismHash).toMatch(/^[a-f0-9]{64}$/);
    // Research only: nothing reaches the paper account.
    for (const table of ['orders', 'fills', 'positions', 'ledger_entries']) expect(all(`SELECT * FROM ${table}`)).toEqual([]);
  });

  it('never uses the signal observation, a future candle or an expired signal', async () => {
    // An unrelated symbol advances the clock but cannot execute the pending entry; it then expires.
    const expired = await run([book(C, P), book(C + 1_000, P, { symbol: 'BTCUSDT' }), book(C + 7_000, P)]);
    expect(expired).toMatchObject({ signals: 1, entries: 0, rejections: { EXPIRED: 1 } });
    // A tape that ends before the signal candle closes never sees that candle.
    const early = await run([book(C - 1_000, P), book(C - 1, P)]);
    expect(early).toMatchObject({ signals: 0, candlesUsed: SIGNAL_INDEX });
    // A signal still due at the end of the tape is not filled.
    expect(await run([book(C, P)])).toMatchObject({ entries: 0, rejections: { END_OF_TAPE: 1 } });
  });

  it('defers a stop the bid cannot absorb and then exits through the gap at the bid', async () => {
    const qty = simulatedEntrySizing(DEFAULT_POLICY, 10_000, 10_000, askOf(P), P * 0.95).qty;
    const report = await run([book(C, P), book(C + 1_000, P), book(C + 2_000, P * 0.9, { bidQty: qty / 2 }), book(C + 3_000, P * 0.89)]);
    expect(report).toMatchObject({ entries: 1, exitsDeferred: 1, openPosition: null });
    expect(report.records.map((r) => r.kind)).toEqual(['SIGNAL', 'ENTRY', 'EXIT_DEFERRED', 'EXIT']);
    expect(report.trades[0]).toMatchObject({ reason: 'STOP', exitTs: C + 3_000 });
    expect(report.trades[0].proceedsUsd / report.trades[0].qty).toBeCloseTo(bidOf(P * 0.89) * 0.9995, 9);
    expect(report.trades[0].r).toBeLessThan(-1);
  });

  it.each([
    ['INSUFFICIENT_DEPTH', { askQty: 0.001 }, {}],
    ['SPREAD', { spreadBps: 40 }, {}],
    ['PRICE_THROUGH_STOP', { mid: P * 0.94 }, {}],
    ['SLIPPAGE', {}, { slippageBps: 25 }],
    ['MANDATE_CAPITAL_CEILING', {}, { capitalCeilingUsd: 100 }],
    ['SESSION_LOSS_HEADROOM', {}, { maxSessionLossUsd: 10 }],
  ] as const)('rejects an entry with %s like the canonical rules or owner boundaries', async (reason, bookOptions, options) => {
    const { mid = P, ...entryBook } = bookOptions as { mid?: number; askQty?: number; spreadBps?: number };
    const report = await run([book(C, P), book(C + 1_000, mid, entryBook)], options as Partial<SessionSimulationOptions>);
    expect(report).toMatchObject({ signals: 1, entries: 0, trades: [], rejections: { [reason]: 1 } });
  });

  it('sizes a capped position at the worst permitted entry, so a fill within the slippage policy still fits the cap', async () => {
    // A 1% stop makes the risk budget ask for more than the 25% notional cap, so the cap sizes the position.
    const tightStop = fixtureStrategy([SIGNAL_INDEX + 1], 1);
    const sizing = simulatedEntrySizing(DEFAULT_POLICY, 10_000, 10_000, askOf(P), P * 0.99);
    expect(sizing.qty * askOf(P) * (1 + DEFAULT_POLICY.maxSlippageBps / 10_000)).toBeCloseTo(sizing.maxNotional, 6);
    // 5 bps of modeled slippage is within the 20 bps policy: the entry is no longer refused by the cap.
    const slipped = await run([book(C, P), book(C + 1_000, P)], {}, tightStop);
    expect(slipped).toMatchObject({ entries: 1, rejections: {} });
    expect(slipped.warnings.some((w) => w.includes('enforces the cap at the executed price'))).toBe(false);
    // Slippage beyond the policy is still refused, by the slippage rule.
    expect(await run([book(C, P), book(C + 1_000, P)], { slippageBps: 25 }, tightStop)).toMatchObject({ entries: 0, rejections: { SLIPPAGE: 1 } });
  });

  it('latches the loss limit, keeps managing the open position and refuses later signals', async () => {
    const qty = simulatedEntrySizing(DEFAULT_POLICY, 10_000, 10_000, askOf(P), P * 0.95).qty;
    const report = await run([
      book(C, P), book(C + 1_000, P),
      book(C + 2_000, P * 0.5, { bidQty: qty / 4 }), // gap: exit deferred, loss far beyond the $200 limit
      book(C + 3_000, P * 0.5), // the position still exits
      book(C + 3 * HOUR + 500, P), // a later signal is evaluated but never traded
    ], {}, fixtureStrategy([SIGNAL_INDEX + 1, SIGNAL_INDEX + 4]));
    expect(report.lossLimit).toMatchObject({ reachedAt: C + 2_000 });
    expect(report.lossLimit!.sessionPnlUsd).toBeLessThanOrEqual(-200);
    expect(report).toMatchObject({ signals: 2, entries: 1, rejections: { SESSION_LOSS_LIMIT_REACHED: 1 }, openPosition: null });
    expect(report.trades).toHaveLength(1);
    expect(report.records.map((r) => r.kind)).toEqual(['SIGNAL', 'ENTRY', 'EXIT_DEFERRED', 'LOSS_LIMIT_REACHED', 'EXIT', 'SIGNAL', 'ENTRY_REJECTED']);
    expect(report.maxDrawdownUsd).toBeGreaterThan(200);
  });

  it('models today\'s live mandate when no loss limit is given: realized losses count against the capital ceiling', async () => {
    const qty = simulatedEntrySizing(DEFAULT_POLICY, 10_000, 10_000, askOf(P), P * 0.95).qty;
    const tape = [book(C, P), book(C + 1_000, P), book(C + 2_000, P * 0.5, { bidQty: qty / 4 }), book(C + 3_000, P * 0.5),
      book(C + 3 * HOUR + 500, P), book(C + 3 * HOUR + 1_500, P)];
    const strategy = fixtureStrategy([SIGNAL_INDEX + 1, SIGNAL_INDEX + 4]);
    // No session loss limit: the second signal trades because realized loss + its cost still fits the ceiling.
    expect(await run(tape, { maxSessionLossUsd: undefined }, strategy)).toMatchObject({ lossLimit: null, entries: 2 });
    // A ceiling that the realized loss has used up refuses it.
    expect(await run(tape, { maxSessionLossUsd: undefined, capitalCeilingUsd: 1_000 }, strategy))
      .toMatchObject({ entries: 1, rejections: { MANDATE_CAPITAL_CEILING: 1 } });
  });

  it('reports an open position at the end of the tape without inventing an exit', async () => {
    const report = await run([book(C, P), book(C + 1_000, P), book(C + 2_000, P * 1.01)]);
    expect(report.trades).toEqual([]);
    expect(report.openPosition).toMatchObject({ entryTs: C + 1_000 });
    expect(report.openPosition!.markValueUsd).toBeCloseTo(report.openPosition!.qtyLeft * bidOf(P * 1.01) * 0.999, 9);
    expect(report.warnings.some((w) => w.includes('ends with an open position'))).toBe(true);
  });

  it('rejects invalid options, policies, histories and tapes', async () => {
    await expect(run([], { latencyMs: 0 })).rejects.toThrow('INVALID_SIMULATION_OPTIONS');
    await expect(run([], { capitalCeilingUsd: 20_000 })).rejects.toThrow('MANDATE_CAPITAL_EXCEEDS_FUNDS');
    await expect(run([], { capitalCeilingUsd: 0 })).rejects.toThrow();
    await expect(run([], { maxSessionLossUsd: Number.NaN })).rejects.toThrow();
    await expect(run([], { policy: { ...DEFAULT_POLICY, riskPerTradePct: 10 } })).rejects.toThrow();
    await expect(run([book(C, P), book(C - 1, P)])).rejects.toThrow('SIM_NON_MONOTONIC');
    await expect(simulateSession(fixtureStrategy(), [...CANDLES].reverse(), [], OPTIONS)).rejects.toThrow('invalid backtest history');
  });
});

describe('sizing parity with the canonical risk gate', () => {
  it('matches evaluateRisk sizing for the default policy on a funded, flat paper account', () => {
    freshDb();
    market.reset();
    const { inst, last } = seedInstrument('ETHUSDT');
    acceptPolicy('owner', DEFAULT_POLICY);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const stop = last * 0.95;
    const gate = evaluateRisk({ instrumentId: inst.id, strategyId: 'trend_pullback', side: 'buy', entryPrice: last, stopPrice: stop,
      idempotencyKey: 'parity', traceId: 'parity' }).sizing!;
    const sim = simulatedEntrySizing(DEFAULT_POLICY, 10_000, 10_000, market.price(inst.id)!.ask, stop, inst.stepSize);
    for (const key of ['qty', 'riskBudget', 'maxNotional', 'perUnitLoss', 'conservativeStopFill'] as const)
      expect(sim[key], key).toBeCloseTo(gate[key], 9);
  });
});
