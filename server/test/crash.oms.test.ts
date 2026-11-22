/**
 * Crash injection on the paper OMS (blueprint 073; covers 016 and 042). Each case runs one OMS operation in a child
 * process (node --import tsx) against a file-backed WAL database and SIGKILLs it at a named checkpoint. After every
 * restart: SQLite integrity and foreign keys are clean, the accounting invariants hold, and the trading tables are
 * either byte-identical to the stage they started from (kill before COMMIT) or equal to an uninterrupted control run
 * (kill after COMMIT). A recovery child then retries the same operation and must land on the control state exactly
 * once. Race cases park two children at a file barrier just before BEGIN IMMEDIATE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { all, get } from '../src/db/db.js';
import type { CrashPoint } from '../src/exec/crashpoint.js';
import { awaitParked, BARRIER_TIMEOUT, buildStage, newCaseDir, rawState, removeCaseDirs, releaseBarrier, runChild, shape, sqliteHealth, withDb, type ChildOutcome, type ChildRequest, type Stage } from './crash/harness.js';
import { checkInvariants } from './crash/invariants.js';

type Shape = ReturnType<typeof shape>;
interface Scenario {
  stage: Stage; op: ChildRequest['op']; mid?: number;
  /** Checkpoints inside the transaction, as [point, occurrence]. */
  inTx: [CrashPoint, number?][];
  /** First instruction after COMMIT. */
  committed: CrashPoint;
  /** What the uninterrupted operation must produce. */
  applied: (s: Shape) => void;
  /** Result of a retry: after a rolled-back crash (fresh) and after a committed one (replay). */
  fresh: (r: unknown) => void; replay: (r: unknown) => void;
}

const templates = new Map<Stage, { db: string; last: number }>();
const controls = new Map<string, Shape>();
const purposes = (s: Shape) => s.orders.filter((o) => o.purpose.startsWith('EXIT_')).map((o) => o.purpose);
const pos = (s: Shape) => s.positions[0];
const okEntry = (r: unknown) => expect(r).toMatchObject({ ok: true });
const duplicate = (r: unknown) => expect((r as { ok: boolean; reason: string })).toMatchObject({ ok: false, reason: expect.stringMatching(/^DUPLICATE:/) });
const monitorDone = (r: unknown) => expect(r).toBeNull();
const closed = (r: unknown) => expect(r).toMatchObject({ closed: true });
const refused = (r: unknown) => expect(r).toMatchObject({ error: expect.any(String) });
const ENTRY_TX: [CrashPoint][] = [['entry.order'], ['entry.fill'], ['entry.position'], ['entry.stop'], ['entry.buy'], ['entry.precommit']];
const EXIT_TX: [CrashPoint][] = [['exit.order'], ['exit.fill'], ['exit.sell'], ['exit.position'], ['exit.stop']];
const entered = (s: Shape) => {
  expect(s.orders.filter((o) => o.purpose === 'ENTRY').map((o) => o.status)).toEqual(['FILLED']);
  expect(pos(s)).toMatchObject({ status: 'OPEN' }); expect(s.fills).toHaveLength(1);
};

