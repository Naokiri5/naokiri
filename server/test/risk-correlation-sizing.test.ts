import { describe, it, expect, beforeEach } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { correlation } from '../src/portfolio/correlation.js';
import { run } from '../src/db/db.js';

/**
 * THINK slice 3 (MIA-THINK-053, 052, 047): the independent risk gate's correlation limit and sizing invariants,
 * tested on the real gate. Tests only: no risk logic is changed.
 *  - Correlated exposure: positions whose 1h returns correlate >= threshold with the candidate count toward
 *    maxCorrelatedPositions; UNKNOWN correlation counts as correlated (fail closed).
 *  - Sizing: volatility reaches the gate through the stop distance. A wider stop never increases quantity,
 *    planned loss never exceeds the risk budget, and notional never exceeds its cap.
 */
const prop = (id: string, entry: number, stopPct = 3) => ({ instrumentId: id, strategyId: 'trend_pullback', side: 'buy' as const, entryPrice: entry, stopPrice: entry * (1 - stopPct / 100), idempotencyKey: `k${Math.random()}`, traceId: 't-think3' });
let n = 0;
function openPosition(instrumentId: string, price: number) {
  run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,planned_risk)
    VALUES (?,?,?,'crypto','long','trend_pullback',0.01,?,?,?,'[]','OPEN',?,0,0,5)`, `pos_t3_${n++}`, PAPER_ACCOUNT, instrumentId, price, price * 0.97, price * 0.97, Date.now());
}
function setup() {
  acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
}
const reasons = (r: ReturnType<typeof evaluateRisk>) => r.reasonCodes.join(' | ');

describe('Risk gate: correlated exposure (MIA-THINK-053)', () => {
  beforeEach(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('fixtures behave as intended: same seed = perfectly correlated, different seed = not', () => {
    const a = seedInstrument('AAAUSDT', { seed: 21 }), b = seedInstrument('BBBUSDT', { seed: 21 }), c = seedInstrument('CCCUSDT', { seed: 77 });
    expect(correlation(a.inst.id, b.inst.id)!).toBeGreaterThan(0.99);
    expect(Math.abs(correlation(a.inst.id, c.inst.id)!)).toBeLessThan(DEFAULT_POLICY.correlationThreshold);
  });

  it(`denies at ${DEFAULT_POLICY.maxCorrelatedPositions} correlated open positions`, () => {
    const a = seedInstrument('AAAUSDT', { seed: 21 }), b = seedInstrument('BBBUSDT', { seed: 21 }), cand = seedInstrument('CCCUSDT', { seed: 21 });
    setup(); openPosition(a.inst.id, a.last); openPosition(b.inst.id, b.last);
    const r = evaluateRisk(prop(cand.inst.id, cand.last));
    expect(r.decision).toBe('DENY');
    expect(r.evaluated.correlatedOpenPositions).toBe(2);
    expect(reasons(r)).toMatch(/CORRELATION_LIMIT 2 correlated open positions/);
  });

  it('one correlated position is below the limit (no correlation denial)', () => {
    const a = seedInstrument('AAAUSDT', { seed: 21 }), cand = seedInstrument('CCCUSDT', { seed: 21 });
    setup(); openPosition(a.inst.id, a.last);
    const r = evaluateRisk(prop(cand.inst.id, cand.last));
    expect(r.evaluated.correlatedOpenPositions).toBe(1);
    expect(reasons(r)).not.toMatch(/CORRELATION_LIMIT/);
  });

  it('uncorrelated open positions do not count', () => {
    const a = seedInstrument('AAAUSDT', { seed: 31 }), b = seedInstrument('BBBUSDT', { seed: 47 }), cand = seedInstrument('CCCUSDT', { seed: 77 });
    for (const x of [a, b]) expect(Math.abs(correlation(x.inst.id, cand.inst.id)!)).toBeLessThan(DEFAULT_POLICY.correlationThreshold);
    setup(); openPosition(a.inst.id, a.last); openPosition(b.inst.id, b.last);
    const r = evaluateRisk(prop(cand.inst.id, cand.last));
    expect(r.evaluated.correlatedOpenPositions).toBe(0);
    expect(reasons(r)).not.toMatch(/CORRELATION_LIMIT/);
  });

  it('UNKNOWN correlation counts as correlated: missing history fails closed', () => {
    const a = seedInstrument('AAAUSDT', { seed: 31 }), b = seedInstrument('BBBUSDT', { seed: 47 }), cand = seedInstrument('CCCUSDT', { seed: 77 });
    setup(); openPosition(a.inst.id, a.last); openPosition(b.inst.id, b.last);
    market.deep.get(cand.inst.id)!.engines['1h'].candles.splice(0); // no overlapping return history (the array itself is readonly)
    expect(correlation(a.inst.id, cand.inst.id)).toBeNull();
    const r = evaluateRisk(prop(cand.inst.id, cand.last));
    expect(r.evaluated.correlatedOpenPositions).toBe(2);
    expect(reasons(r)).toMatch(/CORRELATION_LIMIT/);
  });
});

describe('Risk gate: sizing invariants (MIA-THINK-052, 047)', () => {
  beforeEach(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('a wider (more volatile) stop never increases quantity; loss never exceeds the budget; notional never exceeds the cap', () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 }); setup();
    const cap = 10_000 * DEFAULT_POLICY.maxPositionNotionalPct / 100;
    let prevQty = Infinity;
    for (const stopPct of [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 20]) {
      const s = evaluateRisk(prop(inst.id, last, stopPct)).sizing!;
      expect(s, `sizing at ${stopPct}%`).not.toBeNull();
      expect(s.qty, `qty at ${stopPct}% stop`).toBeLessThanOrEqual(prevQty);
      expect(s.plannedMaxLoss).toBeLessThanOrEqual(s.riskBudget + 1e-6);
      expect(s.notional).toBeLessThanOrEqual(cap + 0.01);
      expect(s.conservativeStopFill).toBeLessThan(last * (1 - stopPct / 100)); // stop assumed to fill worse than trigger
      prevQty = s.qty;
    }
  });

  it('the risk budget is a fixed share of equity: tighter stops do not raise the money at risk', () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 }); setup();
    const budgets = [0.5, 2, 8].map((p) => evaluateRisk(prop(inst.id, last, p)).sizing!.riskBudget);
    expect(new Set(budgets).size).toBe(1);
    expect(budgets[0]).toBeCloseTo(10_000 * DEFAULT_POLICY.riskPerTradePct / 100, 6);
  });

  it('step-size rounding only ever rounds quantity down (never adds risk)', () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 }); setup();
    const step = market.instruments.get(inst.id)!.stepSize;
    for (const stopPct of [0.7, 1.3, 2.9, 5.1]) {
      const s = evaluateRisk(prop(inst.id, last, stopPct)).sizing!;
      const unrounded = Math.min(s.riskBudget / s.perUnitLoss, (10_000 * DEFAULT_POLICY.maxPositionNotionalPct / 100) / s.estEntry);
      expect(s.qty).toBeLessThanOrEqual(unrounded + 1e-12);
      expect(unrounded - s.qty).toBeLessThan(step + 1e-12);
    }
  });
});
