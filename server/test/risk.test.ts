import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, accountState } from '../src/portfolio/ledger.js';
import { setSetting } from '../src/core/settings.js';

const prop = (id: string, last: number, extra: any = {}) => ({ instrumentId: id, strategyId: 'trend_pullback', side: 'buy' as const, entryPrice: last, stopPrice: last * 0.97, idempotencyKey: `k${Math.random()}`, traceId: 't', ...extra });
describe('Risk gate (Part 17)', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
  });
  it('denies when no policy is accepted', () => { expect(evaluateRisk(prop(id, last)).reasonCodes[0]).toMatch(/POLICY_NOT_ACCEPTED/); });
  it('denies in read-only mode and when unfunded', () => {
    acceptPolicy('owner', DEFAULT_POLICY);
    const r = evaluateRisk(prop(id, last)); expect(r.decision).toBe('DENY'); expect(r.reasonCodes).toContain('MODE_READ_ONLY');
    expect(r.reasonCodes.join()).toMatch(/NO_EQUITY/);
  });
  it('allows a valid paper trade and sizes conservatively', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const r = evaluateRisk(prop(id, last));
    expect(r.decision).toBe('ALLOW');
    const s = r.sizing!;
    expect(s.riskBudget).toBeCloseTo(50, 5);              // 0.5% of 10k
    expect(s.plannedMaxLoss).toBeLessThanOrEqual(50.0001); // never exceeds budget
    expect(s.conservativeStopFill).toBeLessThan(last * 0.97); // stop assumed to fill worse than trigger
    expect(s.notional).toBeLessThanOrEqual(2500.01);        // 25% max notional
    expect(r.policyVersion).toBe(1); expect(r.traceId).toBe('t');
  });
  it('enforces daily loss breaker, stop direction, duplicates, pause and emergency', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    evaluateRisk(prop(id, last)); // establishes start-of-day mark
    const day = new Date().toISOString().slice(0, 10);
    const week = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    setSetting(`marks2:${PAPER_ACCOUNT}`, { day, sodPerf: 500, week, sowPerf: 0, hwmPerf: 500 }); // was +$500 at day start → now −4.8%
    expect(evaluateRisk(prop(id, last)).reasonCodes.join()).toMatch(/DAILY_LOSS_BREAKER/);
    setSetting(`marks2:${PAPER_ACCOUNT}`, { day, sodPerf: 0, week, sowPerf: 0, hwmPerf: 0 });
    expect(evaluateRisk(prop(id, last, { stopPrice: last * 1.01 })).reasonCodes.join()).toMatch(/STOP_DIRECTION_INVALID/);
    expect(evaluateRisk(prop(id, last, { entryPrice: last * 1.05 })).reasonCodes.join()).toMatch(/PRICE_DEVIATION/);
    updateControl('owner', { pausedNewOrders: true }); expect(evaluateRisk(prop(id, last)).reasonCodes).toContain('NEW_ORDERS_PAUSED');
    updateControl('owner', { pausedNewOrders: false, emergency: true }); expect(evaluateRisk(prop(id, last)).reasonCodes).toContain('EMERGENCY_STOP_ACTIVE');
  });
  it('deposits never register as PnL and never disarm breakers', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' });
    accountState(); // day mark taken while unfunded
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const a = accountState(); expect(a.startOfDayEquity).toBe(10_000); expect(a.dailyPnlPct).toBe(0); expect(a.drawdownPct).toBe(0);
    ledger(PAPER_ACCOUNT, 'FEE', -300); // simulate a $300 loss
    expect(accountState().dailyPnlPct).toBeCloseTo(-3, 6);
    expect(evaluateRisk(prop(id, last)).reasonCodes.join()).toMatch(/DAILY_LOSS_BREAKER/);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 5_000); // topping up does not reset the breaker
    expect(evaluateRisk(prop(id, last)).reasonCodes.join()).toMatch(/DAILY_LOSS_BREAKER/);
  });
  it('denies strategies not promoted to PAPER', () => {
    freshDb(false); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    expect(evaluateRisk(prop(id, last)).reasonCodes.join()).toMatch(/STRATEGY_NOT_PROMOTED/);
  });
  it('fails closed on internal errors and unknown instruments', () => {
    acceptPolicy('owner', DEFAULT_POLICY);
    expect(evaluateRisk(prop('crypto:binance:NOPEUSDT', 1)).decision).toBe('DENY');
    const bad: any = { ...prop(id, last), stopPrice: undefined };
    expect(evaluateRisk(bad).decision).toBe('DENY');
  });
  it('only the owner can change limits; hard bounds cannot be exceeded', () => {
    expect(() => acceptPolicy('trader-joe', DEFAULT_POLICY)).toThrow(/owner/);
    expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, leverage: 3 })).toThrow();
    expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, riskPerTradePct: 5 })).toThrow();
    expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, drawdownHaltPct: 2, drawdownWarnPct: 5 })).toThrow();
  });
  it('non-owner actors can only reduce risk', () => {
    expect(() => updateControl('trader-joe', { mode: 'PAPER' })).toThrow();
    updateControl('trader-joe', { pausedNewOrders: true });
    expect(() => updateControl('trader-joe', { pausedNewOrders: false })).toThrow();
  });
});