const scenarios = (last: number): Record<string, Scenario> => ({
  ENTRY: { stage: 'fresh', op: 'enter', inTx: ENTRY_TX, committed: 'entry.committed', applied: entered, fresh: okEntry, replay: duplicate },
  APPROVAL: { stage: 'pending', op: 'approve', inTx: ENTRY_TX, committed: 'entry.committed', applied: entered, fresh: okEntry, replay: refused },
  STOP: { stage: 'open', op: 'monitor', mid: last * 0.96, inTx: [['monitor.state'], ...EXIT_TX, ['monitor.precommit']], committed: 'monitor.committed', fresh: monitorDone, replay: monitorDone,
    applied: (s) => { expect(purposes(s)).toEqual(['EXIT_STOP']); expect(pos(s)).toMatchObject({ status: 'CLOSED', qty: 0, exitReason: 'STOP' }); } },
  T1: { stage: 'open', op: 'monitor', mid: last * 1.05, inTx: [['monitor.state'], ['monitor.stop'], ...EXIT_TX, ['monitor.precommit']], committed: 'monitor.committed', fresh: monitorDone, replay: monitorDone,
    applied: (s) => {
      expect(purposes(s)).toEqual(['EXIT_TARGET']);
      const p = pos(s); expect(p.status).toBe('OPEN'); expect(p.qty).toBeCloseTo(p.targets.qtyInit / 2, 9); expect(p.stop).toBeGreaterThanOrEqual(p.entry!);
      expect(p.targets.targets.map((t: { done: boolean }) => t.done)).toEqual([true, false]);
    } },
  T1_T2: { stage: 'open', op: 'monitor', mid: last * 1.1, committed: 'monitor.committed', fresh: monitorDone, replay: monitorDone,
    inTx: [['monitor.state'], ['exit.order', 1], ['exit.stop', 1], ['exit.order', 2], ['exit.fill', 2], ['exit.sell', 2], ['exit.position', 2], ['exit.stop', 2], ['monitor.precommit']],
    applied: (s) => { expect(purposes(s)).toEqual(['EXIT_TARGET', 'EXIT_TARGET']); expect(pos(s)).toMatchObject({ status: 'CLOSED', qty: 0, exitReason: 'TARGET' }); } },
  TRAIL: { stage: 'open', op: 'monitor', mid: last * 1.035, inTx: [['monitor.state'], ['monitor.stop'], ['monitor.precommit']], committed: 'monitor.committed', fresh: monitorDone, replay: monitorDone,
    applied: (s) => {
      expect(purposes(s)).toEqual([]); const p = pos(s); expect(p.status).toBe('OPEN'); expect(p.stop).toBe(p.entry);
      expect(s.orders.find((o) => o.purpose === 'PROTECTIVE_STOP')).toMatchObject({ status: 'ACTIVE', stop: p.entry });
    } },
  TIME: { stage: 'aged', op: 'monitor', inTx: [['monitor.state'], ['exit.order'], ['exit.sell'], ['exit.position'], ['exit.stop'], ['monitor.precommit']], committed: 'monitor.committed', fresh: monitorDone, replay: monitorDone,
    applied: (s) => { expect(purposes(s)).toEqual(['EXIT_TIME']); expect(pos(s)).toMatchObject({ status: 'CLOSED', qty: 0, exitReason: 'TIME' }); } },
  MANUAL: { stage: 'open', op: 'close', inTx: [...EXIT_TX, ['exit.precommit']], committed: 'exit.committed', fresh: closed, replay: refused,
    applied: (s) => { expect(purposes(s)).toEqual(['EXIT_MANUAL_CLOSE']); expect(pos(s)).toMatchObject({ status: 'CLOSED', qty: 0, exitReason: 'MANUAL_CLOSE' }); } },
});

const caseDir = (stage: Stage) => newCaseDir(templates.get(stage)!.db);
const describeChild = (o: ChildOutcome) => `code=${o.code} signal=${o.signal}\nstdout: ${o.stdout.slice(-800)}\nstderr: ${o.stderr.slice(-1500)}`;
/** A restart: a new connection replays the WAL; SQLite and the accounting must both be clean. */
function restart<T>(db: string, read: () => T): T {
  return withDb(db, () => {
    expect(sqliteHealth()).toEqual({ integrity: ['ok'], foreignKeys: [] });
    expect(checkInvariants()).toEqual([]);
    return read();
  });
}
async function completes(req: ChildRequest) {
  const o = await runChild(req);
  expect(o.code, describeChild(o)).toBe(0); expect(o.signal).toBeNull(); expect(o.marker).toBeNull();
  return o.result;
}
async function killedAt(req: ChildRequest & { crashAt: CrashPoint }) {
  const o = await runChild(req);
  if (process.platform === 'win32') {
    // Windows reports a self-termination via SIGKILL as exit code 1 without a signal.
    expect(o, describeChild(o)).toMatchObject({ code: 1, signal: null });
  } else {
    expect(o.signal, describeChild(o)).toBe('SIGKILL');
  }
  expect(o.marker).toMatchObject({ at: req.crashAt, occurrence: req.occurrence ?? 1 });
  expect(o.result).toBeUndefined();
}

const stages: Stage[] = ['fresh', 'pending', 'open', 'aged'];
let S: Record<string, Scenario> = {};
beforeAll(async () => {
  for (const st of stages) templates.set(st, buildStage(st));
  S = scenarios(templates.get('open')!.last);
  await Promise.all(Object.entries(S).map(async ([name, sc]) => {
    const { db } = caseDir(sc.stage);
    sc.fresh(await completes({ db, op: sc.op, mid: sc.mid }));
    const s = restart(db, shape); sc.applied(s); controls.set(name, s);
  }));
}, 60_000);
afterAll(removeCaseDirs);

/**
 * Every in-transaction checkpoint must restore the stage byte for byte. Once that holds, a retry starts from exactly the
 * stage the control ran from, so the retry child runs on the last checkpoint of each scenario (most work rolled back)
 * rather than on every one, which keeps the suite within its time budget.
 */
