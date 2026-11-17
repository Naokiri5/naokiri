import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, iso } from '../core/util.js';
import { market } from '../market/store.js';
import { bookAge, bookFreshForExecution, walkBook, QUALITY_LIMITS } from '../market/quality.js';
import { evaluateRisk } from '../risk/gate.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';
import { ledger, cashBalance, openPositions, PAPER_ACCOUNT, type PositionRow } from '../portfolio/ledger.js';
import { journal } from '../journal/journal.js';
import { notify } from '../notify/notify.js';
import { bus } from '../core/bus.js';
import { audit } from '../core/audit.js';
import { getControl, updateControl } from '../core/mode.js';
import { stepExit, newExitState, type ExitState } from '../lab/exits.js';
import { record } from '../core/latency.js';
import type { DecisionReport } from '../decision/engine.js';

/**
 * Paper OMS (Part 26 / 32.6). Fills are simulated by walking the LIVE Binance order book
 * (real spread + depth), with configured fees. Venue = 'binance-paper'. No live venue exists.
 */
export const VENUE = 'binance-paper';
const feeRate = () => (currentPolicy()?.policy ?? DEFAULT_POLICY).feeRate;

export class OmsError extends Error {}

function insertOrder(o: { clientOrderId: string; instrument: string; side: 'BUY' | 'SELL'; type: string; qty: number; limit?: number | null; stop?: number | null; status: string; purpose: string; positionId?: string | null; decisionId?: string | null; reject?: string | null }) {
  const id = uid('ord'); const t = Date.now();
  run('INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,limit_price,stop_price,status,purpose,position_id,decision_id,reject_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, o.clientOrderId, PAPER_ACCOUNT, VENUE, o.instrument, o.side, o.type, o.qty, o.limit ?? null, o.stop ?? null, o.status, o.purpose, o.positionId ?? null, o.decisionId ?? null, o.reject ?? null, t, t);
  return id;
}

export interface SimFill { price: number; impactBps: number; spreadBps: number | null; bookAgeMs: number | null; quoteAgeMs: number; basis: 'BOOK' | 'BOOK_PARTIAL' | 'QUOTE_BUFFERED' }
type Deferred = (() => void)[];
const floorStep = (q: number, step: number) => (step > 0 ? Number((Math.floor(q / step + 1e-9) * step).toFixed(12)) : q);

/** Freshest top-of-book quote for a side; null when missing, non-finite or older than the execution limit. */
function execQuote(instrumentId: string, side: 'BUY' | 'SELL', nowTs: number) {
  const px = market.price(instrumentId); if (!px) return null;
  const ref = side === 'BUY' ? px.ask || px.price : px.bid || px.price;
  const quoteAgeMs = nowTs - px.ts;
  if (!Number.isFinite(ref) || !(ref > 0) || quoteAgeMs > QUALITY_LIMITS.maxExecQuoteAgeMs) return null;
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
function simulateExitFill(instrumentId: string, qty: number, bufferPct: number, nowTs: number): SimFill | null {
  const q = execQuote(instrumentId, 'SELL', nowTs); if (!q) return null;
  const book = market.deep.get(instrumentId)?.book ?? null; const age = bookAge(book, nowTs);
  const haircut = 1 - Math.max(0, bufferPct) / 100;
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
export function submitEntry(report: DecisionReport, actor: 'bot' | 'owner', nowTs = Date.now()): { ok: boolean; orderId?: string; positionId?: string; reason?: string } {
  const t0 = performance.now();
  const s = report;
  const coid = `entry-${report.candidateId}`;
  const existing = get<any>('SELECT * FROM orders WHERE client_order_id=?', coid);
  if (existing && existing.status !== 'PENDING_APPROVAL') return { ok: false, reason: `DUPLICATE: order ${existing.id} already ${existing.status}` };
  const ctl = getControl();
  if (actor === 'bot' && report.decision !== 'PAPER_TRADE') return { ok: false, reason: `decision ${report.decision} does not permit automatic entry` };
  if (actor === 'bot' && ctl.mode !== 'PAPER') return { ok: false, reason: `mode ${ctl.mode} does not permit automatic paper entries` };
  if (Date.parse(report.consensus.expiresAt) <= Date.now()) return reject('CONSENSUS_EXPIRED: re-evaluate from fresh data');
  // Last-moment revalidation: fresh risk evaluation on current data
  const fresh = evaluateRisk({ instrumentId: s.instrumentId, strategyId: s.strategy.id, side: 'buy', entryPrice: s.entryRef, stopPrice: s.stopLoss, idempotencyKey: coid, traceId: s.traceId });
  const allowed = fresh.decision === 'ALLOW' || (fresh.decision === 'NEEDS_REVIEW' && actor === 'owner');
  if (!allowed || !fresh.sizing) return reject(`LAST_MOMENT_RISK_${fresh.decision}: ${fresh.reasonCodes.join('; ')}`);
  const qty = fresh.sizing.qty;
  const sim = simulateEntryFill(s.instrumentId, qty, nowTs);
  if (!sim.fill) return reject(sim.reason!);
  const fill = sim.fill;
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  if (fill.impactBps > pol.maxSlippageBps) return reject(`SLIPPAGE ${fill.impactBps.toFixed(1)}bps at submission`);
  if (fill.price <= s.stopLoss) return reject('PRICE_THROUGH_STOP');
  if (s.takeProfit.some((t) => t.price <= fill.price)) return reject('PRICE_THROUGH_TARGET: fill would be at or above a take-profit level');
  const fee = fill.price * qty * pol.feeRate;
  const cash = cashBalance(PAPER_ACCOUNT);
  if (fill.price * qty + fee > cash + 1e-9) return reject(`INSUFFICIENT_CASH: need ${(fill.price * qty + fee).toFixed(2)}, have ${cash.toFixed(2)}`);
  const R = fill.price - s.stopLoss;
  const tgts = s.takeProfit.map((t) => ({ r: (t.price - fill.price) / R, fraction: t.fraction }));
  const st = newExitState(fill.price, s.stopLoss, qty, tgts, null, 0);
  const posId = uid('pos');
  const strat = s.strategy.id;
  const maxHoldMs = (strat === 'range_reversion' ? 24 : strat === 'trend_pullback' ? 48 : 72) * 3600_000;
  const trailAfterR = strat === 'trend_pullback' ? 1 : strat === 'donchian_breakout' ? 1.5 : null;
  let orderId: string;
  try { orderId = tx(() => {
    const oid = existing ? existing.id : insertOrder({ clientOrderId: coid, instrument: s.instrumentId, side: 'BUY', type: 'MARKET', qty, status: 'NEW', purpose: 'ENTRY', decisionId: s.id });
    run("UPDATE orders SET status='FILLED', qty=?, filled_qty=?, avg_price=?, fees=?, position_id=?, updated_at=? WHERE id=?", qty, qty, fill.price, fee, posId, Date.now(), oid);
    run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', uid('fil'), oid, qty, fill.price, fee, 'TAKER', Date.now());
    run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,max_hold_ms,decision_id,planned_risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      posId, PAPER_ACCOUNT, s.instrumentId, s.market, 'LONG', strat, qty, fill.price, s.stopLoss, s.stopLoss, J({ qtyInit: qty, trailAfterR, targets: st.targets, lastPx: fill.price }), 'OPEN', Date.now(), -fee, fee, maxHoldMs, s.id, qty * (fill.price - s.stopLoss * (1 - pol.stopFillBufferPct / 100)) + fee);
    // Protective stop: paper venue has no exchange-native stop; OMS monitors it. Recorded explicitly.
    insertOrder({ clientOrderId: `stop-${posId}`, instrument: s.instrumentId, side: 'SELL', type: 'STOP_MARKET (OMS-monitored, paper)', qty, stop: s.stopLoss, status: 'ACTIVE', purpose: 'PROTECTIVE_STOP', positionId: posId });
    ledger(PAPER_ACCOUNT, 'BUY', -fill.price * qty, oid, `${s.asset} entry`); ledger(PAPER_ACCOUNT, 'FEE', -fee, oid, 'entry fee');
    return oid;
  }); } catch (e: any) {
    // UNIQUE(client_order_id) is the last line of defence against a concurrent duplicate submission.
    if (/UNIQUE|constraint/i.test(String(e?.message))) return { ok: false, reason: `DUPLICATE: entry ${coid} was already submitted` };
    throw e;
  }
  record('oms.submit', performance.now() - t0);
  journal('FILL', `BUY ${qty} ${s.asset} @ ${fill.price.toPrecision(6)} (${strat}) — stop ${s.stopLoss.toPrecision(6)}, slippage ${fill.impactBps.toFixed(1)}bps`, posId, { decisionId: s.id, fill, fee, risk: fresh, actor });
  notify('INFO', `Paper entry: ${s.asset}`, `${qty} @ ${fill.price.toPrecision(6)}, stop ${s.stopLoss.toPrecision(6)}, planned max loss $${fresh.sizing.plannedMaxLoss}`, 'oms');
  bus.publish('order', { orderId, positionId: posId, status: 'FILLED' }); bus.publish('position', { positionId: posId });
  return { ok: true, orderId, positionId: posId };

  function reject(reason: string) {
    if (existing) run("UPDATE orders SET status='REJECTED', reject_reason=?, updated_at=? WHERE id=?", reason, Date.now(), existing.id);
    else insertOrder({ clientOrderId: coid, instrument: s.instrumentId, side: 'BUY', type: 'MARKET', qty: 0, status: 'REJECTED', purpose: 'ENTRY', decisionId: s.id, reject: reason });
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
  if (!approve) { run("UPDATE orders SET status='CANCELLED', reject_reason='rejected by owner', updated_at=? WHERE id=?", Date.now(), orderId); journal('INTERVENTION', `Owner rejected entry ${o.instrument}`, orderId); return { ok: true }; }
  const rep = get<any>('SELECT report FROM decisions WHERE id=?', o.decision_id);
  if (!rep) throw new OmsError('decision record missing');
  return submitEntry(P(rep.report), 'owner');
}
export function expireApprovals() {
  for (const o of all<any>("SELECT o.id, d.report FROM orders o JOIN decisions d ON d.id=o.decision_id WHERE o.status='PENDING_APPROVAL'")) {
    const r = P<DecisionReport>(o.report);
    if (Date.parse(r.consensus.expiresAt) <= Date.now()) run("UPDATE orders SET status='EXPIRED', reject_reason='consensus validity window elapsed', updated_at=? WHERE id=?", Date.now(), o.id);
  }
}

class ExitUnavailable extends Error {}
/**
 * Position monitoring (Part 17.4/26.4). Uses the shared exit capsule on successive bid snapshots. The exit state
 * (targets hit, trailed stop) and the fills it implies are committed in ONE transaction: if any fill cannot be
 * executed nothing is persisted, so a target is never marked done without its quantity being sold.
 */
export function monitorPositions(nowTs = Date.now()) {
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  for (const p of openPositions()) {
    const px = market.price(p.instrument);
    if (!px || nowTs - px.ts > QUALITY_LIMITS.maxExecQuoteAgeMs) { flagUnprotected(p, 'stale or missing price — stop cannot be evaluated'); continue; }
    const meta = P<any>(p.targets);
    const st: ExitState = { entry: p.entry_price, stop: p.stop_price, initialStop: p.initial_stop, qtyLeft: p.qty, qtyInit: meta.qtyInit, targets: meta.targets, trailAfterR: meta.trailAfterR, barsHeld: 0, maxHoldBars: Infinity, mfe: p.mfe, mae: p.mae };
    const last = meta.lastPx ?? p.entry_price; const bid = px.bid || px.price;
    const fills = stepExit(st, { o: last, h: Math.max(last, bid), l: Math.min(last, bid), c: bid }, 0, false);
    if (st.qtyLeft > 1e-12 && p.max_hold_ms && nowTs - p.opened_at >= p.max_hold_ms) { fills.push({ reason: 'TIME', price: bid, qty: st.qtyLeft }); st.qtyLeft = 0; }
    meta.targets = st.targets; meta.lastPx = bid;
    const after: Deferred = [];
    try {
      tx(() => {
        run('UPDATE positions SET stop_price=?, targets=?, mfe=?, mae=? WHERE id=?', st.stop, J(meta), st.mfe, st.mae, p.id);
        if (st.stop !== p.stop_price) { run("UPDATE orders SET stop_price=?, updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", st.stop, nowTs, p.id); journal('EXIT', `${p.instrument} stop tightened to ${st.stop.toPrecision(6)} (breakeven trail)`, p.id); }
        for (const f of fills) if (!applyExit(p.id, f.qty, f.reason, pol.feeRate, nowTs, after)) throw new ExitUnavailable();
      });
      after.forEach((fn) => fn());
    } catch (e: any) {
      flagUnprotected(p, e instanceof ExitUnavailable ? 'no fresh executable price for exit' : `exit failed: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }
}
function flagUnprotected(p: PositionRow, why: string) {
  const key = `unprot:${p.id}`; if ((flagged.get(key) ?? 0) > Date.now() - 600_000) return;
  flagged.set(key, Date.now());
  notify('CRITICAL', `Protection unverified: ${p.instrument}`, `${why}. New entries are blocked by the data-quality gate until prices recover.`, 'risk');
  journal('RISK', `Protection unverified for ${p.instrument}: ${why}`, p.id);
}
const flagged = new Map<string, number>();

/**
 * Apply one exit fill. MUST run inside tx(): it re-reads the position there, so the quantity it sells is the
 * quantity that is actually still open. Returns null when the position is not open or no fresh price exists.
 * Order/fill/ledger/position rows are written together; journal, autopsy and bus events are deferred to `after`
 * so nothing is announced for a transaction that rolls back.
 */
/** Exit reasons that reduce risk and must complete even without a fresh, deep enough book. */
export const PROTECTIVE_EXITS = new Set(['STOP', 'TRAIL_STOP', 'TIME', 'MANUAL_CLOSE']);

function applyExit(positionId: string, wantQty: number, reason: string, fr: number, nowTs: number, after: Deferred) {
  const p = get<PositionRow>('SELECT * FROM positions WHERE id=?', positionId);
  if (!p || p.status !== 'OPEN' || !(p.qty > 0)) return null;
  const inst = market.instruments.get(p.instrument); const step = inst?.stepSize ?? 0;
  let qty = floorStep(Math.min(wantQty, p.qty), step);
  let remaining = Number((p.qty - qty).toFixed(12));
  // A remainder smaller than one lot (or the venue minimum) could never be sold later: close it with this fill.
  if (remaining < Math.max(step, inst?.minQty ?? 0, 1e-12) - 1e-12) { qty = p.qty; remaining = 0; }
  if (!(qty > 0)) return { price: 0, pnl: 0, closed: false, qty: 0 }; // slice below one lot: nothing to sell yet
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  const fill = simulateExitFill(p.instrument, qty, pol.stopFillBufferPct, nowTs);
  if (!fill) return null;
  // Integration rule (PR #3 + PR #4): protective exits must complete, so they may use the conservative quote-based
  // price when the book is stale or too thin. Every other exit (take-profit, discretionary) is only booked against a
  // fresh book that absorbs the full size — never a synthetic fill — and otherwise stays open with a warning.
  if (!PROTECTIVE_EXITS.has(reason) && fill.basis !== 'BOOK') return null;
  const px = fill.price; const fee = px * qty * fr; const pnl = (px - p.entry_price) * qty - fee; const closed = remaining === 0;
  const seq = get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE position_id=? AND purpose LIKE 'EXIT_%'", positionId)!.n + 1;
  // Deterministic client id: a second writer trying to record the same exit hits UNIQUE(client_order_id) and rolls back.
  const oid = insertOrder({ clientOrderId: `exit-${positionId}-${seq}`, instrument: p.instrument, side: 'SELL', type: 'MARKET', qty, status: 'FILLED', purpose: `EXIT_${reason}`, positionId });
  run('UPDATE orders SET filled_qty=?, avg_price=?, fees=? WHERE id=?', qty, px, fee, oid);
  run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', uid('fil'), oid, qty, px, fee, 'TAKER', nowTs);
  ledger(PAPER_ACCOUNT, 'SELL', px * qty, oid, `${p.instrument} exit ${reason}`, nowTs); ledger(PAPER_ACCOUNT, 'FEE', -fee, oid, 'exit fee', nowTs);
  run('UPDATE positions SET qty=?, realized_pnl=realized_pnl+?, fees=fees+?, status=?, closed_at=?, exit_price=?, exit_reason=? WHERE id=?',
    remaining, pnl, fee, closed ? 'CLOSED' : 'OPEN', closed ? nowTs : null, closed ? px : null, closed ? reason : null, positionId);
  if (closed) run("UPDATE orders SET status='CANCELLED', updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", nowTs, positionId);
  else run("UPDATE orders SET qty=?, updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", remaining, nowTs, positionId);
  after.push(() => {
    journal('EXIT', `SELL ${qty} ${p.instrument.split(':')[2]} @ ${px.toPrecision(6)} — ${reason}, PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${fill.basis === 'BOOK' ? '' : ` [${fill.basis}]`}`, positionId, { fill, fee, reason });
    if (closed) autopsy(positionId);
    bus.publish('position', { positionId, closed });
  });
  return { price: px, pnl, closed, qty };
}

export function executeExit(positionId: string, qty: number, reason: string, fr = feeRate(), nowTs = Date.now()) {
  const after: Deferred = [];
  const r = tx(() => applyExit(positionId, qty, reason, fr, nowTs, after));
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
    const ok = !!stop && Math.abs(stop.qty - p.qty) < 1e-9 && stop.stop_price === p.stop_price && !!px && Date.now() - px.ts < QUALITY_LIMITS.maxExecQuoteAgeMs;
    return { positionId: p.id, instrument: p.instrument, protected: ok, stop: p.stop_price, qty: p.qty, issue: ok ? null : !stop ? 'no active protective stop' : !px ? 'no price' : 'stop/qty mismatch or stale price' };
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
