import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, openDb, run, tx } from '../src/db/db.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';
import { reconcile } from '../src/portfolio/calendar.js';

/** Closed paper positions, each with a filled entry and exit order and their principal and fee ledger entries. */
function seedClosedTrades(count: number) {
  tx(() => {
    run("INSERT INTO ledger_entries(id,account,ts,kind,amount) VALUES ('deposit','paper-bot',1,'DEPOSIT',1000000)");
    for (let i = 0; i < count; i++) {
      run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,
        status,opened_at,closed_at,realized_pnl,fees,planned_risk) VALUES (?,'paper-bot','crypto:binance:X','crypto','LONG','s',1,100,95,95,'[]',
        'CLOSED',?,?,0.8,0.2,5)`, `p${i}`, i, i + 1);
      for (const [order, side, purpose, amount] of [[`b${i}`, 'BUY', 'ENTRY', -100], [`s${i}`, 'SELL', 'EXIT_TARGET', 101]] as const) {
        run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,position_id,created_at,updated_at)
          VALUES (?,?,'paper-bot','binance-paper','crypto:binance:X',?,'MARKET',1,'FILLED',?,?,?,?)`, order, `c-${order}`, side, purpose, `p${i}`, i, i);
        run("INSERT INTO ledger_entries(id,account,ts,kind,amount,ref) VALUES (?,'paper-bot',?,?,?,?)", `l-${order}`, i, side, amount, order);
        run("INSERT INTO ledger_entries(id,account,ts,kind,amount,ref) VALUES (?,'paper-bot',?,'FEE',-0.1,?)", `f-${order}`, i, order);
      }
    }
  });
}
function fastestReconcileMs(count: number) {
  closeDb();
  openDb(':memory:');
  seedClosedTrades(count);
  let best = Infinity;
  for (let k = 0; k < 5; k++) {
    const started = performance.now();
    const result = reconcile();
    best = Math.min(best, performance.now() - started);
    expect(result).toMatchObject({ ok: true, closedPositions: count, mismatchedClosedPositions: 0, orphanPrincipalEntries: 0 });
  }
  return best;
}

afterEach(() => closeDb());

describe('ledger reconciliation cost (runs inside the OMS entry transaction)', () => {
  it('reads the per-position join through the reconciliation indexes (deterministic)', () => {
    closeDb(); openDb(':memory:'); seedClosedTrades(10);
    expect(reconcile()).toMatchObject({ ok: true, closedPositions: 10 });
    const raw = new DatabaseSync(':memory:'); migrate(raw);
    const plan = (raw.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM positions p
      LEFT JOIN orders o ON o.position_id=p.id AND o.account=p.account
      LEFT JOIN ledger_entries l ON l.ref=o.id AND l.account=p.account AND l.kind IN ('BUY','SELL','FEE')
      WHERE p.account='paper-bot' AND p.status='CLOSED' GROUP BY p.id,p.realized_pnl`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toMatch(/orders_position/);
    expect(plan).toMatch(/ledger_entries_ref/);
    raw.close();
  });

  // Wall-clock ratios depend on scheduler load, so this stays out of the default suite (MIA_TIMING_TESTS=1 to run).
  it.skipIf(!process.env.MIA_TIMING_TESTS)('grows linearly, not quadratically, with closed trades (timing benchmark)', () => {
    // Linear growth gives a ratio near 4 for 4× the trades; the unindexed join gave about 16.
    const small = fastestReconcileMs(300);
    const large = fastestReconcileMs(1_200);
    expect(large / small).toBeLessThan(9);
  });

  it('adds the reconciliation indexes to a v7 database without changing its rows', () => {
    closeDb();
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 7);
    raw.prepare("INSERT INTO ledger_entries(id,account,ts,kind,amount,ref) VALUES ('keep','paper-bot',1,'DEPOSIT',5,NULL)").run();
    migrate(raw);
    expect((raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
    expect(raw.prepare("SELECT amount FROM ledger_entries WHERE id='keep'").get()).toEqual({ amount: 5 });
    const indexes = (raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['ledger_entries_ref', 'orders_position']));
    raw.close();
  });
});
