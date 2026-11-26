import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, accountState } from '../src/portfolio/ledger.js';
import { setSetting } from '../src/core/settings.js';
import { run } from '../src/db/db.js';

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
  it('preserves legacy sizing and clamps an explicitly accepted combined reserve including fees', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const legacy = evaluateRisk(prop(id, last));
    expect(legacy.decision).toBe('ALLOW');
    expect(legacy.evaluated.cashReserveFloorUsd).toBeUndefined();
    acceptPolicy('owner', { ...DEFAULT_POLICY, minUnallocatedReservePct: 94, minSettlementReservePct: 5 });
    const capped = evaluateRisk(prop(id, last));
    expect(capped.decision).toBe('ALLOW');
    expect(capped.evaluated).toMatchObject({ cashReserveFloorUsd: 9900, cashReserveHeadroomUsd: 100 });
    expect(capped.sizing!.maxNotional * (1 + DEFAULT_POLICY.feeRate)).toBeLessThanOrEqual(100 + 1e-8);
    expect(capped.sizing!.qty).toBeLessThan(legacy.sizing!.qty);
  });
  it('denies at the reserve floor and rejects invalid or unauthorized reserve policy changes', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, minUnallocatedReservePct: 95, minSettlementReservePct: 5 });
    updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const denied = evaluateRisk(prop(id, last));
    expect(denied.decision).toBe('DENY');
    expect(denied.reasonCodes).toContain('CASH_RESERVE_FLOOR_REACHED');
    for (const invalid of [
      { minUnallocatedReservePct: 96, minSettlementReservePct: 5 },
      { minUnallocatedReservePct: -1 },
      { minSettlementReservePct: Infinity },
      { minSettlementReservePct: NaN },
    ]) expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, ...invalid })).toThrow();
    expect(() => acceptPolicy('bot', { ...DEFAULT_POLICY, minUnallocatedReservePct: 50, minSettlementReservePct: 5 })).toThrow(/owner/);
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
  it('uses persisted positions for cooldown and rolling entry limits', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, postExitCooldownMs: 10000, stopLossCooldownMs: 30000, entryFrequencyWindowMs: 60000, maxEntriesPerWindow: 1 });
    updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10000);
    const now = Date.now();
    run("INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk,exit_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      'fixture-position', PAPER_ACCOUNT, id, 'crypto', 'LONG', 'trend_pullback', 0, last, last * 0.97, last * 0.97, '{}', 'CLOSED', now - 20000, now - 5000, -1, 0, 10, 'STOP');
    const denied = evaluateRisk(prop(id, last), now);
    expect(denied.reasonCodes).toContain('ASSET_POST_EXIT_COOLDOWN');
    expect(denied.reasonCodes).toContain('ENTRY_FREQUENCY_CAP');
    expect(denied.evaluated.assetCooldownUntilMs).toBe(now + 25000);
    const later = evaluateRisk(prop(id, last), now + 60000);
    expect(later.reasonCodes).not.toContain('ASSET_POST_EXIT_COOLDOWN');
    expect(later.reasonCodes).not.toContain('ENTRY_FREQUENCY_CAP');
  });
  it('reduces sizing on drawdown and preserves hard breakers', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, adaptiveDrawdownSizing: true });
    updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10000);
    const now = Date.now(); const initial = evaluateRisk(prop(id, last), now);
    expect(initial.evaluated.adaptiveAllocationMultiplier).toBe(1);
    const day = new Date(now).toISOString().slice(0, 10);
    const monday = new Date(now); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    setSetting('marks2:' + PAPER_ACCOUNT, { day, week: monday.toISOString().slice(0, 10), sodPerf: 0, sowPerf: 0, hwmPerf: 300 });
    const reduced = evaluateRisk(prop(id, last), now);
    expect(reduced.evaluated.adaptiveAllocationMultiplier).toBe(0.65);
    expect(reduced.sizing!.riskBudget).toBeCloseTo(initial.sizing!.riskBudget * 0.65);
    expect(reduced.sizing!.qty).toBeLessThan(initial.sizing!.qty);
    setSetting('marks2:' + PAPER_ACCOUNT, { day, week: monday.toISOString().slice(0, 10), sodPerf: 0, sowPerf: 0, hwmPerf: 1000 });
    const halted = evaluateRisk(prop(id, last), now);
    expect(halted.decision).toBe('DENY');
    expect(halted.reasonCodes).toContain('ADAPTIVE_DRAWDOWN_HALT');
    expect(halted.reasonCodes.join()).toContain('DRAWDOWN_CAPITAL_PRESERVATION');
  });
  it('refuses adaptive sizing while another open position has a stale mark', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, adaptiveDrawdownSizing: true });
    updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10000);
    const btc = 'crypto:binance:BTCUSDT'; const now = Date.now();
    run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,planned_risk)
      VALUES ('held','paper-bot',?,'crypto','LONG','trend_pullback',0.001,?,?,?,'[]','OPEN',?,0,0,1)`, btc, 100, 90, 90, now - 60_000);
    expect(evaluateRisk(prop(id, last), now).reasonCodes.join()).not.toMatch(/ADAPTIVE_SIZING_MARKS_STALE/);
    market.tickers.get(btc)!.receivedAt = now - 10 * 60_000;
    const deep = market.deep.get(btc); if (deep?.book) deep.book.ts = now - 10 * 60_000;
    const r = evaluateRisk(prop(id, last), now);
    expect(r.decision).toBe('DENY');
    expect(r.reasonCodes).toContain(`ADAPTIVE_SIZING_MARKS_STALE:${btc}`);
    // Without adaptive sizing the existing rules apply unchanged.
    acceptPolicy('owner', DEFAULT_POLICY);
    expect(evaluateRisk(prop(id, last), now).reasonCodes.join()).not.toMatch(/ADAPTIVE_SIZING_MARKS_STALE/);
  });
  it('rolls back a risk policy version when audit persistence fails', () => {
    const prior = acceptPolicy('owner', DEFAULT_POLICY);
    run("CREATE TEMP TRIGGER fixture_reject_policy_audit BEFORE INSERT ON audit_log WHEN NEW.action='risk.policy.accept' BEGIN SELECT RAISE(ABORT, 'fixture policy audit failure'); END");
    try {
      expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, postExitCooldownMs: 10000 })).toThrow('fixture policy audit failure');
      expect(currentPolicy()).toEqual(prior);
    } finally { run('DROP TRIGGER fixture_reject_policy_audit'); }
  });
  it('rejects incomplete frequency policy and invalid anti-churn configuration', () => {
    expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, maxEntriesPerWindow: 2 })).toThrow();
    expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, postExitCooldownMs: -1 })).toThrow();
    expect(() => acceptPolicy('owner', { ...DEFAULT_POLICY, adaptiveDrawdownSizing: 'true' })).toThrow();
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
