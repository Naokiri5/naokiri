import { all, get } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from '../core/audit.js';
import { reconcile } from '../portfolio/calendar.js';
import { protectPositions } from '../exec/oms.js';
import { verifyMemory } from '../ditas/memory.js';
import type { VerifyResult } from './backup.js';
/**
 * Restart validation for the EXISTING atomic PAPER OMS — not a second ledger or
 * a venue reconciler. The canonical OMS writes orders, fills, cash entries and
 * positions in one SQLite transaction; a committed partial exit must agree
 * across all four before the next process may accept new trades.
 *
 * No writes or fake recovery fills. If a snapshot is ambiguous, halt takeover.
 * A future real venue adapter needs an independent authenticated fill replay
 * with exactly-once venue fill IDs; PAPER data cannot serve as live evidence.
 */
export function auditPaperOmsRecovery(): { ok: boolean; detail: string; problems: string[] } {
  const problems: string[] = [];
  const account = 'paper-bot';
  const venue = 'binance-paper';
  const approx = (a: number, b: number, unit: number) =>
    Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= Math.max(unit, Math.abs(a) * 1e-8, Math.abs(b) * 1e-8);

  const positions = all<{ id: string; status: string; qty: number }>(
    "SELECT id,status,qty FROM positions WHERE account=? AND status IN ('OPEN','CLOSED')", account,
  );
  const orders = all<{ id: string; position_id: string; purpose: string; side: string;
    status: string; filled_qty: number; fees: number }>(
    `SELECT id,position_id,purpose,side,status,filled_qty,fees FROM orders
       WHERE account=? AND venue=? AND position_id IS NOT NULL
       AND (purpose='ENTRY' OR purpose LIKE 'EXIT_%')`, account, venue,
  );
  const positionsById = new Map(positions.map((p) => [p.id, p]));
  const quantities = new Map<string, { entry: number; exit: number }>();
  for (const position of positions) quantities.set(position.id, { entry: 0, exit: 0 });

  for (const order of orders) {
    if (!positionsById.has(order.position_id)) {
      problems.push(`order ${order.id}: no open/closed position`);
      continue;
    }
    const isEntry = order.purpose === 'ENTRY';
    if (order.status !== 'FILLED' || !Number.isFinite(order.filled_qty) || order.filled_qty <= 0) {
      problems.push(`order ${order.id}: unverified ${order.purpose} state ${order.status}`);
      continue;
    }
    if (order.side !== (isEntry ? 'BUY' : 'SELL')) {
      problems.push(`order ${order.id}: invalid OMS direction`);
      continue;
    }
    const fills = all<{ qty: number; price: number; fee: number }>(
      'SELECT qty,price,fee FROM fills WHERE order_id=?', order.id,
    );
    const qty = fills.reduce((total, f) => total + f.qty, 0);
    const cash = fills.reduce((total, f) => total + f.qty * f.price, 0);
    const fees = fills.reduce((total, f) => total + f.fee, 0);
    if (!fills.length || fills.some((f) => !(f.qty > 0 && f.price > 0 && f.fee >= 0) ||
      ![f.qty, f.price, f.fee].every(Number.isFinite)) ||
      !approx(qty, order.filled_qty, 1e-9) || !approx(fees, order.fees, 1e-6)) {
      problems.push(`order ${order.id}: fill or fee mismatch`);
      continue;
    }
    const booking = all<{ kind: string; amount: number }>(
      "SELECT kind, amount FROM ledger_entries WHERE account=? AND ref=? AND kind IN ('BUY','SELL','FEE')",
      account, order.id,
    );
    const principal = booking.filter((row) => row.kind === (isEntry ? 'BUY' : 'SELL'));
    const feeRows = booking.filter((row) => row.kind === 'FEE');
    if (principal.length !== 1 || feeRows.length !== 1 ||
        !approx(principal[0]?.amount ?? NaN, isEntry ? -cash : cash, 1e-6) ||
        !approx(feeRows[0]?.amount ?? NaN, -fees, 1e-6) ||
        booking.some((row) => !Number.isFinite(row.amount))) {
      problems.push(`order ${order.id}: cash ledger does not match confirmed fills`);
      continue;
    }
    const totals = quantities.get(order.position_id)!;
    if (isEntry) totals.entry += qty;
    else totals.exit += qty;
  }

  // Compare the paper broker's filled quantity with the authoritative
  // remaining position quantity, including partially exited OPEN positions.
  for (const p of positions) {
    const totals = quantities.get(p.id)!;
    const expectedRemaining = totals.entry - totals.exit;
    if (!(totals.entry > 0) || !Number.isFinite(p.qty) || p.qty < 0 ||
        totals.exit > totals.entry + 1e-8 ||
        !approx(expectedRemaining, p.status === 'CLOSED' ? 0 : p.qty, 1e-8) ||
        (p.status === 'CLOSED' && !approx(p.qty, 0, 1e-8))) {
      problems.push(`position ${p.id}: confirmed fills and remaining quantity disagree`);
    }
  }
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? `restart OMS evidence mismatch in ${problems.length} check(s); see recovery audit`
      : `PAPER OMS fills, ledger and quantities agree (${positions.length} position(s))`,
    problems,
  };
}


type IntegrityCheck = VerifyResult['checks'][number];

/**
 * Live-database checks run before this process takes over the engine (holdEngine in bot/bot.ts). Same check shape as
 * verifyBackup, but on the open database and built from the existing verifiers. Nothing is repaired: a failure means
 * no scheduler runs until the owner investigates. Protective stops are checked as records only (present, matching
 * qty and stop); price and book freshness belong to the position monitor and are usually cold at takeover.
 */
export function takeoverIntegrity(): { ok: boolean; checks: IntegrityCheck[] } {
  const checks: IntegrityCheck[] = [];
  const add = (name: string, fn: () => [boolean, string]) => {
    try { const [ok, detail] = fn(); checks.push({ name, ok, detail }); }
    catch (e: any) { checks.push({ name, ok: false, detail: `check failed: ${String(e?.message ?? e).slice(0, 200)}` }); }
  };
  add('quick_check', () => {
    const r = all<{ quick_check: string }>('PRAGMA quick_check').map((x) => x.quick_check);
    return [r.length === 1 && r[0] === 'ok', r.slice(0, 3).join('; ')];
  });
  add('schema', () => {
    const v = get<{ v: number | null }>('SELECT MAX(version) v FROM schema_migrations')?.v ?? 0;
    return [v === SCHEMA_VERSION, `v${v} (code v${SCHEMA_VERSION})`];
  });
  add('audit chain', () => { const a = verifyAuditChain(); return [a.ok, a.ok ? `${a.entries} entries` : `broken at entry ${a.brokenAt}`]; });
  add('decision memory chain', () => { const d = verifyMemory(); return [d.ok, d.ok ? `${d.entries} events` : `broken at ${d.brokenAt}`]; });
  add('ledger reconcile', () => { const r = reconcile(); return [r.ok, r.detail]; });
  add('protective stops', () => {
    const bad = protectPositions().positions.filter((p) => p.issue === 'no active protective stop' || p.issue === 'stop/qty mismatch');
    return [bad.length === 0, bad.length ? `${bad.length} open position(s) without a matching active stop: ${bad.slice(0, 5).map((p) => p.positionId).join(', ')}` : 'every open position has a matching active stop'];
  });
  add('paper OMS restart reconciliation', () => { const report = auditPaperOmsRecovery(); return [report.ok, report.detail]; });
  return { ok: checks.every((c) => c.ok), checks };
}