describe.concurrent('SIGKILL before COMMIT rolls back to the stage, and a retry applies once', () => {
  const names = ['ENTRY', 'APPROVAL', 'STOP', 'T1', 'T1_T2', 'TRAIL', 'TIME', 'MANUAL'];
  const cases = names.flatMap((name) => scenarios(1)[name].inTx.map(([at, occurrence], i, list) => ({ name, at, occurrence: occurrence ?? 1, retry: i === list.length - 1 })));
  it.each(cases)('$name at $at #$occurrence', async ({ name, at, occurrence, retry }) => {
    const sc = S[name]; const { db } = caseDir(sc.stage);
    const before = withDb(db, rawState);
    await killedAt({ db, op: sc.op, mid: sc.mid, crashAt: at, occurrence });
    expect(restart(db, rawState)).toEqual(before);
    if (!retry) return;
    sc.fresh(await completes({ db, op: sc.op, mid: sc.mid }));
    expect(restart(db, shape)).toEqual(controls.get(name));
  });
});

describe.concurrent('SIGKILL after COMMIT keeps the effect, and a retry is a no-op', () => {
  it.each(['ENTRY', 'APPROVAL', 'STOP', 'T1', 'T1_T2', 'TRAIL', 'TIME', 'MANUAL'])('%s', async (name) => {
    const sc = S[name]; const { db } = caseDir(sc.stage);
    await killedAt({ db, op: sc.op, mid: sc.mid, crashAt: sc.committed });
    expect(restart(db, shape)).toEqual(controls.get(name));
    sc.replay(await completes({ db, op: sc.op, mid: sc.mid }));
    expect(restart(db, shape)).toEqual(controls.get(name));
  });
});

describe.concurrent('concurrent processes apply an operation once', () => {
  const t1 = () => templates.get('open')!.last * 1.05;
  it('a child whose barrier is never released exits nonzero instead of running the operation', async () => {
    const { db } = caseDir('open');
    const o = await runChild({ db, op: 'monitor', mid: t1(), barrier: 'monitor.preTx', barrierMs: 200 });
    expect(o.code, describeChild(o)).toBe(BARRIER_TIMEOUT); expect(o.result).toBeUndefined();
    expect(restart(db, () => all('SELECT * FROM protection_incidents'))).toEqual([]);
  });
  it('two monitors racing on the same T1 sell it once', async () => {
    const { dir, db } = caseDir('open');
    const req: ChildRequest = { db, op: 'monitor', mid: t1(), barrier: 'monitor.preTx' };
    const both = Promise.all([runChild(req), runChild(req)]);
    await releaseBarrier(dir, 2);
    for (const o of await both) expect(o.code, describeChild(o)).toBe(0);
    expect(restart(db, shape)).toEqual(controls.get('T1'));
    expect(withDb(db, () => all("SELECT * FROM protection_incidents WHERE status='OPEN'"))).toEqual([]);
  });
  it('a monitor holding a stale snapshot does not touch a position the owner closed meanwhile', async () => {
    const { dir, db } = caseDir('open');
    const monitor = runChild({ db, op: 'monitor', mid: t1(), barrier: 'monitor.preTx', go: 'go-monitor' });
    await awaitParked(dir, 1);
    closed(await completes({ db, op: 'close', mid: t1() }));
    const afterClose = withDb(db, shape);
    await releaseBarrier(dir, 1, 'go-monitor');
    const o = await monitor; expect(o.code, describeChild(o)).toBe(0);
    expect(restart(db, shape)).toEqual(afterClose);
    expect(purposes(afterClose)).toEqual(['EXIT_MANUAL_CLOSE']);
    expect(withDb(db, () => all("SELECT * FROM protection_incidents WHERE status='OPEN'"))).toEqual([]);
  });
  it('two manual closes book one exit', async () => {
    const { dir, db } = caseDir('open');
    const req: ChildRequest = { db, op: 'close', barrier: 'exit.preTx' };
    const both = Promise.all([runChild(req), runChild(req)]);
    await releaseBarrier(dir, 2);
    const results = (await both).map((o) => { expect(o.code, describeChild(o)).toBe(0); return o.result as { closed?: boolean; error?: string }; });
    expect(results.filter((r) => r.closed)).toHaveLength(1); expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(purposes(restart(db, shape))).toEqual(['EXIT_MANUAL_CLOSE']);
  });
  it('two entries for one decision fill once; the loser reports DUPLICATE', async () => {
    const { dir, db } = caseDir('fresh');
    const req: ChildRequest = { db, op: 'enter', barrier: 'entry.preTx' };
    const both = Promise.all([runChild(req), runChild(req)]);
    await releaseBarrier(dir, 2);
    const results = (await both).map((o) => { expect(o.code, describeChild(o)).toBe(0); return o.result as { ok: boolean; reason?: string }; });
    expect(results.filter((r) => r.ok)).toHaveLength(1); expect(results.find((r) => !r.ok)?.reason).toMatch(/^DUPLICATE:/);
    expect(restart(db, () => get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE purpose='ENTRY'")!.n)).toBe(1);
  });
});
