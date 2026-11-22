import { currentPolicy, type RiskPolicy } from './policy.js';
import { accountState, openPositions, PAPER_ACCOUNT, type AccountState } from '../portfolio/ledger.js';
import { getControl } from '../core/mode.js';
import { market } from '../market/store.js';
import { assessQuality, bookImpact, bookAge, QUALITY_LIMITS } from '../market/quality.js';
import { assessCexAsset } from '../safety/safety.js';
import { correlation } from '../portfolio/correlation.js';
import { all, get } from '../db/db.js';
import { iso } from '../core/util.js';
import { getSetting } from '../core/settings.js';
import { openIncidentFor } from '../exec/incidents.js';

/** Part 17.9 risk gate contract. Deterministic, fail-closed: any exception ⇒ DENY. */
export type RiskDecisionKind = 'ALLOW' | 'DENY' | 'NEEDS_REVIEW';
export interface RiskProposal { instrumentId: string; strategyId: string; side: 'buy'; entryPrice: number; stopPrice: number; idempotencyKey: string; traceId: string; account?: string }
export interface Sizing { qty: number; notional: number; maxNotional: number; riskBudget: number; plannedMaxLoss: number; perUnitLoss: number; conservativeStopFill: number; estEntry: number; estFees: number }
export interface RiskDecision { decision: RiskDecisionKind; reasonCodes: string[]; evaluated: Record<string, number | string | boolean | null>; sizing: Sizing | null; policyVersion: number | null; ts: string; traceId: string }

export function evaluateRisk(p: RiskProposal, nowTs = Date.now()): RiskDecision {
  try { return evaluateInner(p, nowTs); }
  catch (e: any) { return { decision: 'DENY', reasonCodes: [`RISK_ENGINE_EXCEPTION: ${String(e?.message ?? e).slice(0, 200)}`], evaluated: {}, sizing: null, policyVersion: currentPolicySafe(), ts: iso(nowTs), traceId: p.traceId }; }
}
const currentPolicySafe = () => { try { return currentPolicy()?.version ?? null; } catch { return null; } };

function floorStep(q: number, step: number) { if (!step) return q; const n = Math.floor(q / step + 1e-9); return Number((n * step).toFixed(12)); }

