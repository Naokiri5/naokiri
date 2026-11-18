/**
 * Cross-table accounting invariants for the paper OMS (CLAUDE.md #5). Returns human-readable violations; [] is healthy.
 * Read-only; call it with the DB open.
 */
import { all, get } from '../../src/db/db.js';
import { reconcile } from '../../src/portfolio/calendar.js';
import { cashBalance, PAPER_ACCOUNT } from '../../src/portfolio/ledger.js';
import { market } from '../../src/market/store.js';

const EPS = 1e-8;
const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

export function checkInvariants(): string[] {
  const bad: string[] = [];
  for (const d of all<{ client_order_id: string; n: number }>('SELECT client_order_id, COUNT(*) n FROM orders GROUP BY client_order_id HAVING n > 1')) bad.push(`${d.n} orders share client id ${d.client_order_id}`);

  const filled = all<any>("SELECT * FROM orders WHERE status='FILLED'");
  let flows = 0;
  for (const o of filled) {
    const fills = all<{ qty: number; price: number; fee: number }>('SELECT qty, price, fee FROM fills WHERE order_id=?', o.id);
    if (fills.length !== 1) { bad.push(`order ${o.client_order_id} has ${fills.length} fills`); continue; }
    const f = fills[0];
    if (!near(f.qty, o.filled_qty) || !near(f.qty, o.qty) || !near(f.price, o.avg_price) || !near(f.fee, o.fees)) bad.push(`order ${o.client_order_id} disagrees with its fill`);
    const postings = all<{ kind: string; amount: number }>('SELECT kind, amount FROM ledger_entries WHERE ref=? ORDER BY kind', o.id);
    const kinds = postings.map((p) => p.kind).join(',');
    const want = o.side === 'BUY' ? 'BUY,FEE' : 'FEE,SELL';
    if (kinds !== want) { bad.push(`order ${o.client_order_id} postings [${kinds}], want [${want}]`); continue; }
    const notional = f.price * f.qty, trade = postings.find((p) => p.kind !== 'FEE')!.amount, fee = postings.find((p) => p.kind === 'FEE')!.amount;
    if (!near(trade, o.side === 'BUY' ? -notional : notional) || !near(fee, -f.fee)) bad.push(`order ${o.client_order_id} postings do not match its fill`);
    flows += (o.side === 'BUY' ? -notional : notional) - f.fee;
  }
  for (const l of all<{ ref: string }>("SELECT ref FROM ledger_entries WHERE kind<>'DEPOSIT' AND (ref IS NULL OR ref NOT IN (SELECT id FROM orders WHERE status='FILLED'))")) bad.push(`ledger posting refers to no filled order (${l.ref})`);

  for (const p of all<any>('SELECT * FROM positions')) {
    const entry = get<{ q: number }>("SELECT COALESCE(SUM(f.qty),0) q FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.position_id=? AND o.purpose='ENTRY'", p.id)!.q;
    const exited = get<{ q: number }>("SELECT COALESCE(SUM(f.qty),0) q FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.position_id=? AND o.purpose LIKE 'EXIT_%'", p.id)!.q;
    if (!near(entry - exited, p.qty)) bad.push(`position ${p.id}: entry ${entry} - exits ${exited} != qty ${p.qty}`);
    const meta = JSON.parse(p.targets) as { qtyInit: number; targets: { fraction: number; done: boolean }[] };
    const targetSold = get<{ q: number }>("SELECT COALESCE(SUM(f.qty),0) q FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.position_id=? AND o.purpose='EXIT_TARGET'", p.id)!.q;
    const targetAllowed = meta.qtyInit * meta.targets.filter((t) => t.done).reduce((s, t) => s + t.fraction, 0) + (market.instruments.get(p.instrument)?.stepSize ?? 0);
    if (targetSold > targetAllowed + EPS) bad.push(`position ${p.id} sold ${targetSold} at targets, more than its done targets allow (${targetAllowed})`);
    if ((p.status === 'CLOSED') !== (p.qty === 0)) bad.push(`position ${p.id} is ${p.status} with qty ${p.qty}`);
    const stops = all<{ qty: number; stop_price: number }>("SELECT qty, stop_price FROM orders WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", p.id);
    if (p.status === 'OPEN' && (stops.length !== 1 || !near(stops[0].qty, p.qty) || stops[0].stop_price !== p.stop_price)) bad.push(`open position ${p.id} has ${stops.length} active stops, not one matching qty/stop`);
    if (p.status === 'CLOSED' && stops.length) bad.push(`closed position ${p.id} still has ${stops.length} active stops`);
  }

  const deposits = get<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE kind='DEPOSIT'")!.s;
  if (!near(cashBalance(PAPER_ACCOUNT), deposits + flows, 1e-10)) bad.push(`cash ${cashBalance(PAPER_ACCOUNT)} != deposits + fills ${deposits + flows}`);
  const rec = reconcile();
  if (!rec.ok) bad.push(`reconcile: ${rec.detail}`);
  return bad;
}
