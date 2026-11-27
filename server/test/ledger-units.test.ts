import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { all, closeDb, get, run, tx } from '../src/db/db.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';
import { PAPER_ACCOUNT, cashBalance, ledger, totalDeposits } from '../src/portfolio/ledger.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { releaseGates } from '../src/qa/gates.js';
import { freshDb } from './helpers.js';

afterEach(() => closeDb());
const g05 = () => releaseGates(null).gates.find((g) => g.id === 'G05')!;

describe('migration 13 exact ledger units', () => {
  it('upgrades from v12, backfilling units from existing REAL rows', () => {
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 12);
    const ins = raw.prepare("INSERT INTO ledger_entries(id,account,ts,kind,amount) VALUES (?,'paper-bot',1,?,?)");
    ins.run('a', 'DEPOSIT', 10000); ins.run('b', 'BUY', -123.45678912); ins.run('c', 'FEE', -0.1); ins.run('d', 'SELL', 0.30000000000000004);
    migrate(raw);
    expect((raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v).toBe(13);
    expect(SCHEMA_VERSION).toBe(13);
    const rows = raw.prepare('SELECT id, amount, amount_units u FROM ledger_entries ORDER BY id').all() as { id: string; amount: number; u: number }[];
    expect(rows.map((r) => [r.id, r.amount, r.u])).toEqual([['a', 10000, 1000000000000], ['b', -123.45678912, -12345678912], ['c', -0.1, -10000000], ['d', 0.30000000000000004, 30000000]]);
    raw.close();
  });
});

describe('ledger dual write', () => {
  it('writes the REAL amount unchanged and exact units', () => {
    freshDb(false);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1234.56789012345);
    expect(get('SELECT amount, amount_units u FROM ledger_entries')).toEqual({ amount: 1234.56789012345, u: 123456789012 });
  });
  it('sums exactly where the float sum drifts', () => {
    freshDb(false);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1000);
    let floatSum = 1000;
    for (let i = 0; i < 1000; i++) { ledger(PAPER_ACCOUNT, 'WITHDRAW', -0.1); floatSum += -0.1; }
    expect(floatSum).not.toBe(900);
    expect(cashBalance()).toBe(900);
    expect(totalDeposits()).toBe(900);
  });
  it('fails closed and rolls back the caller transaction on a bad amount', () => {
    freshDb(false);
    expect(() => tx(() => { ledger(PAPER_ACCOUNT, 'DEPOSIT', 5); ledger(PAPER_ACCOUNT, 'FEE', NaN); })).toThrow('MONEY_INVALID_AMOUNT');
    expect(() => ledger(PAPER_ACCOUNT, 'DEPOSIT', 1e12)).toThrow('MONEY_OUT_OF_RANGE');
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM ledger_entries')!.n).toBe(0);
  });
  it('refuses to report cash when a row has no units', () => {
    freshDb(false);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 5);
    run('UPDATE ledger_entries SET amount_units=NULL');
    expect(() => cashBalance()).toThrow('LEDGER_UNITS_MISSING');
  });
});

describe('reconcile units divergence', () => {
  it('is ok for dual-written rows, and fails reconcile and G05 when REAL and units diverge by more than 1 unit', () => {
    freshDb(false);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1000);
    expect(reconcile()).toMatchObject({ ok: true, unitsMissing: 0, unitsDivergence: 0, cash: 1000 });
    expect(g05().status).toBe('PASS');
    run('UPDATE ledger_entries SET amount_units=amount_units+1'); // within 1 unit
    expect(reconcile().ok).toBe(true);
    run('UPDATE ledger_entries SET amount=amount+0.00000003');
    const r = reconcile();
    expect(r).toMatchObject({ ok: false, unitsDivergence: 1 });
    expect(r.detail).toContain('diverge');
    expect(g05().status).toBe('FAIL');
  });
  it('does not false-fail a large row whose REAL value cannot hold every unit', () => {
    freshDb(false);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 50_000_000.12345679);
    expect(reconcile()).toMatchObject({ ok: true, unitsDivergence: 0 });
    run('UPDATE ledger_entries SET amount_units=amount_units+10'); // 1e-7 USDT, beyond tolerance at any scale
    expect(reconcile()).toMatchObject({ ok: false, unitsDivergence: 1 });
  });
  it('fails closed on a NULL amount_units', () => {
    freshDb(false);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1000);
    run('UPDATE ledger_entries SET amount_units=NULL');
    expect(reconcile()).toMatchObject({ ok: false, unitsMissing: 1 });
    expect(g05().status).toBe('FAIL');
    expect(all('SELECT id FROM ledger_entries')).toHaveLength(1);
  });
});
