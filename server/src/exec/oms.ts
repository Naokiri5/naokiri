import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, iso } from '../core/util.js';
import { market } from '../market/store.js';
import { bookAge, bookFreshForExecution, walkBook, QUALITY_LIMITS } from '../market/quality.js';
import { evaluateRisk } from '../risk/gate.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';
import { ledger, cashBalance, accountState, openPositions, PAPER_ACCOUNT, type PositionRow } from '../portfolio/ledger.js';
import { journal } from '../journal/journal.js';
import { notify } from '../notify/notify.js';
import { bus } from '../core/bus.js';
import { audit } from '../core/audit.js';
import { getControl, updateControl } from '../core/mode.js';
import { stepExit, newExitState, type ExitState } from '../lab/exits.js';
import { record } from '../core/latency.js';
import type { DecisionReport } from '../decision/engine.js';
import { reportUnprotected, markRecovered, sweepClosedPositions } from './incidents.js';
import { crashpoint } from './crashpoint.js';

/**
 * Paper OMS (Part 26 / 32.6). Fills are simulated by walking the LIVE Binance order book
 * (real spread + depth), with configured fees. Venue = 'binance-paper'. No live venue exists.
 */
export const VENUE = 'binance-paper';
const feeRate = () => (currentPolicy()?.policy ?? DEFAULT_POLICY).feeRate;

export class OmsError extends Error {}
class EntryStateChanged extends Error {}

