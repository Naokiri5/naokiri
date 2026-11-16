import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, iso } from '../core/util.js';
import { market } from '../market/store.js';
import { bookImpact } from '../market/quality.js';
import { evaluateRisk } from '../risk/gate.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';
import { ledger, openPositions, PAPER_ACCOUNT, type PositionRow } from '../portfolio/ledger.js';
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

/** Simulate a marketable fill against the live book. Returns null if the book cannot absorb it. */
function simulateFill(instrumentId: string, side: 'BUY' | 'SELL', qty: number) {
  const d = market.deep.get(instrumentId); const px = market.price(instrumentId);
  if (!d?.book || !px) return null;
  const ref = side === 'BUY' ? px.ask : px.bid;
  const imp = bookImpact(d.book, side === 'BUY' ? 'buy' : 'sell', qty * ref);
  if (!imp || !imp.filledFully) return null;
  return { price: imp.avgPrice, impactBps: imp.impactBps, spreadBps: imp.spreadBps, bookAgeMs: Date.now() - d.book.ts };
}

/** Entry submission with Part 29 L5 last-moment validation. */
export function submitEntry(report: DecisionReport, actor: 'bot' | 'owner'): { ok: boolean; orderId?: string; positionId?: string; reason?: string } {
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
  const fill = simulateFill(s.instrumentId, 'BUY', qty);
  if (!fill) return reject('NO_EXECUTABLE_BOOK: depth insufficient or book unavailable');
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  if (fill.impactBps > pol.maxSlippageBps) return reject(`SLIPPAGE ${fill.impactBps.toFixed(1)}bps at submission`);
  if (fill.price <= s.stopLoss) return reject('PRICE_THROUGH_STOP');
  const fee = fill.price * qty * pol.feeRate;
  const R = fill.price - s.stopLoss;
  const tgts = s.takeProfit.map((t) => ({ r: (t.price - fill.price) / R, fraction: t.fraction }));
  const st = newExitState(fill.price, s.stopLoss, qty, tgts, null, 0);
  const posId = uid('pos');
  const strat = s.strategy.id;
  const maxHoldMs = (strat === 'range_reversion' ? 24 : strat === 'trend_pullback' ? 48 : 72) * 3600_000;
  const trailAfterR = strat === 'trend_pullback' ? 1 : strat === 'donchian_breakout' ? 1.5 : null;
  const orderId = tx(() => {
    const oid = existing ? existing.id : insertOrder({ clientOrderId: coid, instrument: s.instrumentId, side: 'BUY', type: 'MARKET', qty, status: 'NEW', purpose: 'ENTRY', decisionId: s.id });
    run("UPDATE orders SET status='FILLED', qty=?, filled_qty=?, avg_price=?, fees=?, position_id=?, updated_at=? WHERE id=?", qty, qty, fill.price, fee, posId, Date.now(), oid);
    run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', uid('fil'), oid, qty, fill.price, fee, 'TAKER', Date.now());
    run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,max_hold_ms,decision_id,planned_risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      posId, PAPER_ACCOUNT, s.instrumentId, s.market, 'LONG', strat, qty, fill.price, s.stopLoss, s.stopLoss, J({ qtyInit: qty, trailAfterR, targets: st.targets, lastPx: fill.price }), 'OPEN', Date.now(), -fee, fee, maxHoldMs, s.id, qty * (fill.price - s.stopLoss * (1 - pol.stopFillBufferPct / 100)) + fee);
    // Protective stop: paper venue has no exchange-native stop; OMS monitors it. Recorded explicitly.
    insertOrder({ clientOrderId: `stop-${posId}`, instrument: s.instrumentId, side: 'SELL', type: 'STOP_MARKET (OMS-monitored, paper)', qty, stop: s.stopLoss, status: 'ACTIVE', purpose: 'PROTECTIVE_STOP', positionId: posId });
    ledger(PAPER_ACCOUNT, 'BUY', -fill.price * qty, oid, `${s.asset} entry`); ledger(PAPER_ACCOUNT, 'FEE', -fee, oid, 'entry fee');
    return oid;
  });
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

