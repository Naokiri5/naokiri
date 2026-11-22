import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { all, run } from '../src/db/db.js';
import { auditPaperOmsRecovery, takeoverIntegrity } from '../src/ops/integrity.js';
import { PAPER_ACCOUNT } from '../src/portfolio/ledger.js';

const instrument = 'crypto:binance:ETHUSDT';
const now = 1_800_000_000_000;

/** Real canonical migrations and atomic paper OMS row shapes, no mock exchange. */
function seedPartiallyExited() {
  run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,
    stop_price,initial_stop,targets,status,opened_at,planned_risk)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'p1', PAPER_ACCOUNT, instrument, 'crypto', 'LONG', 'trend_pullback',
    0.5, 100, 90, 90, JSON.stringify({ qtyInit: 1, targets: [], lastPx: 120 }), 'OPEN', now, 10);

  const order = (id: string, coid: string, side: string, purpose: string, qty: number,
    status: string, filled: number, fees: number) => {
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,
      status,purpose,position_id,filled_qty,fees,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, coid, PAPER_ACCOUNT,
      'binance-paper', instrument, side, 'MARKET', qty, status, purpose, 'p1',
      filled, fees, now, now);
  };
  order('o-entry', 'entry-p1', 'BUY', 'ENTRY', 1, 'FILLED', 1, 1);
  order('o-exit', 'exit-p1-1', 'SELL', 'EXIT_TARGET', 0.5, 'FILLED', 0.5, 0.6);
  order('o-stop', 'stop-p1', 'SELL', 'PROTECTIVE_STOP', 0.5, 'ACTIVE', 0, 0);

  run('UPDATE orders SET stop_price=? WHERE id=?', 90, 'o-stop');
  run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)',
    'fill-entry', 'o-entry', 1, 100, 1, 'TAKER', now);
  run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)',
    'fill-exit', 'o-exit', 0.5, 120, 0.6, 'TAKER', now);
  const book = (id: string, kind: string, amt: number, ref: string) =>
    run('INSERT INTO ledger_entries(id,account,ts,kind,amount,ref) VALUES (?,?,?,?,?,?)',
      id, PAPER_ACCOUNT, now, kind, amt, ref);
  book('l-buy', 'BUY', -100, 'o-entry');
  book('l-fee-entry', 'FEE', -1, 'o-entry');
  book('l-sell', 'SELL', 60, 'o-exit');
  book('l-fee-exit', 'FEE', -0.6, 'o-exit');
}

describe('crash/restart paper OMS evidence reconciliation', () => {
  beforeEach(() => { freshDb(); seedPartiallyExited(); });

  it('accepts a fill-committed partial exit with matching ledger, entry and remaining qty', () => {
    expect(auditPaperOmsRecovery()).toMatchObject({ ok: true, problems: [] });
    expect(takeoverIntegrity().checks.find((c) => c.name === 'paper OMS restart reconciliation')).toMatchObject({ ok: true });
  });

  it('halts takeover when an exit has a missing venue-simulated paper fill', () => {
    run("DELETE FROM fills WHERE id='fill-exit'");
    const r = auditPaperOmsRecovery();
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('order o-exit: fill or fee mismatch');
    expect(takeoverIntegrity().ok).toBe(false);
  });

  it('halts on excess ledger booking even though an exit fill exists', () => {
    run(`INSERT INTO ledger_entries(id,account,ts,kind,amount,ref)
      VALUES ('l-duplicate',?,?,?,?,?)`, PAPER_ACCOUNT, now, 'SELL', 60, 'o-exit');
    expect(auditPaperOmsRecovery().problems).toContain(
      'order o-exit: cash ledger does not match confirmed fills');
  });

  it('halts on partial-fill quantity drift after a crash', () => {
    run("UPDATE positions SET qty=0.6 WHERE id='p1'");
    expect(auditPaperOmsRecovery().problems).toContain(
      'position p1: confirmed fills and remaining quantity disagree');
  });

  it('halts on ambiguous pending exit order rather than replaying or faking it', () => {
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,
      status,purpose,position_id,created_at,updated_at)
      VALUES ('o-pending','exit-p1-2',?,?,?,?,?,?,?,?,?,?,?)`,
      PAPER_ACCOUNT, 'binance-paper', instrument, 'SELL', 'MARKET', 0.5,
      'NEW', 'EXIT_STOP', 'p1', now, now);
    expect(auditPaperOmsRecovery().problems).toContain(
      'order o-pending: unverified EXIT_STOP state NEW');
  });

  it('allows an owner-approval entry with no position; only materialized fills are reconciled', () => {
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,
      status,purpose,created_at,updated_at) VALUES
      ('o-approval','entry-pending',?,?,?,?,?,?,?,?,?)`,
      PAPER_ACCOUNT, 'binance-paper', instrument, 'BUY', 'MARKET', 1,
      'PENDING_APPROVAL', 'ENTRY', now, now);
    expect(auditPaperOmsRecovery().ok).toBe(true);
  });

  it('rejects fill-independent position records; audit never writes or repairs balances', () => {
    const before = all('SELECT * FROM ledger_entries ORDER BY id');
    run("DELETE FROM fills WHERE order_id='o-entry'");
    expect(auditPaperOmsRecovery().ok).toBe(false);
    expect(all('SELECT * FROM ledger_entries ORDER BY id')).toEqual(before);
  });
});
