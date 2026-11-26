import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedBacktestFixture, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { submitEntry, monitorPositions } from '../src/exec/oms.js';
import { strategyQualification } from '../src/lab/evidence.js';
import { BACKTEST_MODEL_VERSION, stats, type BtTrade } from '../src/lab/backtest.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { run, get, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

const strategy = STRATEGIES.find((s) => s.id === 'trend_pullback')!;
const risk = (id: string, last: number) => evaluateRisk({ instrumentId: id, strategyId: strategy.id, side: 'buy', entryPrice: last, stopPrice: last * 0.97, idempotencyKey: `k${Math.random()}`, traceId: 't' });
const reasons = (id: string, last: number) => risk(id, last).reasonCodes.filter((r) => r.startsWith('STRATEGY_NOT_QUALIFIED'));

/** A current-model backtest whose OOS trades all lose: pooled with the baseline it removes the qualified edge. */
function losingBacktest(n = 120) {
  const trades: BtTrade[] = Array.from({ length: n }, (_, i) => ({ entryT: i, exitT: i + 1, entry: 100, exit: 99, r: -1, reason: 'SYNTHETIC TEST FIXTURE', regime: 'TREND_UP', segment: 'OOS', bars: 1, mfe: 0, mae: -1 }));
  run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)', 'bt_losing', strategy.id, Date.now(), 'crypto:fixture:LOSING', strategy.interval,
    J({ strategyId: strategy.id, strategyVersion: strategy.version, modelVersion: BACKTEST_MODEL_VERSION, instrument: 'crypto:fixture:LOSING', interval: strategy.interval, bars: 500, from: 0, to: n, splitAt: 0,
      costs: { feeRate: 0.001, slippageBps: 3, spreadBps: 2 }, inSample: stats([]), outOfSample: stats(trades), all: stats(trades), trades, equityR: trades.map((t) => t.r), warnings: ['Synthetic test fixture'] }));
}

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: strategy.id, version: strategy.version }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

describe('risk gate: PAPER strategies trade only while qualified', () => {
  let id = ''; let last = 0;
  const setup = (promote: boolean) => {
    freshDb(promote); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    if (!promote) run("UPDATE strategies SET status='PAPER'");
  };
  beforeEach(() => setup(true));

  it('allows a qualified PAPER strategy', () => {
    expect(strategyQualification(strategy.id).verdict).toBe('QUALIFIED');
    expect(reasons(id, last)).toEqual([]);
  });

  it.each([
    ['no backtest', () => {}, /NO_BACKTEST/],
    ['too few out-of-sample trades', () => seedBacktestFixture(strategy.id, { qualifying: false }), /INSUFFICIENT_SAMPLE/],
    ['only legacy fill-model evidence', () => seedBacktestFixture(strategy.id, { legacy: true }), /LEGACY_FILL_MODEL/],
  ])('refuses new entries with %s', (_label, seed, reason) => {
    setup(false); seed();
    const r = risk(id, last);
    expect(r.decision).toBe('DENY');
    expect(r.reasonCodes.join(' ')).toMatch(new RegExp(`STRATEGY_NOT_QUALIFIED: .*${reason.source}`));
  });

  it('re-evaluates as soon as a new backtest is stored (the cached verdict is keyed on the stored runs)', () => {
    expect(reasons(id, last)).toEqual([]);
    losingBacktest();
    expect(reasons(id, last)).toHaveLength(1);
    expect(strategyQualification(strategy.id).verdict).toBe('NOT_QUALIFIED');
  });

  it('does not add the reason for unregistered strategies or non-PAPER statuses', () => {
    run("UPDATE strategies SET status='RESEARCH' WHERE id=?", strategy.id);
    expect(risk(id, last).reasonCodes.join(' ')).toMatch(/STRATEGY_NOT_PROMOTED/);
    expect(reasons(id, last)).toEqual([]);
  });

  it('keeps protecting an open position after its strategy stops qualifying', () => {
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: true });
    losingBacktest();
    expect(reasons(id, last)).toHaveLength(1); // no new exposure
    const p = openPositions()[0];
    setBook(id, p.stop_price * 0.995); // price through the stop
    monitorPositions();
    expect(get<{ status: string }>('SELECT status FROM positions WHERE id=?', p.id)!.status).toBe('CLOSED');
  });
});