/** Position monitoring (Part 17.4/26.4). Uses the shared exit capsule on successive bid snapshots. */
export function monitorPositions(nowTs = Date.now()) {
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  for (const p of openPositions()) {
    const px = market.price(p.instrument);
    if (!px || nowTs - px.ts > 120_000) { flagUnprotected(p, 'stale or missing price — stop cannot be evaluated'); continue; }
    const meta = P<any>(p.targets);
    const st: ExitState = { entry: p.entry_price, stop: p.stop_price, initialStop: p.initial_stop, qtyLeft: p.qty, qtyInit: meta.qtyInit, targets: meta.targets, trailAfterR: meta.trailAfterR, barsHeld: 0, maxHoldBars: Infinity, mfe: p.mfe, mae: p.mae };
    const last = meta.lastPx ?? p.entry_price; const bid = px.bid || px.price;
    const fills = stepExit(st, { o: last, h: Math.max(last, bid), l: Math.min(last, bid), c: bid }, 0, false);
    if (st.qtyLeft > 1e-12 && p.max_hold_ms && nowTs - p.opened_at >= p.max_hold_ms) { fills.push({ reason: 'TIME', price: bid, qty: st.qtyLeft }); st.qtyLeft = 0; }
    meta.targets = st.targets; meta.lastPx = bid;
    run('UPDATE positions SET stop_price=?, targets=?, mfe=?, mae=? WHERE id=?', st.stop, J(meta), st.mfe, st.mae, p.id);
    if (st.stop !== p.stop_price) { run("UPDATE orders SET stop_price=?, updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", st.stop, nowTs, p.id); journal('EXIT', `${p.instrument} stop tightened to ${st.stop.toPrecision(6)} (breakeven trail)`, p.id); }
    for (const f of fills) executeExit(p.id, f.qty, f.reason, pol.feeRate);
  }
}
function flagUnprotected(p: PositionRow, why: string) {
  const key = `unprot:${p.id}`; if ((flagged.get(key) ?? 0) > Date.now() - 600_000) return;
  flagged.set(key, Date.now());
  notify('CRITICAL', `Protection unverified: ${p.instrument}`, `${why}. New entries are blocked by the data-quality gate until prices recover.`, 'risk');
  journal('RISK', `Protection unverified for ${p.instrument}: ${why}`, p.id);
}
const flagged = new Map<string, number>();

export function executeExit(positionId: string, qty: number, reason: string, fr = feeRate()) {
  const p = get<PositionRow>('SELECT * FROM positions WHERE id=?', positionId);
  if (!p || p.status !== 'OPEN') return null;
  qty = Math.min(qty, p.qty);
  const fill = simulateFill(p.instrument, 'SELL', qty);
  // Never book a synthetic full fill at the ticker bid when executable book depth is unavailable.
  // Keep the position open and raise an operator-visible protection warning instead.
  if (!fill) { flagUnprotected(p, 'no executable order-book depth for exit'); return null; }
  const px = fill.price;
  const fee = px * qty * fr; const pnl = (px - p.entry_price) * qty - fee;
  const remaining = p.qty - qty; const closed = remaining <= 1e-12;
  tx(() => {
    const oid = insertOrder({ clientOrderId: `exit-${positionId}-${uid('x')}`, instrument: p.instrument, side: 'SELL', type: 'MARKET', qty, status: 'FILLED', purpose: `EXIT_${reason}`, positionId });
    run('UPDATE orders SET filled_qty=?, avg_price=?, fees=? WHERE id=?', qty, px, fee, oid);
    run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', uid('fil'), oid, qty, px, fee, 'TAKER', Date.now());
    ledger(PAPER_ACCOUNT, 'SELL', px * qty, oid, `${p.instrument} exit ${reason}`); ledger(PAPER_ACCOUNT, 'FEE', -fee, oid, 'exit fee');
    run('UPDATE positions SET qty=?, realized_pnl=realized_pnl+?, fees=fees+?, status=?, closed_at=?, exit_price=?, exit_reason=? WHERE id=?',
      closed ? 0 : remaining, pnl, fee, closed ? 'CLOSED' : 'OPEN', closed ? Date.now() : null, closed ? px : null, closed ? reason : null, positionId);
    if (closed) run("UPDATE orders SET status='CANCELLED', updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", Date.now(), positionId);
    else run("UPDATE orders SET qty=?, updated_at=? WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", remaining, Date.now(), positionId);
  });
  journal('EXIT', `SELL ${qty} ${p.instrument.split(':')[2]} @ ${px.toPrecision(6)} — ${reason}, PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`, positionId, { fill, fee, reason });
  if (closed) autopsy(positionId);
  bus.publish('position', { positionId, closed });
  return { price: px, pnl, closed };
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
    const ok = !!stop && Math.abs(stop.qty - p.qty) < 1e-9 && stop.stop_price === p.stop_price && !!px && Date.now() - px.ts < 120_000;
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
  if (!r) throw new OmsError('position not open or no executable price');
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
