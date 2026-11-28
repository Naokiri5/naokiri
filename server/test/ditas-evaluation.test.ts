import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, executeExit } from '../src/exec/oms.js';
import { linkClosedTrades } from '../src/ditas/tradeOutcomes.js';
import { intelligenceEvaluation, wilsonInterval } from '../src/ditas/evaluation.js';
import { get, run, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

describe('Wilson interval', () => {
  it('matches reference values and stays inside [0, 1]', () => {
    const w = wilsonInterval(8, 10);
    expect(w.rate).toBe(0.8);
    expect(w.lower).toBeCloseTo(0.4902, 4);
    expect(w.upper).toBeCloseTo(0.9433, 4);
    expect(wilsonInterval(0, 5).lower).toBe(0);
    expect(wilsonInterval(5, 5).upper).toBe(1);
    expect(() => wilsonInterval(3, 2)).toThrow('WILSON_INPUT_INVALID');
    expect(() => wilsonInterval(0, 0)).toThrow('WILSON_INPUT_INVALID');
  });
});

describe('BrainOS intelligence evaluation', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  it('reports every area as NEEDS_EVIDENCE with no metrics when nothing is verified', () => {
    const e = intelligenceEvaluation();
    expect(e).toMatchObject({ label: 'PAPER', tradingAuthority: false, automaticPromotion: false });
    expect(e.areas.map((a) => a.area)).toEqual(['DIRECTIONAL', 'PROBABILITY', 'ENTRY', 'EXIT', 'REGIME', 'PERFORMANCE']);
    expect(e.areas.every((a) => a.status === 'NEEDS_EVIDENCE' && a.metrics === null)).toBe(true);
  });

  it('measures areas from ledger-verified paper trades once the minimum sample is reached, and only then', () => {
    const roundTrip = () => {
      // Winning round trips: price rises 1% before the exit, so the loss-streak breaker never trips.
      setBook(id, last);
      const decision = report(id, last);
      run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        decision.id, decision.candidateId, id, 'crypto', 'LONG', decision.strategy.id, decision.decision, 70, 'ALLOW', 'q', Date.now(), J(decision));
      const r = submitEntry(decision, 'bot');
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      const p = openPositions()[0];
      setBook(id, last * 1.01);
      executeExit(p.id, p.qty, 'TEST');
    };
    for (let i = 0; i < 29; i++) roundTrip();
    linkClosedTrades(Date.now() + 1);
    expect(intelligenceEvaluation().areas.find((a) => a.area === 'PERFORMANCE')).toMatchObject({ status: 'NEEDS_EVIDENCE', sample: 29, metrics: null });

    roundTrip();
    linkClosedTrades(Date.now() + 1);
    const e = intelligenceEvaluation();
    const performance = e.areas.find((a) => a.area === 'PERFORMANCE')!;
    expect(performance).toMatchObject({ status: 'MEASURED', sample: 30 });
    const net = get<{ n: number }>("SELECT SUM(net_pnl) n FROM ditas_trade_outcomes WHERE settlement='VERIFIED'")!.n;
    expect((performance.metrics as any).netPnl).toBeCloseTo(net, 9);
    expect((performance.metrics as any).maxDrawdownR).toBeGreaterThanOrEqual(0);
    expect(e.areas.find((a) => a.area === 'DIRECTIONAL')).toMatchObject({ status: 'MEASURED', sample: 30 });
    expect(e.areas.find((a) => a.area === 'ENTRY')).toMatchObject({ status: 'MEASURED', sample: 30 });
    expect((e.areas.find((a) => a.area === 'DIRECTIONAL')!.metrics as any).grossWinRate.rate).toBe(1);
    expect(e.areas.find((a) => a.area === 'REGIME')).toMatchObject({ status: 'MEASURED', metrics: { regimes: [{ regime: 'TREND_UP', sample: 30, status: 'MEASURED' }] } });
    // No forecasts were recorded, so probability accuracy has no evidence regardless of trades.
    expect(e.areas.find((a) => a.area === 'PROBABILITY')).toMatchObject({ status: 'NEEDS_EVIDENCE', metrics: null });
  });
});