function insertOrder(o: { clientOrderId: string; instrument: string; side: 'BUY' | 'SELL'; type: string; qty: number; limit?: number | null; stop?: number | null; status: string; purpose: string; positionId?: string | null; decisionId?: string | null; reject?: string | null; at?: number }) {
  const id = uid('ord'); const t = o.at ?? Date.now(); // `at`: same timestamp as the fill/ledger rows written with it
  run('INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,limit_price,stop_price,status,purpose,position_id,decision_id,reject_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, o.clientOrderId, PAPER_ACCOUNT, VENUE, o.instrument, o.side, o.type, o.qty, o.limit ?? null, o.stop ?? null, o.status, o.purpose, o.positionId ?? null, o.decisionId ?? null, o.reject ?? null, t, t);
  return id;
}

export interface SimFill { price: number; impactBps: number; spreadBps: number | null; bookAgeMs: number | null; quoteAgeMs: number; basis: 'BOOK' | 'BOOK_PARTIAL' | 'QUOTE_BUFFERED' }
type Deferred = (() => void)[];
const floorStep = (q: number, step: number) => (step > 0 ? Number((Math.floor(q / step + 1e-9) * step).toFixed(12)) : q);

/** A quote is usable only when its age is finite, non-negative (not future-dated) and within the execution limit. */
export const quoteAgeOk = (ts: number | undefined, nowTs: number) => { const age = nowTs - Number(ts); return Number.isFinite(age) && age >= 0 && age <= QUALITY_LIMITS.maxExecQuoteAgeMs; };
/** Freshest top-of-book quote for a side; null when missing, non-finite or older than the execution limit. */
function execQuote(instrumentId: string, side: 'BUY' | 'SELL', nowTs: number) {
  const px = market.price(instrumentId); if (!px) return null;
  const ref = side === 'BUY' ? px.ask || px.price : px.bid || px.price;
  const quoteAgeMs = nowTs - px.ts;
  // Fail closed on non-finite or future-dated quotes (negative age), not only stale ones.
  if (!Number.isFinite(ref) || !(ref > 0) || !quoteAgeOk(px.ts, nowTs)) return null;
  return { ref, quoteAgeMs };
}

/**
 * Entry fill: all-or-none against a book no older than QUALITY_LIMITS.maxExecBookAgeMs. The depth walk gives the
 * slippage; the price is anchored to the freshest quote so a book that lags the ticker can never produce a fill
 * better than the current ask.
 */
function simulateEntryFill(instrumentId: string, qty: number, nowTs: number): { fill?: SimFill; reason?: string } {
  const q = execQuote(instrumentId, 'BUY', nowTs);
  if (!q) return { reason: 'NO_FRESH_QUOTE: no price newer than the execution limit' };
  const book = market.deep.get(instrumentId)?.book ?? null; const age = bookAge(book, nowTs);
  if (age == null) return { reason: 'NO_EXECUTABLE_BOOK: order book unavailable' };
  if (age > QUALITY_LIMITS.maxExecBookAgeMs) return { reason: `ORDER_BOOK_STALE: book is ${Math.round(age / 1000)}s old (limit ${Math.round(QUALITY_LIMITS.maxExecBookAgeMs / 1000)}s)` };
  const w = walkBook(book, 'buy', qty);
  if (!w || !w.filledFully) return { reason: 'NO_EXECUTABLE_BOOK: visible depth cannot absorb the order' };
  return { fill: { price: q.ref * (1 + w.slipFrac), impactBps: w.impactBps, spreadBps: w.spreadBps, bookAgeMs: age, quoteAgeMs: q.quoteAgeMs, basis: 'BOOK' } };
}

/**
 * Exit fill. A protective exit must complete, so it never returns "no fill" while a fresh quote exists:
 *  - fresh book that absorbs the size  → depth walk, anchored to the freshest bid;
 *  - fresh book too thin               → absorbed part at its walk price, the rest below the worst visible level;
 *  - book missing or stale             → freshest bid minus the policy's conservative stop-fill buffer.
 * A stale book is never walked: it would price the exit at levels that no longer exist.
 */
/**
 * `consumedQty` is depth already taken by earlier exits in the same pass: this fill is priced from the levels BELOW
 * it (marginal cost of walking consumed+qty minus consumed), so two exits never both fill against the same bids.
 */
function simulateExitFill(instrumentId: string, qty: number, bufferPct: number, nowTs: number, consumedQty = 0): SimFill | null {
  const q = execQuote(instrumentId, 'SELL', nowTs); if (!q) return null;
  const book = market.deep.get(instrumentId)?.book ?? null; const age = bookAge(book, nowTs);
  const haircut = 1 - Math.max(0, bufferPct) / 100;
  if (consumedQty > 0) {
    const all = bookFreshForExecution(book, nowTs) ? walkBook(book, 'sell', consumedQty + qty) : null;
    const prev = all ? walkBook(book, 'sell', consumedQty) : null;
    if (!all?.filledFully || !prev?.filledFully) return { price: q.ref * haircut, impactBps: (1 - haircut) * 1e4, spreadBps: null, bookAgeMs: age, quoteAgeMs: q.quoteAgeMs, basis: 'QUOTE_BUFFERED' };
    const marginal = (all.avgPrice * (consumedQty + qty) - prev.avgPrice * consumedQty) / qty; const slip = Math.max(0, (all.best - marginal) / all.best);
    return { price: q.ref * (1 - slip), impactBps: ((all.mid - marginal) / all.mid) * 1e4, spreadBps: all.spreadBps, bookAgeMs: age, quoteAgeMs: q.quoteAgeMs, basis: 'BOOK' };
  }
  const w = bookFreshForExecution(book, nowTs) ? walkBook(book, 'sell', qty) : null;
  if (w?.filledFully) return { price: q.ref * (1 - w.slipFrac), impactBps: w.impactBps, spreadBps: w.spreadBps, bookAgeMs: age, quoteAgeMs: q.quoteAgeMs, basis: 'BOOK' };
  if (w) {
    const absorbed = q.ref * (1 - w.slipFrac), rest = q.ref * (w.worst / w.best) * haircut;
    const price = (absorbed * w.filledQty + rest * (qty - w.filledQty)) / qty;
    return { price, impactBps: ((q.ref - price) / q.ref) * 1e4, spreadBps: w.spreadBps, bookAgeMs: age, quoteAgeMs: q.quoteAgeMs, basis: 'BOOK_PARTIAL' };
  }
  return { price: q.ref * haircut, impactBps: (1 - haircut) * 1e4, spreadBps: null, bookAgeMs: age, quoteAgeMs: q.quoteAgeMs, basis: 'QUOTE_BUFFERED' };
}

/** Entry submission with Part 29 L5 last-moment validation. */
export function submitEntry(report: DecisionReport, actor: 'bot' | 'owner', executionTs?: number): { ok: boolean; orderId?: string; positionId?: string; reason?: string } {
  const t0 = performance.now();
  const s = report;
  const coid = `entry-${report.candidateId}`;
  const existing = get<any>('SELECT * FROM orders WHERE client_order_id=?', coid);
  if (existing && existing.status !== 'PENDING_APPROVAL') return { ok: false, reason: `DUPLICATE: order ${existing.id} already ${existing.status}` };
  const ctl = getControl();
  if (actor === 'bot' && report.decision !== 'PAPER_TRADE') return { ok: false, reason: `decision ${report.decision} does not permit automatic entry` };
  if (actor === 'bot' && ctl.mode !== 'PAPER') return { ok: false, reason: `mode ${ctl.mode} does not permit automatic paper entries` };
  const outcome = (() => {
    crashpoint('entry.preTx');
    try { return tx(() => {
      // Check current order state and run the canonical risk gate under the same SQLite write lock as the fill.
      const current = get<{ id: string; status: string }>('SELECT id,status FROM orders WHERE client_order_id=?', coid);
      if (existing && (!current || current.id !== existing.id || current.status !== 'PENDING_APPROVAL')) {
        throw new EntryStateChanged();
      }
      if (!existing && current) return { conflict: `DUPLICATE: order ${current.id} already ${current.status}` };
      const authority = getControl();
      if (actor === 'bot' && authority.mode !== 'PAPER') return { reason: 'LAST_MOMENT_MODE_CHANGED: automatic entry requires PAPER mode' };
      const nowTs = executionTs ?? Date.now();
      const expiresAt = Date.parse(report.consensus.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= nowTs) return { reason: 'CONSENSUS_EXPIRED: re-evaluate from fresh data' };
      // Last-moment revalidation: fresh risk evaluation on current data
      const proposal = { instrumentId: s.instrumentId, strategyId: s.strategy.id, side: 'buy' as const, entryPrice: s.entryRef, stopPrice: s.stopLoss, idempotencyKey: coid, traceId: s.traceId };
      const fresh = evaluateRisk(proposal, nowTs);
      const allowed = fresh.decision === 'ALLOW' || (fresh.decision === 'NEEDS_REVIEW' && actor === 'owner');
      if (!allowed || !fresh.sizing) return { reason: `LAST_MOMENT_RISK_${fresh.decision}: ${fresh.reasonCodes.join('; ')}` };
      const qty = fresh.sizing.qty;
      const sim = simulateEntryFill(s.instrumentId, qty, nowTs);
      if (!sim.fill) return { reason: sim.reason! };
      const fill = sim.fill;
      const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
      if (fill.impactBps > pol.maxSlippageBps) return { reason: `SLIPPAGE ${fill.impactBps.toFixed(1)}bps at submission` };
      if (fill.price <= s.stopLoss) return { reason: 'PRICE_THROUGH_STOP' };
      if (s.takeProfit.some((t) => t.price <= fill.price)) return { reason: 'PRICE_THROUGH_TARGET: fill would be at or above a take-profit level' };
      const notional = fill.price * qty;
      if (!Number.isFinite(notional) || notional > fresh.sizing.maxNotional + 1e-9) {
        return { reason: `POSITION_NOTIONAL_LIMIT: fill ${notional.toFixed(2)}, limit ${fresh.sizing.maxNotional.toFixed(2)}` };
      }
      // The canonical risk gate sized against a conservative entry. Defend that invariant again
      // using the actual depth-walk fill before writing any order, position or financial ledger row.
      const worstStopFill = fresh.sizing.conservativeStopFill;
      const actualPlannedMaxLoss = qty * (fill.price - worstStopFill + pol.feeRate * (fill.price + worstStopFill));
      if (!Number.isFinite(actualPlannedMaxLoss) || actualPlannedMaxLoss <= 0 ||
          actualPlannedMaxLoss > fresh.sizing.riskBudget + 1e-9) {
        return { reason: 'EXECUTED_TRADE_RISK_LIMIT: depth-walk fill exceeds the per-trade loss budget' };
      }
      const account = accountState(PAPER_ACCOUNT, nowTs);
      const aggregateRiskLimit = account.equity * (pol.maxOpenRiskPct / 100);
      if (!Number.isFinite(aggregateRiskLimit) ||
          account.openRiskUsd + actualPlannedMaxLoss > aggregateRiskLimit + 1e-9) {
        return { reason: 'EXECUTED_AGGREGATE_RISK_LIMIT: depth-walk fill exceeds the account risk budget' };
      }
      const fee = notional * pol.feeRate;
      const R = fill.price - s.stopLoss;
      const tgts = s.takeProfit.map((t) => ({ r: (t.price - fill.price) / R, fraction: t.fraction }));
      const st = newExitState(fill.price, s.stopLoss, qty, tgts, null, 0);
      const posId = uid('pos');
      const strat = s.strategy.id;
      const maxHoldMs = (strat === 'range_reversion' ? 24 : strat === 'trend_pullback' ? 48 : 72) * 3600_000;
      const trailAfterR = strat === 'trend_pullback' ? 1 : strat === 'donchian_breakout' ? 1.5 : null;
      const cash = cashBalance(PAPER_ACCOUNT);
      const total = notional + fee;
      if (!Number.isFinite(total) || total > cash + 1e-9) {
        return { reason: `INSUFFICIENT_CASH: need ${total.toFixed(2)}, have ${cash.toFixed(2)}` };
      }
      const oid = existing ? existing.id : insertOrder({ clientOrderId: coid, instrument: s.instrumentId, side: 'BUY', type: 'MARKET', qty, status: 'NEW', purpose: 'ENTRY', decisionId: s.id });
      run("UPDATE orders SET status='FILLED', qty=?, filled_qty=?, avg_price=?, fees=?, position_id=?, updated_at=? WHERE id=?", qty, qty, fill.price, fee, posId, Date.now(), oid);
      crashpoint('entry.order');
      run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', uid('fil'), oid, qty, fill.price, fee, 'TAKER', Date.now());
      crashpoint('entry.fill');
      run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,max_hold_ms,decision_id,planned_risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        posId, PAPER_ACCOUNT, s.instrumentId, s.market, 'LONG', strat, qty, fill.price, s.stopLoss, s.stopLoss, J({ qtyInit: qty, trailAfterR, targets: st.targets, lastPx: fill.price }), 'OPEN', Date.now(), -fee, fee, maxHoldMs, s.id, actualPlannedMaxLoss);
      crashpoint('entry.position');
      // Protective stop: paper venue has no exchange-native stop; OMS monitors it. Recorded explicitly.
      insertOrder({ clientOrderId: `stop-${posId}`, instrument: s.instrumentId, side: 'SELL', type: 'STOP_MARKET (OMS-monitored, paper)', qty, stop: s.stopLoss, status: 'ACTIVE', purpose: 'PROTECTIVE_STOP', positionId: posId });
      crashpoint('entry.stop');
      ledger(PAPER_ACCOUNT, 'BUY', -notional, oid, `${s.asset} entry`); crashpoint('entry.buy'); ledger(PAPER_ACCOUNT, 'FEE', -fee, oid, 'entry fee');
      crashpoint('entry.precommit');
      return { orderId: oid, posId, qty, fill, fee, fresh, strat, plannedMaxLoss: actualPlannedMaxLoss };
    }); } catch (e: any) {
      if (e instanceof EntryStateChanged) return { conflict: 'ORDER_STATE_CHANGED: entry order changed before submission' };
      // UNIQUE(client_order_id) is the last line of defence against a concurrent duplicate submission.
      if (/UNIQUE|constraint/i.test(String(e?.message))) return { conflict: `DUPLICATE: entry ${coid} was already submitted` };
      throw e;
    }
  })();
  if ('conflict' in outcome) return { ok: false, reason: outcome.conflict };
  if (outcome.reason !== undefined) return reject(outcome.reason);
  const { orderId, posId, qty, fill, fee, fresh, strat, plannedMaxLoss } = outcome;
  crashpoint('entry.committed');
  record('oms.submit', performance.now() - t0);
  journal('FILL', `BUY ${qty} ${s.asset} @ ${fill.price.toPrecision(6)} (${strat}) — stop ${s.stopLoss.toPrecision(6)}, slippage ${fill.impactBps.toFixed(1)}bps`, posId, { decisionId: s.id, fill, fee, risk: fresh, actor });
  notify('INFO', `Paper entry: ${s.asset}`, `${qty} @ ${fill.price.toPrecision(6)}, stop ${s.stopLoss.toPrecision(6)}, planned max loss $${plannedMaxLoss}`, 'oms');
  bus.publish('order', { orderId, positionId: posId, status: 'FILLED' }); bus.publish('position', { positionId: posId });
  return { ok: true, orderId, positionId: posId };

  function reject(reason: string) {
    if (existing) {
      const changed = run("UPDATE orders SET status='REJECTED', reject_reason=?, updated_at=? WHERE id=? AND status='PENDING_APPROVAL'", reason, Date.now(), existing.id);
      if (Number(changed.changes) !== 1) return { ok: false, reason: 'ORDER_STATE_CHANGED: entry is no longer pending approval' };
    } else {
      const inserted = tx(() => {
        if (get('SELECT 1 FROM orders WHERE client_order_id=?', coid)) return false;
        insertOrder({ clientOrderId: coid, instrument: s.instrumentId, side: 'BUY', type: 'MARKET', qty: 0, status: 'REJECTED', purpose: 'ENTRY', decisionId: s.id, reject: reason });
        return true;
      });
      if (!inserted) return { ok: false, reason: 'ORDER_STATE_CHANGED: entry order changed before rejection' };
    }
    journal('ORDER', `Entry rejected for ${s.asset}: ${reason}`, s.id);
    bus.publish('order', { status: 'REJECTED', reason });
    return { ok: false, reason };
  }
}

