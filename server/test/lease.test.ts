import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb, getDb, run, get, all, tx } from '../src/db/db.js';
import { EngineLease } from '../src/bot/lease.js';

const TTL = 3_000; // renew every 1 s, holder fences itself 2 s after its last renew
const clock = (t: number) => { const c = { t, mono: () => c.t, wall: () => 1_800_000_000_000 + c.t }; return c; };

describe('engine lease (one scheduler per database)', () => {
  let ca: ReturnType<typeof clock>; let cb: ReturnType<typeof clock>; let A: EngineLease; let B: EngineLease;
  const step = (ms: number) => { ca.t += ms; cb.t += ms; };
  beforeEach(() => {
    closeDb(); openDb(join(mkdtempSync(join(tmpdir(), 'mia-lease-')), 't.db'));
    ca = clock(1_000); cb = clock(987_654); // independent monotonic origins: nothing compares them
    A = new EngineLease(TTL, ca.mono, ca.wall); B = new EngineLease(TTL, cb.mono, cb.wall);
  });

  it('A acquires epoch 1, B is STANDBY; while A renews B never takes over', () => {
    expect(A.renewMs).toBe(1_000);
    expect(A.tick()).toBe(true); expect(A.epoch).toBe(1); expect(A.view()).toMatchObject({ state: 'OWNER', epoch: 1, ttlMs: TTL });
    expect(B.tick()).toBe(false); expect(B.view()).toMatchObject({ state: 'STANDBY', epoch: 1 });
    for (let i = 0; i < 30; i++) { step(1_000); expect(A.tick()).toBe(true); expect(B.tick()).toBe(false); }
    expect(B.epoch).toBe(0);
    const row = JSON.parse(get<any>("SELECT value FROM settings WHERE key='engine.lease'").value);
    expect(row).toMatchObject({ instanceId: A.instanceId, epoch: 1, seq: 31, released: false });
    const hb = { startedAt: 1, lastTickerAt: 2, lastMonitorAt: 2, lastScanAt: 3, cycles: 4, laneErrors: { scan: 'SCAN_FAILED' } };
    step(1_000); A.tick(hb); step(1_000); A.tick();
    expect(JSON.parse(get<any>("SELECT value FROM settings WHERE key='engine.lease'").value).hb).toEqual(hb); // heartbeat persists for other processes
  });

  it('B takes over only after a full TTL of observed silence, with epoch 2; A cannot renew afterwards', () => {
    A.tick(); B.tick();
    step(1_000); A.tick(); B.tick(); // B observes A's latest seq at this instant
    step(1_000); expect(B.tick()).toBe(false); expect(A.holds()).toBe(true);
    step(1_000); expect(A.holds()).toBe(false); expect(B.tick()).toBe(false); // A already fenced itself, B still waits
    step(999); expect(B.tick()).toBe(false);
    step(1); expect(B.tick()).toBe(true); expect(B.epoch).toBe(2);
    expect(A.tick()).toBe(false); expect(A.holds()).toBe(false); expect(A.epoch).toBe(0);
    expect(A.view()).toMatchObject({ state: 'STANDBY', epoch: 2 }); expect(B.view().state).toBe('OWNER');
  });

  it('a wall clock jump cannot shorten the takeover wait', () => {
    A.tick(); B.tick();
    const C = new EngineLease(TTL, cb.mono, () => 9_999_999_999_999); // wall clock far in the future
    expect(C.tick()).toBe(false); step(2_999); expect(C.tick()).toBe(false); step(1); expect(C.tick()).toBe(true);
  });

  it('holds() boundary is ttl - renewMs after the last successful renew', () => {
    A.tick(); const t = ca.t;
    expect(A.holds(t + 1_999)).toBe(true);
    expect(A.holds(t + 2_000)).toBe(false);
  });

  it('release() keeps the epoch and lets a standby take over at once', () => {
    A.tick(); B.tick();
    A.release(); expect(A.holds()).toBe(false); expect(A.view().state).toBe('VACANT');
    expect(B.tick()).toBe(true); expect(B.epoch).toBe(2);
    B.release(); expect(A.tick()).toBe(true); expect(A.epoch).toBe(3);
  });

  it('a failed COMMIT never publishes ownership (acquire or renew)', () => {
    run('CREATE TABLE fk_parent(id INTEGER PRIMARY KEY)');
    run('CREATE TABLE fk_child(pid INTEGER REFERENCES fk_parent(id) DEFERRABLE INITIALLY DEFERRED)');
    const trap = (on: boolean) => on
      ? getDb().exec("CREATE TRIGGER trap_i AFTER INSERT ON settings WHEN NEW.key='engine.lease' BEGIN INSERT INTO fk_child VALUES (999); END; CREATE TRIGGER trap_u AFTER UPDATE ON settings WHEN NEW.key='engine.lease' BEGIN INSERT INTO fk_child VALUES (999); END;")
      : getDb().exec('DROP TRIGGER trap_i; DROP TRIGGER trap_u;');
    trap(true);
    expect(A.tick()).toBe(false); expect(A.epoch).toBe(0); expect(A.view().state).toBe('VACANT'); // deferred FK fails at COMMIT
    trap(false);
    expect(B.tick()).toBe(true); expect(B.epoch).toBe(1);
    expect(A.tick()).toBe(false); expect(A.view()).toMatchObject({ state: 'STANDBY', epoch: 1 });
    trap(true);
    step(1_000); expect(B.tick()).toBe(false); expect(B.holds()).toBe(false); expect(B.epoch).toBe(0); // renew rolled back: B drops ownership at once
    trap(false);
    expect([A.holds(), B.holds()]).toEqual([false, false]);
    expect(JSON.parse(get<any>("SELECT value FROM settings WHERE key='engine.lease'").value)).toMatchObject({ instanceId: B.instanceId, epoch: 1, seq: 1 });
  });

  it('fenced() runs only for the persisted owner, in one transaction; nested tx() calls are savepoints', () => {
    run('CREATE TABLE fx(v INTEGER)');
    const vals = () => all<{ v: number }>('SELECT v FROM fx ORDER BY v').map((r) => r.v);
    expect(A.fenced(() => run('INSERT INTO fx VALUES (0)'))).toBe(false); // not the owner yet
    A.tick();
    expect(A.fenced(() => run('INSERT INTO fx VALUES (1)'))).toBe(true);
    expect(() => A.fenced(() => { run('INSERT INTO fx VALUES (2)'); tx(() => { run('INSERT INTO fx VALUES (3)'); throw new Error('boom'); }); })).toThrow('boom');
    tx(() => { run('INSERT INTO fx VALUES (4)'); try { tx(() => { run('INSERT INTO fx VALUES (5)'); throw new Error('inner'); }); } catch { /* only the savepoint rolls back */ } });
    expect(vals()).toEqual([1, 4]);
    const row = JSON.parse(get<any>("SELECT value FROM settings WHERE key='engine.lease'").value);
    run("UPDATE settings SET value=? WHERE key='engine.lease'", JSON.stringify({ ...row, instanceId: B.instanceId, epoch: 2 })); // another process took over
    expect(A.holds()).toBe(true); // A's monotonic self-fence has not expired yet...
    expect(A.fenced(() => run('INSERT INTO fx VALUES (6)'))).toBe(false); // ...but the write path re-reads the row under the lock
    expect(vals()).toEqual([1, 4]);
  });

  it('DB errors never throw: the holder stops renewing and fences itself', () => {
    A.tick();
    getDb().exec('BEGIN'); // BEGIN IMMEDIATE inside tick now fails
    step(1_000); expect(() => A.tick()).not.toThrow(); expect(A.holds()).toBe(true);
    step(1_000); expect(A.tick()).toBe(false);
    expect(B.tick()).toBe(false); expect(() => B.view()).not.toThrow();
    getDb().exec('ROLLBACK');
    run("UPDATE settings SET value='{' WHERE key='engine.lease'");
    expect(() => B.tick()).not.toThrow(); expect(B.tick()).toBe(false); expect(B.view().state).toBe('VACANT');
  });
});
