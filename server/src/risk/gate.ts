import { storageBlocksEntries, storageStatus } from '../ops/storage.js';
import { currentPolicy, type RiskPolicy } from './policy.js';
import { accountState, openPositions, PAPER_ACCOUNT, type AccountState } from '../portfolio/ledger.js';
import { controlAuthority } from '../core/mode.js';
import { market } from '../market/store.js';
import { assessQuality, bookImpact, bookAge, QUALITY_LIMITS } from '../market/quality.js';
import { assessCexAsset } from '../safety/safety.js';
import { correlation } from '../portfolio/correlation.js';
import { all, get } from '../db/db.js';
import { iso } from '../core/util.js';
import { getSetting } from '../core/settings.js';
import { openIncidentFor } from '../exec/incidents.js';
import { unreconciledPaperOrders } from '../exec/recovery.js';

/** Part 17.9 risk gate contract. Deterministic, fail-closed: any exception ⇒ DENY. */
export type RiskDecisionKind = 'ALLOW' | 'DENY' | 'NEEDS_REVIEW';
export interface RiskProposal { instrumentId: string; strategyId: string; strategyVersion?: string; side: 'buy'; entryPrice: number; stopPrice: number; idempotencyKey: string; traceId: string; account?: string }
export interface Sizing { qty: number; notional: number; maxNotional: number; riskBudget: number; remainingOpenRisk: number; plannedMaxLoss: number; perUnitLoss: number; conservativeStopFill: number; estEntry: number; estFees: number }
export interface RiskDecision { decision: RiskDecisionKind; reasonCodes: string[]; evaluated: Record<string, number | string | boolean | null>; sizing: Sizing | null; policyVersion: number | null; ts: string; traceId: string }

export function evaluateRisk(p: RiskProposal, nowTs = Date.now()): RiskDecision {
  if (p.account !== undefined && p.account !== PAPER_ACCOUNT) {
    return { decision: 'DENY', reasonCodes: ['ACCOUNT_UNSUPPORTED'], evaluated: {}, sizing: null, policyVersion: null, ts: iso(nowTs), traceId: p.traceId };
  }
  try { return evaluateInner(p, nowTs); }
  catch (e: any) { return { decision: 'DENY', reasonCodes: [`RISK_ENGINE_EXCEPTION: ${String(e?.message ?? e).slice(0, 200)}`], evaluated: {}, sizing: null, policyVersion: currentPolicySafe(), ts: iso(nowTs), traceId: p.traceId }; }
}
const currentPolicySafe = () => { try { return currentPolicy()?.version ?? null; } catch { return null; } };

function floorStep(q: number, step: number) { if (!step) return q; const n = Math.floor(q / step + 1e-9); return Number((n * step).toFixed(12)); }

