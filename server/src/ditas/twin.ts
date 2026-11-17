import { newExitState, stepExit } from '../lab/exits.js';
import type { Signal } from '../lab/strategies.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';

export interface TwinPlan { instrumentId: string; decisionAt: number; timeframe: Interval; signal: Signal }
export interface TwinAssumptions {
  feeRate: number; spreadBps: number; slippageBps: number; notional: number; maxParticipationRate: number;
  /** Additional bars to wait for the alternative; shadow always uses the first supplied opening. */
  entryDelayBars?: number;
  /** Contemporaneous executable-depth estimate, never volume from future candles. */
  availableNotional?: number; liquidityObservedAt?: number;
}
export interface TwinFill { t: number; side: 'BUY' | 'SELL'; reason: string; qty: number; price: number; fee: number }
export interface TwinTrade {
  kind: 'HYPOTHETICAL'; state: 'NO_FILL' | 'OPEN' | 'CLOSED'; reason: string; entryDelayBars: number;
  entryAt: number | null; exitAt: number | null; entryPrice: number | null;
  requestedNotional: number; filledNotional: number; qty: number; qtyOpen: number; partialEntry: boolean;
  fees: number; netPnL: number | null; realizedNetPnL: number; unrealizedNetPnL: number | null;
  r: number | null; fills: TwinFill[];
}
export interface TwinResult {
  kind: 'HYPOTHETICAL'; version: 'ditas-twin/1'; plan: TwinPlan; assumptions: TwinAssumptions;
  shadow: TwinTrade; counterfactual: TwinTrade;
  waitBaseline: { kind: 'HYPOTHETICAL'; action: 'WAIT'; netPnL: 0; fees: 0 };
  comparison: { delayedMinusShadow: number | null; waitAvoidedLoss: number | null; waitMissedGain: number | null };
  limitations: string[];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
function requireFiniteResult(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('simulation arithmetic overflow');
  if (value && typeof value === 'object') for (const child of Object.values(value)) requireFiniteResult(child);
}

/** Research-only counterfactual evaluation. Has no imports from OMS, policy, financial ledger or database. */
export function simulateTwin(planInput: TwinPlan, candles: readonly Candle[], assumptionsInput: TwinAssumptions): TwinResult {
  const plan = structuredClone(planInput), assumptions = structuredClone(assumptionsInput);
  const duration = INTERVAL_MS[plan.timeframe], signal = plan.signal;
  if (!plan.instrumentId || !Number.isSafeInteger(plan.decisionAt) || plan.decisionAt < 0 || !duration) throw new Error('invalid frozen decision identity, time or timeframe');
  if (signal.direction !== 'long' || !positive(signal.entryRef) || !positive(signal.stop) || signal.stop >= signal.entryRef || !Number.isInteger(signal.maxHoldBars) || signal.maxHoldBars < 1 || signal.maxHoldBars > 2000 || (signal.trailAfterR !== null && !positive(signal.trailAfterR))) throw new Error('invalid long-only frozen signal');
  if (!signal.targets.length || signal.targets.some(t => !positive(t.r) || !positive(t.fraction) || t.fraction > 1) || Math.abs(signal.targets.reduce((sum, t) => sum + t.fraction, 0) - 1) > 1e-9 || signal.targets.some((t, i) => i > 0 && t.r <= signal.targets[i - 1].r)) throw new Error('targets must be increasing positive R levels with fractions summing to one');
  const { feeRate, spreadBps, slippageBps, notional, maxParticipationRate } = assumptions;
  if (!finite(feeRate) || feeRate < 0 || feeRate > 0.1 || !finite(spreadBps) || spreadBps < 0 || spreadBps > 1000 || !finite(slippageBps) || slippageBps < 0 || slippageBps > 1000 || !positive(notional) || notional > 100_000_000 || !positive(maxParticipationRate) || maxParticipationRate > 1) throw new Error('invalid or unbounded execution assumptions');
  const delay = assumptions.entryDelayBars ?? 1;
  if (!Number.isInteger(delay) || delay < 1 || delay > 100) throw new Error('entryDelayBars must be an integer from 1 to 100');
  if (assumptions.availableNotional != null && (!finite(assumptions.availableNotional) || assumptions.availableNotional < 0)) throw new Error('invalid decision-time depth');
  if (assumptions.liquidityObservedAt != null && (!finite(assumptions.liquidityObservedAt) || assumptions.liquidityObservedAt < 0)) throw new Error('invalid liquidity timestamp');
  if (candles.length > 2000) throw new Error('maximum 2000 evaluation candles');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.t, c.o, c.h, c.l, c.c, c.v].every(finite) || !Number.isSafeInteger(c.t) || c.t < plan.decisionAt || Math.min(c.o, c.h, c.l, c.c) <= 0 || c.v < 0 || c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c) || c.h < c.l) throw new Error('invalid future historical OHLCV');
    if (i && c.t - candles[i - 1].t !== duration) throw new Error('evaluation candles must be consecutive and ordered');
    if (c.closeTime != null && (!finite(c.closeTime) || c.closeTime < c.t + duration - 1 || c.closeTime >= c.t + duration)) throw new Error('invalid historical candle close time');
  }
  const slip = (slippageBps + spreadBps / 2) / 10_000;
  const noFill = (entryDelayBars: number, reason: string): TwinTrade => ({ kind: 'HYPOTHETICAL', state: 'NO_FILL', reason, entryDelayBars, entryAt: null, exitAt: null, entryPrice: null, requestedNotional: notional, filledNotional: 0, qty: 0, qtyOpen: 0, partialEntry: false, fees: 0, netPnL: null, realizedNetPnL: 0, unrealizedNetPnL: null, r: null, fills: [] });
  const run = (entryDelayBars: number): TwinTrade => {
    if (assumptions.availableNotional == null || assumptions.liquidityObservedAt == null) return noFill(entryDelayBars, 'No decision-time liquidity evidence supplied');
    if (assumptions.liquidityObservedAt > plan.decisionAt || plan.decisionAt - assumptions.liquidityObservedAt > 180_000) return noFill(entryDelayBars, 'Decision-time liquidity evidence is future-dated or stale');
    const first = candles[entryDelayBars];
    if (!first) return noFill(entryDelayBars, 'No opening bar available for this entry delay');
    const filledNotional = Math.min(notional, assumptions.availableNotional * maxParticipationRate);
    if (!(filledNotional > 0)) return noFill(entryDelayBars, 'No executable participation capacity in supplied decision-time depth');
    const entry = first.o * (1 + slip);
    const originalRisk = signal.entryRef - signal.stop;
    const targets = signal.targets.map(t => ({ price: signal.entryRef + originalRisk * t.r, fraction: t.fraction }));
    if (!(entry > signal.stop) || targets.some(t => t.price <= entry)) return noFill(entryDelayBars, 'Opening gap invalidated the frozen stop/target plan');
    if (!finite(entry) || targets.some(t => !finite(t.price))) throw new Error('price arithmetic overflow');
    const qty = filledNotional / entry;
    if (!finite(qty) || qty <= 1e-12 || !positive(qty * (entry - signal.stop))) return noFill(entryDelayBars, 'Position falls outside supported numerical precision');
    const state = newExitState(entry, signal.stop, qty, targets.map(t => ({ r: (t.price - entry) / (entry - signal.stop), fraction: t.fraction })), signal.trailAfterR, signal.maxHoldBars);
    requireFiniteResult(state);
    const entryFee = filledNotional * feeRate;
    const fills: TwinFill[] = [{ t: first.t, side: 'BUY', reason: 'ENTRY', qty, price: entry, fee: entryFee }];
    let proceeds = 0, exitFees = 0, exitAt: number | null = null, reason = 'History ended with an open position';
    for (let i = entryDelayBars; i < candles.length; i++) {
      const c = candles[i];
      // Signal targets stay fixed. Entry-bar exits are evaluated but holding count matches existing backtester.
      const exits = stepExit(state, c, slip, i !== entryDelayBars);
      requireFiniteResult(state);
      for (const fill of exits) {
        const price = fill.reason === 'TARGET' || fill.reason === 'TIME' ? fill.price * (1 - slip) : fill.price;
        const fee = price * fill.qty * feeRate;
        proceeds += price * fill.qty; exitFees += fee;
        fills.push({ t: c.t, side: 'SELL', reason: fill.reason, qty: fill.qty, price, fee });
        reason = fill.reason;
      }
      if (state.qtyLeft <= 1e-12) { exitAt = c.t; break; }
    }
    const closed = exitAt !== null, qtyOpen = closed ? 0 : state.qtyLeft, soldQty = qty - qtyOpen;
    const realizedNetPnL = proceeds - soldQty * entry - exitFees - entryFee * (soldQty / qty);
    const mark = candles[candles.length - 1].c * (1 - slip);
    const unrealizedNetPnL = closed ? null : qtyOpen * (mark - entry) - qtyOpen * mark * feeRate - entryFee * qtyOpen / qty;
    const netPnL = closed ? realizedNetPnL : null;
    return { kind: 'HYPOTHETICAL', state: closed ? 'CLOSED' : 'OPEN', reason: closed ? reason : 'History ended with an open position; unrealized value is an estimated liquidation mark', entryDelayBars, entryAt: first.t, exitAt, entryPrice: entry, requestedNotional: notional, filledNotional, qty, qtyOpen, partialEntry: filledNotional < notional, fees: entryFee + exitFees, netPnL, realizedNetPnL, unrealizedNetPnL, r: netPnL == null ? null : netPnL / (qty * (entry - signal.stop)), fills };
  };
  const shadow = run(0), counterfactual = run(delay);
  const result: TwinResult = { kind: 'HYPOTHETICAL', version: 'ditas-twin/1', plan, assumptions: { ...assumptions, entryDelayBars: delay }, shadow, counterfactual, waitBaseline: { kind: 'HYPOTHETICAL', action: 'WAIT', netPnL: 0, fees: 0 }, comparison: { delayedMinusShadow: shadow.netPnL != null && counterfactual.netPnL != null ? counterfactual.netPnL - shadow.netPnL : null, waitAvoidedLoss: shadow.netPnL == null ? null : Math.max(0, -shadow.netPnL), waitMissedGain: shadow.netPnL == null ? null : Math.max(0, shadow.netPnL) }, limitations: ['Hypothetical fills are conditional estimates, never actual executions or guaranteed fills.', 'Liquidity is capped using decision-time depth only; future candle volume is never used for opening size.', 'Delayed-entry comparison reuses the frozen depth assumption; later order-book availability is unknown.', 'Exit depth, queue priority, intrabar price path, financing and changing spreads are not modeled; stop-first ordering is conservative.', 'Supplied historical bars need independent source provenance and closure verification; this pure evaluator performs structural validation only.', 'OPEN results are censored; estimated liquidation marks are not realized returns.', 'Frozen absolute stops/targets are preserved; this research result cannot promote strategies or authorize orders.'] };
  requireFiniteResult(result);
  return result;
}