/** APPROVAL mode: queue a pending order for the owner. */
export function queueForApproval(report: DecisionReport) {
  const coid = `entry-${report.candidateId}`;
  if (get('SELECT 1 FROM orders WHERE client_order_id=?', coid)) return null;
  const id = insertOrder({ clientOrderId: coid, instrument: report.instrumentId, side: 'BUY', type: 'MARKET', qty: report.positionSize?.qty ?? 0, stop: report.stopLoss, status: 'PENDING_APPROVAL', purpose: 'ENTRY', decisionId: report.id });
  notify('WARNING', `Approval requested: ${report.asset}`, `${report.strategy.id} · score ${report.opportunity.score} · expires ${report.consensus.expiresAt}`, 'oms');
  bus.publish('order', { orderId: id, status: 'PENDING_APPROVAL' });
  return id;
}
export function decideApproval(orderId: string, approve: boolean) {
  const o = get<any>('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.status !== 'PENDING_APPROVAL') throw new OmsError('order is not pending approval');
  audit('owner', approve ? 'order.approve' : 'order.reject', { orderId });
  if (!approve) {
    const changed = run("UPDATE orders SET status='CANCELLED', reject_reason='rejected by owner', updated_at=? WHERE id=? AND status='PENDING_APPROVAL'", Date.now(), orderId);
    if (Number(changed.changes) !== 1) return { ok: false, reason: 'ORDER_STATE_CHANGED: entry is no longer pending approval' };
    journal('INTERVENTION', `Owner rejected entry ${o.instrument}`, orderId);
    return { ok: true };
  }
  const rep = get<any>('SELECT report FROM decisions WHERE id=?', o.decision_id);
  if (!rep) throw new OmsError('decision record missing');
  return submitEntry(P(rep.report), 'owner');
}
export function expireApprovals() {
  for (const o of all<any>("SELECT o.id, d.report FROM orders o JOIN decisions d ON d.id=o.decision_id WHERE o.status='PENDING_APPROVAL'")) {
    const r = P<DecisionReport>(o.report);
    if (Date.parse(r.consensus.expiresAt) <= Date.now()) run("UPDATE orders SET status='EXPIRED', reject_reason='consensus validity window elapsed', updated_at=? WHERE id=? AND status='PENDING_APPROVAL'", Date.now(), o.id);
  }
}

class ExitUnavailable extends Error {}
/** Another writer changed the position after this pass read it; the pass is skipped and re-evaluated next tick. */
class StaleSnapshot extends Error {}
/**
 * Position monitoring (Part 17.4/26.4). Uses the shared exit capsule on successive bid snapshots. The exit state
 * (targets hit, trailed stop) and the fills it implies are committed in ONE transaction: if any fill cannot be
 * executed nothing is persisted, so a target is never marked done without its quantity being sold.
 */
export function monitorPositions(nowTs = Date.now()) {
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  sweepClosedPositions(nowTs);
  for (const p of openPositions()) {
    const px = market.price(p.instrument);
    if (!px || !quoteAgeOk(px.ts, nowTs)) { flagUnprotected(p, 'stale, future-dated or missing price — stop cannot be evaluated'); continue; }
    const meta = P<any>(p.targets);
    const st: ExitState = { entry: p.entry_price, stop: p.stop_price, initialStop: p.initial_stop, qtyLeft: p.qty, qtyInit: meta.qtyInit, targets: meta.targets, trailAfterR: meta.trailAfterR, barsHeld: 0, maxHoldBars: Infinity, mfe: p.mfe, mae: p.mae };
    const last = meta.lastPx ?? p.entry_price; const bid = px.bid || px.price;
    const doneBefore = (meta.targets as { done: boolean }[]).map((t) => t.done);
    const fills = stepExit(st, { o: last, h: Math.max(last, bid), l: Math.min(last, bid), c: bid }, 0, false);
    if (st.qtyLeft > 1e-12 && p.max_hold_ms && nowTs - p.opened_at >= p.max_hold_ms) { fills.push({ reason: 'TIME', price: bid, qty: st.qtyLeft }); st.qtyLeft = 0; }
    meta.targets = st.targets; meta.lastPx = bid;
    const after: Deferred = [];
    try {
      // Each applyExit walks the same book snapshot, so check that the book absorbs the COMBINED exit size first;
      // otherwise two targets hit in one pass could each "fill" against depth that exists only once.
      const exitQty = fills.reduce((sum, f) => sum + f.qty, 0);
      if (exitQty > 0) {
        const book = market.deep.get(p.instrument)?.book ?? null;
        if (!bookFreshForExecution(book, nowTs) || !walkBook(book!, 'sell', Math.min(exitQty, p.qty))?.filledFully) throw new ExitUnavailable();
      }
      crashpoint('monitor.preTx');
      tx(() => {
        // Compare-and-set against the snapshot the exits were computed from, so a concurrent monitor or manual close cannot
        // make this pass sell the same target twice or act on a position that is no longer open.
        const cas = run("UPDATE positions SET stop_price=?, targets=?, mfe=?, mae=? WHERE id=? AND status='OPEN' AND qty=? AND stop_price=? AND targets=?", st.stop, J(meta), st.mfe, st.mae, p.id, p.qty, p.stop_price, p.targets);
        if (Number(cas.changes) !== 1) throw new StaleSnapshot();
        crashpoint('monitor.state');
        if (st.stop !== p.stop_price) { run("UPDATE orders SET stop_price=?, updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", st.stop, nowTs, p.id); crashpoint('monitor.stop'); journal('EXIT', `${p.instrument} stop tightened to ${st.stop.toPrecision(6)} (breakeven trail)`, p.id); }
        let consumed = 0; // depth already taken by earlier exits in this pass
        // stepExit (shared with the backtester) marks a target done before lot rounding; a target whose slice rounds to
        // zero sold nothing, so it is reopened here and stays eligible on later passes.
        const newlyDone = st.targets.map((t, i) => (t.done && !doneBefore[i] ? i : -1)).filter((i) => i >= 0); let k = 0; let reopened = false;
        for (const f of fills) {
          const r = applyExit(p.id, f.qty, f.reason, pol.feeRate, nowTs, after, consumed); if (!r) throw new ExitUnavailable(); consumed += r.qty;
          if (f.reason === 'TARGET') { const idx = newlyDone[k++]; if (r.qty === 0 && idx != null) { meta.targets[idx].done = false; reopened = true; } }
        }
        if (reopened) run('UPDATE positions SET targets=? WHERE id=?', J(meta), p.id);
        crashpoint('monitor.precommit');
      });
      crashpoint('monitor.committed');
      after.forEach((fn) => fn());
      // Recovery needs more than a fresh ticker: a fresh book must be able to absorb what is still open.
      const left = get<{ qty: number; status: string }>('SELECT qty, status FROM positions WHERE id=?', p.id);
      const book = market.deep.get(p.instrument)?.book ?? null;
      if (left?.status !== 'OPEN' || (bookFreshForExecution(book, nowTs) && walkBook(book!, 'sell', left.qty)?.filledFully)) markRecovered(p.id, nowTs);
      else flagUnprotected(p, 'order book missing, stale or too thin to execute the stop');
    } catch (e: any) {
      if (e instanceof StaleSnapshot) continue;
      flagUnprotected(p, e instanceof ExitUnavailable ? 'no fresh executable price for exit' : `exit failed: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }
}
/** Persistent, de-duplicated protection incident (survives restarts; see exec/incidents.ts). */
function flagUnprotected(p: PositionRow, why: string) { reportUnprotected(p, why); }

/**
 * Apply one exit fill. MUST run inside tx(): it re-reads the position there, so the quantity it sells is the
 * quantity that is actually still open. Returns null when the position is not open or no fresh price exists.
 * Order/fill/ledger/position rows are written together; journal, autopsy and bus events are deferred to `after`
 * so nothing is announced for a transaction that rolls back.
 */
function applyExit(positionId: string, wantQty: number, reason: string, fr: number, nowTs: number, after: Deferred, consumedQty = 0) {
  const p = get<PositionRow>('SELECT * FROM positions WHERE id=?', positionId);
  if (!p || p.status !== 'OPEN' || !(p.qty > 0)) return null;
  const inst = market.instruments.get(p.instrument); const step = inst?.stepSize ?? 0;
  let qty = floorStep(Math.min(wantQty, p.qty), step);
  let remaining = Number((p.qty - qty).toFixed(12));
  // A remainder smaller than one lot (or the venue minimum) could never be sold later: close it with this fill.
  if (remaining < Math.max(step, inst?.minQty ?? 0, 1e-12) - 1e-12) { qty = p.qty; remaining = 0; }
  if (!(qty > 0)) return { price: 0, pnl: 0, closed: false, qty: 0 }; // slice below one lot: nothing to sell yet
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  const fill = simulateExitFill(p.instrument, qty, pol.stopFillBufferPct, nowTs, consumedQty);
  if (!fill) return null;
  // Project invariant (CLAUDE.md #4, PR #4): never invent a fill from a ticker fallback. Every exit — protective or
  // not — is booked only against a fresh book that absorbs the full size. Otherwise the position stays open and
  // executeExit() raises the protection alert; the data-quality gate then blocks new entries until data recovers.
  if (fill.basis !== 'BOOK') return null;
  const px = fill.price; const fee = px * qty * fr; const pnl = (px - p.entry_price) * qty - fee; const closed = remaining === 0;
  const seq = get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE position_id=? AND purpose LIKE 'EXIT_%'", positionId)!.n + 1;
  // Deterministic client id: a second writer trying to record the same exit hits UNIQUE(client_order_id) and rolls back.
  const oid = insertOrder({ clientOrderId: `exit-${positionId}-${seq}`, instrument: p.instrument, side: 'SELL', type: 'MARKET', qty, status: 'FILLED', purpose: `EXIT_${reason}`, positionId, at: nowTs });
  run('UPDATE orders SET filled_qty=?, avg_price=?, fees=? WHERE id=?', qty, px, fee, oid);
  crashpoint('exit.order');
  run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', uid('fil'), oid, qty, px, fee, 'TAKER', nowTs);
  crashpoint('exit.fill');
  ledger(PAPER_ACCOUNT, 'SELL', px * qty, oid, `${p.instrument} exit ${reason}`, nowTs); crashpoint('exit.sell'); ledger(PAPER_ACCOUNT, 'FEE', -fee, oid, 'exit fee', nowTs);
  run('UPDATE positions SET qty=?, realized_pnl=realized_pnl+?, fees=fees+?, status=?, closed_at=?, exit_price=?, exit_reason=? WHERE id=?',
    remaining, pnl, fee, closed ? 'CLOSED' : 'OPEN', closed ? nowTs : null, closed ? px : null, closed ? reason : null, positionId);
  crashpoint('exit.position');
  if (closed) run("UPDATE orders SET status='CANCELLED', updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", nowTs, positionId);
  else run("UPDATE orders SET qty=?, updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", remaining, nowTs, positionId);
  crashpoint('exit.stop');
  after.push(() => {
    journal('EXIT', `SELL ${qty} ${p.instrument.split(':')[2]} @ ${px.toPrecision(6)} — ${reason}, PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${fill.basis === 'BOOK' ? '' : ` [${fill.basis}]`}`, positionId, { fill, fee, reason });
    if (closed) autopsy(positionId);
    bus.publish('position', { positionId, closed });
  });
  return { price: px, pnl, closed, qty };
}

export function executeExit(positionId: string, qty: number, reason: string, fr = feeRate(), nowTs = Date.now()) {
  const after: Deferred = [];
  crashpoint('exit.preTx');
  const r = tx(() => { const e = applyExit(positionId, qty, reason, fr, nowTs, after); crashpoint('exit.precommit'); return e; });
  crashpoint('exit.committed');
  if (r) after.forEach((fn) => fn());
  else { const p = get<PositionRow>('SELECT * FROM positions WHERE id=?', positionId); if (p?.status === 'OPEN') flagUnprotected(p, 'no fresh executable price for exit'); }
  return r;
}

/** Part 20.4 deterministic trade autopsy. */
export function autopsy(positionId: string) {
  const p = get<PositionRow>('SELECT * FROM positions WHERE id=?', positionId)!;
  const dec = p.decision_id ? P<DecisionReport>(get<any>('SELECT report FROM decisions WHERE id=?', p.decision_id)?.report) : null;
  const r = p.planned_risk > 0 ? p.realized_pnl / p.planned_risk : 0;
  const findings = [
    `Result ${p.realized_pnl >= 0 ? '+' : ''}${p.realized_pnl.toFixed(2)} USDT (${r.toFixed(2)}R vs planned risk $${p.planned_risk.toFixed(2)})`,
    `Exit: ${p.exit_reason}; held ${((p.closed_at! - p.opened_at) / 3600_000).toFixed(1)}h`,
    `Max favorable excursion ${p.mfe.toFixed(2)}R, max adverse ${p.mae.toFixed(2)}R`,
    p.exit_reason === 'STOP' && p.mfe >= 1 ? 'Trade reached ≥1R before stopping out — review trailing rule.' : '',
    p.exit_reason === 'STOP' && r < -1.15 ? 'Loss exceeded 1R: stop slippage/gap beyond conservative buffer.' : '',
    p.exit_reason === 'TIME' ? 'Thesis did not develop within its validated horizon (time stop).' : '',
    `Fees paid $${p.fees.toFixed(2)}`,
    dec ? `Entry decision: score ${dec.opportunity.score}, QCI ${dec.consensus.state} (support ${dec.consensus.support}, opposition ${dec.consensus.opposition}), regime ${dec.regime}` : 'decision record unavailable',
    'Single outcomes do not change strategy parameters (Part 26.3 #21).',
  ].filter(Boolean);
  journal('AUTOPSY', `${p.instrument.split(':')[2]} ${p.strategy}: ${r.toFixed(2)}R (${p.exit_reason})`, positionId, { findings, r });
  notify(p.realized_pnl >= 0 ? 'INFO' : 'WARNING', `Paper position closed: ${p.instrument.split(':')[2]}`, findings[0], 'oms');
}

// ── Part 17.8 emergency semantics — distinct actions with distinct reported states ──
export function pauseNewOrders(actor: string) { updateControl(actor, { pausedNewOrders: true }); journal('INTERVENTION', `New orders paused by ${actor}`); return { state: 'CONFIRMED' }; }
export function cancelPendingEntries(actor: string) {
  const r = run("UPDATE orders SET status='CANCELLED', reject_reason=?, updated_at=? WHERE purpose='ENTRY' AND status IN ('NEW','PENDING_APPROVAL')", `cancelled by ${actor}`, Date.now());
  audit(actor, 'orders.cancelPendingEntries', { count: Number(r.changes) }); journal('INTERVENTION', `${r.changes} pending entries cancelled by ${actor}`);
  return { state: 'CONFIRMED', cancelled: Number(r.changes) };
}
export function protectPositions(log = false) {
  const res = openPositions().map((p) => {
    const stop = get<any>("SELECT * FROM orders WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", p.id);
    const px = market.price(p.instrument);
    const now = Date.now(); const book = market.deep.get(p.instrument)?.book ?? null;
    const stopOk = !!stop && Math.abs(stop.qty - p.qty) < 1e-9 && stop.stop_price === p.stop_price;
    const priceOk = !!px && quoteAgeOk(px.ts, now);
    // Same executability rule as applyExit: a stop is only "protected" if a fresh book can absorb the full exit.
    const depthOk = bookFreshForExecution(book, now) && !!walkBook(book!, 'sell', p.qty)?.filledFully;
    const ok = stopOk && priceOk && depthOk;
    const issue = ok ? null : !stop ? 'no active protective stop' : !stopOk ? 'stop/qty mismatch' : !px ? 'no price' : !priceOk ? 'stale or future-dated price' : 'order book missing, stale or too thin to execute the stop';
    return { positionId: p.id, instrument: p.instrument, protected: ok, stop: p.stop_price, qty: p.qty, issue };
  });
  if (log) journal('RISK', `Protection reconciliation: ${res.filter((r) => r.protected).length}/${res.length} verified`);
  return { state: res.every((r) => r.protected) ? 'CONFIRMED' : 'PARTIALLY_COMPLETED', positions: res };
}
export function closeAllPositions(actor: string, confirm: string) {
  if (actor !== 'owner') throw new OmsError('only the owner may close positions');
  if (confirm !== 'CLOSE ALL') throw new OmsError('confirmation phrase required: CLOSE ALL');
  audit(actor, 'positions.closeAll');
  const results = openPositions().map((p) => ({ positionId: p.id, result: executeExit(p.id, p.qty, 'MANUAL_CLOSE') }));
  return { state: results.every((r) => r.result?.closed) ? 'CONFIRMED' : results.some((r) => r.result) ? 'PARTIALLY_COMPLETED' : results.length ? 'FAILED' : 'CONFIRMED', results };
}
export function closePosition(actor: string, positionId: string) {
  if (actor !== 'owner') throw new OmsError('only the owner may close positions');
  audit(actor, 'position.close', { positionId });
  const r = executeExit(positionId, Infinity, 'MANUAL_CLOSE');
  if (!r) throw new OmsError('position not open or no fresh executable price');
  journal('INTERVENTION', `Owner closed position ${positionId}`, positionId);
  return r;
}
export function emergencyStop(actor: string) {
  updateControl(actor, { emergency: true, pausedNewOrders: true });
  const c = cancelPendingEntries(actor); const p = protectPositions(true);
  notify('CRITICAL', 'EMERGENCY STOP engaged', `new orders blocked, ${c.cancelled} pending entries cancelled, protection ${p.state}. Positions NOT auto-closed (policy).`, 'risk');
  return { pause: 'CONFIRMED', cancel: c, protect: p, close: 'NOT_REQUESTED' };
}
export const listOrders = (limit = 200) => all('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?', limit);
export const listPositions = (status?: string) => (status ? all<PositionRow>('SELECT * FROM positions WHERE status=? ORDER BY opened_at DESC', status) : all<PositionRow>('SELECT * FROM positions ORDER BY opened_at DESC LIMIT 500')).map((p) => ({ ...p, targets: P(p.targets), mark: market.price(p.instrument)?.price ?? null }));
export { iso };