function evaluateInner(p: RiskProposal, nowTs: number): RiskDecision {
  const deny: string[] = []; const review: string[] = []; const ev: RiskDecision['evaluated'] = {};
  const pv = currentPolicy();
  if (!pv) return { decision: 'DENY', reasonCodes: ['POLICY_NOT_ACCEPTED: owner must review and accept a risk policy'], evaluated: {}, sizing: null, policyVersion: null, ts: iso(nowTs), traceId: p.traceId };
  const pol: RiskPolicy = pv.policy; const account = PAPER_ACCOUNT;
  const authority = controlAuthority(), ctl = authority.control;
  ev.mode = ctl.mode;
  if (ctl.emergency) deny.push('EMERGENCY_STOP_ACTIVE');
  if (ctl.pausedNewOrders) deny.push('NEW_ORDERS_PAUSED');
  if (authority.unavailableMode) deny.push('MODE_NOT_PAPER');
  else if (ctl.mode === 'OBSERVE') deny.push('MODE_READ_ONLY');
  else if (ctl.mode !== 'PAPER' && ctl.mode !== 'APPROVAL') deny.push('MODE_NOT_PAPER');
  if (unreconciledPaperOrders()) deny.push('UNRECONCILED_PAPER_ORDERS');
  // A nearly full volume could reject the fills, settlements and stop updates a new position would need.
  const storage = storageStatus(nowTs); ev.storage = storage.level;
  if (storageBlocksEntries(storage)) deny.push(`STORAGE_${storage.level}: database volume too full to accept new exposure safely`);
  if (ctl.disabledStrategies.includes(p.strategyId)) deny.push(`STRATEGY_DISABLED:${p.strategyId}`);
  const suspended = getSetting<string[]>('suspendedStrategies', []);
  if (suspended.includes(p.strategyId)) deny.push(`STRATEGY_SUSPENDED:${p.strategyId}`);
  // Part 18 lifecycle: only strategies the owner promoted (after reviewing a backtest) may trade.
  const st = get<{ status: string; version: string }>('SELECT status,version FROM strategies WHERE id=?', p.strategyId);
  if (!st) deny.push(`STRATEGY_NOT_REGISTERED:${p.strategyId}`);
  else if (!['PAPER', 'LIVE_CANDIDATE'].includes(st.status)) deny.push(`STRATEGY_NOT_PROMOTED:${p.strategyId} is ${st.status} (promote to PAPER in Strategy Lab)`);
  else if (p.strategyVersion !== undefined && p.strategyVersion !== st.version) deny.push('STRATEGY_VERSION_MISMATCH');

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
  const pending = all("SELECT id FROM orders WHERE account=? AND instrument=? AND status='PENDING_APPROVAL' AND purpose='ENTRY' AND client_order_id<>?", account, p.instrumentId, p.idempotencyKey);
  if (pending.length) deny.push('PENDING_ENTRY_ORDER_EXISTS');
  if (all("SELECT id FROM orders WHERE client_order_id=? AND status<>'PENDING_APPROVAL'", p.idempotencyKey).length) deny.push('DUPLICATE_REQUEST (idempotency key reused)');
  // Derive throttles from persisted positions; no resettable in-memory counter.
  const cooldown = pol.postExitCooldownMs === undefined ? 0 : pol.postExitCooldownMs;
  const stopCooldown = pol.stopLossCooldownMs === undefined ? 0 : pol.stopLossCooldownMs;
  const window = pol.entryFrequencyWindowMs, cap = pol.maxEntriesPerWindow;
  if (![cooldown, stopCooldown].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 604_800_000)
      || (window === undefined) !== (cap === undefined)
      || (window !== undefined && (!Number.isSafeInteger(window) || window < 1000 || window > 86_400_000))
      || (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1 || cap > 1000))
      || (pol.adaptiveDrawdownSizing !== undefined && typeof pol.adaptiveDrawdownSizing !== 'boolean')) {
    deny.push('INVALID_ADAPTIVE_RISK_POLICY'); return out();
  }
  if (cooldown > 0 || stopCooldown > 0) {
    const previous = get<{ closed_at: number; exit_reason: string | null }>(
      "SELECT closed_at,exit_reason FROM positions WHERE account=? AND instrument=? AND status='CLOSED' ORDER BY closed_at DESC,id DESC LIMIT 1", account, p.instrumentId);
    if (previous) {
      if (!Number.isSafeInteger(previous.closed_at) || previous.closed_at <= 0 || previous.closed_at > nowTs) deny.push('INVALID_EXIT_HISTORY');
      else {
        const isStop = previous.exit_reason === 'STOP' || previous.exit_reason === 'TRAIL_STOP';
        const until = previous.closed_at + (isStop ? Math.max(cooldown, stopCooldown) : cooldown);
        ev.assetCooldownUntilMs = until;
        if (nowTs < until) deny.push('ASSET_POST_EXIT_COOLDOWN');
      }
    }
  }
  if (window !== undefined && cap !== undefined) {
    const count = get<{ n: number }>("SELECT COUNT(*) n FROM positions WHERE account=? AND opened_at>? AND opened_at<=?", account, nowTs-window, nowTs)!.n;
    ev.recentFilledEntries = count;
    if (get("SELECT 1 FROM positions WHERE account=? AND opened_at>? LIMIT 1", account, nowTs)) deny.push('INVALID_ENTRY_HISTORY');
    if (count >= cap) deny.push('ENTRY_FREQUENCY_CAP');
  }
  // correlation / concentration (conservative when unknown)
  let correlated = 0;
  for (const o of open) { const c = correlation(o.instrument, p.instrumentId); if (c == null || c >= pol.correlationThreshold) correlated++; }
  ev.correlatedOpenPositions = correlated;
  if (correlated >= pol.maxCorrelatedPositions) deny.push(`CORRELATION_LIMIT ${correlated} correlated open positions`);

  // Sizing (Part 17.3) — conservative execution assumptions
  const d = market.deep.get(p.instrumentId);
  const estEntry = px.ask || px.price;
  const conservativeStopFill = p.stopPrice * (1 - pol.stopFillBufferPct / 100);
  // Size from the worst entry permitted by the slippage policy; actual fills are rechecked by the OMS.
  // The notional cap uses it too: the OMS enforces the cap at the executed price, which may be worse than the top ask.
  const worstPermittedEntry = estEntry * (1 + pol.maxSlippageBps / 10_000);
  const perUnitLoss = worstPermittedEntry - conservativeStopFill + pol.feeRate * (worstPermittedEntry + conservativeStopFill);
  // Reduce only; reuse persisted deposit-invariant high-water marks and loss streaks.
  let allocationMultiplier = 1;
  if (pol.adaptiveDrawdownSizing === true) {
    if (!Number.isFinite(acct.drawdownPct) || acct.drawdownPct < 0 || !Number.isSafeInteger(acct.consecutiveLosses) || acct.consecutiveLosses < 0) {
      deny.push('INVALID_DRAWDOWN_EVIDENCE'); return out();
    }
    if (acct.drawdownPct >= 8 || acct.consecutiveLosses >= 7) allocationMultiplier = 0;
    else if (acct.drawdownPct >= 5 || acct.consecutiveLosses >= 5) allocationMultiplier = 0.35;
    else if (acct.drawdownPct >= 2.5 || acct.consecutiveLosses >= 3) allocationMultiplier = 0.65;
    ev.adaptiveAllocationMultiplier = allocationMultiplier;
    if (allocationMultiplier === 0) deny.push('ADAPTIVE_DRAWDOWN_HALT');
  }
  const riskBudget = acct.equity * (pol.riskPerTradePct / 100) * allocationMultiplier;
  let qty = perUnitLoss > 0 ? riskBudget / perUnitLoss : 0;
  // The only financial authority is the canonical gate, re-evaluated inside the OMS
  // transaction. Treat the two optional reserves as disjoint logical cash portions.
  // Do not invent settlement balances, allocate against stale proposals, or release cash
  // on an exit request. The ledger credits cash only after the existing exit settles.
  const unallocatedPct = pol.minUnallocatedReservePct === undefined ? 0 : pol.minUnallocatedReservePct;
  const settlementPct = pol.minSettlementReservePct === undefined ? 0 : pol.minSettlementReservePct;
  if (![unallocatedPct, settlementPct].every(v => Number.isFinite(v) && v >= 0 && v <= 100)
      || unallocatedPct + settlementPct > 100) {
    deny.push('INVALID_CASH_RESERVE_POLICY');
    return out();
  }
  let maxNotional = Math.min(acct.equity * (pol.maxPositionNotionalPct / 100), acct.cash * 0.98) * allocationMultiplier;
  if (unallocatedPct + settlementPct > 0) {
    const floor = acct.equity * ((unallocatedPct + settlementPct) / 100);
    const cashHeadroom = acct.cash - floor;
    const reserveNotional = Math.max(0, cashHeadroom / (1 + pol.feeRate));
    if (![floor, cashHeadroom, reserveNotional].every(Number.isFinite)
        || !Number.isFinite(pol.feeRate) || pol.feeRate < 0) {
      deny.push('INVALID_CASH_RESERVE_EVIDENCE');
      return out();
    }
    ev.cashReserveFloorUsd = floor;
    ev.cashReserveHeadroomUsd = Math.max(0, cashHeadroom);
    if (cashHeadroom <= 0) deny.push('CASH_RESERVE_FLOOR_REACHED');
    maxNotional = Math.min(maxNotional, reserveNotional);
    // Use the worst allowed entry to avoid allocating beyond the reserve on a depth walk.
    qty = Math.min(qty, reserveNotional / worstPermittedEntry);
  }
  // Cap at the worst permitted entry so any fill within the slippage policy also fits the cap the OMS enforces.
  if (qty * worstPermittedEntry > maxNotional) qty = maxNotional / worstPermittedEntry;
  qty = floorStep(qty, inst.stepSize);
  const notional = qty * estEntry;
  if (qty <= 0 || qty < inst.minQty || notional < Math.max(inst.minNotional, 5)) deny.push(`SIZE_BELOW_VENUE_MINIMUM qty=${qty} notional=${notional.toFixed(2)}`);
  const plannedMaxLoss = qty * perUnitLoss;
  const remainingOpenRisk = acct.equity * (pol.maxOpenRiskPct / 100) - acct.openRiskUsd;
  // NaN compares false against every limit, so a non-finite input would otherwise slip through as ALLOW.
  if (![acct.equity, acct.cash, acct.dailyPnlPct, acct.weeklyPnlPct, acct.drawdownPct, estEntry, perUnitLoss, qty, notional, maxNotional, riskBudget, remainingOpenRisk, plannedMaxLoss].every(Number.isFinite)) deny.push('NON_FINITE_INPUT (risk cannot be computed)');
  if (plannedMaxLoss > remainingOpenRisk + 1e-9) deny.push(`AGGREGATE_OPEN_RISK ${(((acct.openRiskUsd + plannedMaxLoss) / acct.equity) * 100).toFixed(2)}% > ${pol.maxOpenRiskPct}%`);
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
  const sizing: Sizing = { qty, notional: round(notional, 2), maxNotional, riskBudget, remainingOpenRisk, plannedMaxLoss: round(plannedMaxLoss, 2), perUnitLoss, conservativeStopFill, estEntry, estFees: round(pol.feeRate * notional * 2, 4) };
  return out(sizing);

  function out(sz: Sizing | null = null): RiskDecision {
    const decision: RiskDecisionKind = deny.length ? 'DENY' : review.length ? 'NEEDS_REVIEW' : 'ALLOW';
    return { decision, reasonCodes: [...deny, ...review], evaluated: ev, sizing: sz, policyVersion: pv!.version, ts: iso(nowTs), traceId: p.traceId };
  }
}
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