function evaluateInner(p: RiskProposal, nowTs: number): RiskDecision {
  const deny: string[] = []; const review: string[] = []; const ev: RiskDecision['evaluated'] = {};
  const pv = currentPolicy();
  if (!pv) return { decision: 'DENY', reasonCodes: ['POLICY_NOT_ACCEPTED: owner must review and accept a risk policy'], evaluated: {}, sizing: null, policyVersion: null, ts: iso(nowTs), traceId: p.traceId };
  const pol: RiskPolicy = pv.policy; const account = p.account ?? PAPER_ACCOUNT;
  const ctl = getControl();
  ev.mode = ctl.mode;
  if (ctl.emergency) deny.push('EMERGENCY_STOP_ACTIVE');
  if (ctl.pausedNewOrders) deny.push('NEW_ORDERS_PAUSED');
  if (ctl.mode === 'OBSERVE') deny.push('MODE_READ_ONLY');
  if (ctl.disabledStrategies.includes(p.strategyId)) deny.push(`STRATEGY_DISABLED:${p.strategyId}`);
  const suspended = getSetting<string[]>('suspendedStrategies', []);
  if (suspended.includes(p.strategyId)) deny.push(`STRATEGY_SUSPENDED:${p.strategyId}`);
  // Part 18 lifecycle: only strategies the owner promoted (after reviewing a backtest) may trade.
  const st = get<{ status: string }>('SELECT status FROM strategies WHERE id=?', p.strategyId);
  if (!st) deny.push(`STRATEGY_NOT_REGISTERED:${p.strategyId}`);
  else if (!['PAPER', 'LIVE_CANDIDATE'].includes(st.status)) deny.push(`STRATEGY_NOT_PROMOTED:${p.strategyId} is ${st.status} (promote to PAPER in Strategy Lab)`);

  const inst = market.instruments.get(p.instrumentId);
  if (!inst) { deny.push('INSTRUMENT_UNKNOWN'); return out(); }
  // An instrument where an open paper position cannot currently be exited must not receive new exposure.
  const incident = openIncidentFor(p.instrumentId);
  if (incident) deny.push(`PROTECTION_INCIDENT_OPEN:${incident.id}`);
  if (!pol.approvedMarkets.includes(inst.market as any)) deny.push(`MARKET_NOT_APPROVED:${inst.market}`);
  const safety = assessCexAsset(p.instrumentId); ev.safety = safety.status;
  if (!safety.eligibleForAutomation) deny.push(`ASSET_INELIGIBLE:${safety.status}`);
  const q = assessQuality(p.instrumentId, '1h', nowTs); ev.dataQuality = q.status;
  if (q.status === 'FAIL') deny.push(`DATA_QUALITY_FAIL:${q.issues.join('|')}`);
  const px = market.price(p.instrumentId);
  if (!px) { deny.push('NO_PRICE'); return out(); }
  const dev = (Math.abs(px.price - p.entryPrice) / p.entryPrice) * 100; ev.priceDeviationPct = round(dev, 4);
  if (!(p.entryPrice > 0) || !Number.isFinite(dev)) deny.push('ENTRY_PRICE_INVALID');
  else if (dev > pol.maxPriceDeviationPct) deny.push(`PRICE_DEVIATION ${dev.toFixed(3)}% > ${pol.maxPriceDeviationPct}%`);
  if (!(p.stopPrice > 0 && p.stopPrice < px.price)) deny.push('STOP_DIRECTION_INVALID (long stop must be below price)');

  const acct: AccountState = accountState(account, nowTs);
  Object.assign(ev, { equity: round(acct.equity, 2), dailyPnlPct: round(acct.dailyPnlPct, 3), weeklyPnlPct: round(acct.weeklyPnlPct, 3), drawdownPct: round(acct.drawdownPct, 3), openRiskPct: round(acct.openRiskPct, 3), openCount: acct.openCount, consecutiveLosses: acct.consecutiveLosses });
  if (acct.marksMissing.length) deny.push(`POSITION_MARKS_MISSING:${acct.marksMissing.join(',')}`);
  if (acct.equity <= 0) deny.push('NO_EQUITY (fund the paper bot allocation)');
  if (-acct.dailyPnlPct >= pol.dailyLossPct) deny.push(`DAILY_LOSS_BREAKER ${acct.dailyPnlPct.toFixed(2)}%`);
  if (-acct.weeklyPnlPct >= pol.weeklyLossPct) deny.push(`WEEKLY_LOSS_BREAKER ${acct.weeklyPnlPct.toFixed(2)}%`);
  if (acct.drawdownPct >= pol.drawdownHaltPct) deny.push(`DRAWDOWN_CAPITAL_PRESERVATION ${acct.drawdownPct.toFixed(2)}%`);
  else if (acct.drawdownPct >= pol.drawdownWarnPct) review.push(`DRAWDOWN_WARNING ${acct.drawdownPct.toFixed(2)}%`);
  if (acct.consecutiveLosses >= pol.maxConsecutiveLosses) {
    const last = all<{ closed_at: number }>("SELECT closed_at FROM positions WHERE account=? AND status='CLOSED' ORDER BY closed_at DESC LIMIT 1", account)[0];
    const until = (last?.closed_at ?? 0) + pol.cooldownMinutesAfterLossStreak * 60_000;
    if (nowTs < until) deny.push(`LOSS_STREAK_COOLDOWN until ${iso(until)}`); else review.push(`LOSS_STREAK_REVIEW (${acct.consecutiveLosses} consecutive losses)`);
  }
  const open = openPositions(account);
  if (open.length >= pol.maxConcurrentPositions) deny.push(`MAX_CONCURRENT_POSITIONS ${open.length}`);
  if (open.some((o) => o.instrument === p.instrumentId)) deny.push('DUPLICATE_INSTRUMENT_POSITION');
  const pending = all("SELECT id FROM orders WHERE instrument=? AND status IN ('NEW','PENDING_APPROVAL','PARTIALLY_FILLED') AND purpose='ENTRY' AND client_order_id<>?", p.instrumentId, p.idempotencyKey);
  if (pending.length) deny.push('PENDING_ENTRY_ORDER_EXISTS');
  if (all("SELECT id FROM orders WHERE client_order_id=? AND status<>'PENDING_APPROVAL'", p.idempotencyKey).length) deny.push('DUPLICATE_REQUEST (idempotency key reused)');
  // correlation / concentration (conservative when unknown)
  let correlated = 0;
  for (const o of open) { const c = correlation(o.instrument, p.instrumentId); if (c == null || c >= pol.correlationThreshold) correlated++; }
  ev.correlatedOpenPositions = correlated;
  if (correlated >= pol.maxCorrelatedPositions) deny.push(`CORRELATION_LIMIT ${correlated} correlated open positions`);

  // Sizing (Part 17.3) — conservative execution assumptions
  const d = market.deep.get(p.instrumentId);
  const estEntry = px.ask || px.price;
  const conservativeStopFill = p.stopPrice * (1 - pol.stopFillBufferPct / 100);
  const perUnitLoss = estEntry - conservativeStopFill + pol.feeRate * (estEntry + conservativeStopFill);
  const riskBudget = acct.equity * (pol.riskPerTradePct / 100);
  let qty = perUnitLoss > 0 ? riskBudget / perUnitLoss : 0;
  const maxNotional = Math.min(acct.equity * (pol.maxPositionNotionalPct / 100), acct.cash * 0.98);
  if (qty * estEntry > maxNotional) qty = maxNotional / estEntry;
  qty = floorStep(qty, inst.stepSize);
  const notional = qty * estEntry;
  if (qty <= 0 || qty < inst.minQty || notional < Math.max(inst.minNotional, 5)) deny.push(`SIZE_BELOW_VENUE_MINIMUM qty=${qty} notional=${notional.toFixed(2)}`);
  const plannedMaxLoss = qty * perUnitLoss;
  // NaN compares false against every limit, so a non-finite input would otherwise slip through as ALLOW.
  if (![acct.equity, acct.cash, acct.dailyPnlPct, acct.weeklyPnlPct, acct.drawdownPct, estEntry, perUnitLoss, qty, notional, maxNotional, plannedMaxLoss].every(Number.isFinite)) deny.push('NON_FINITE_INPUT (risk cannot be computed)');
  if (acct.openRiskUsd + plannedMaxLoss > acct.equity * (pol.maxOpenRiskPct / 100) + 1e-9) deny.push(`AGGREGATE_OPEN_RISK ${(((acct.openRiskUsd + plannedMaxLoss) / acct.equity) * 100).toFixed(2)}% > ${pol.maxOpenRiskPct}%`);
  const imp = bookImpact(d?.book ?? null, 'buy', Math.max(notional, 1));
  const age = bookAge(d?.book, nowTs); ev.bookAgeMs = age;
  if (!imp || age == null) deny.push('NO_ORDER_BOOK (cannot estimate slippage)');
  else if (age > QUALITY_LIMITS.maxExecBookAgeMs) deny.push(`ORDER_BOOK_STALE ${Math.round(age / 1000)}s > ${Math.round(QUALITY_LIMITS.maxExecBookAgeMs / 1000)}s (slippage cannot be trusted)`);
  else {
    ev.spreadBps = round(imp.spreadBps, 2); ev.impactBps = Number.isFinite(imp.impactBps) ? round(imp.impactBps, 2) : null;
    if (imp.spreadBps > pol.maxSpreadBps) deny.push(`SPREAD ${imp.spreadBps.toFixed(1)}bps > ${pol.maxSpreadBps}`);
    if (!imp.filledFully || imp.impactBps > pol.maxSlippageBps) deny.push(`SLIPPAGE ${imp.impactBps.toFixed(1)}bps > ${pol.maxSlippageBps}`);
    const costR = ((2 * pol.feeRate + (imp.spreadBps + 2 * (Number.isFinite(imp.impactBps) ? imp.impactBps : 1e4)) / 1e4) * estEntry) / (estEntry - p.stopPrice);
    ev.costR = round(costR, 4);
    if (costR > pol.maxCostR) deny.push(`COST_R ${costR.toFixed(3)} > ${pol.maxCostR}`);
  }
  const sizing: Sizing = { qty, notional: round(notional, 2), maxNotional, riskBudget: round(riskBudget, 2), plannedMaxLoss: round(plannedMaxLoss, 2), perUnitLoss, conservativeStopFill, estEntry, estFees: round(pol.feeRate * notional * 2, 4) };
  return out(sizing);

  function out(sz: Sizing | null = null): RiskDecision {
    const decision: RiskDecisionKind = deny.length ? 'DENY' : review.length ? 'NEEDS_REVIEW' : 'ALLOW';
    return { decision, reasonCodes: [...deny, ...review], evaluated: ev, sizing: sz, policyVersion: pv!.version, ts: iso(nowTs), traceId: p.traceId };
  }
}
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
