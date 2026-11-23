/**
 * Crash-test child. Runs ONE paper-OMS operation against a file-backed DB in a fresh process, optionally SIGKILLing
 * itself at a named checkpoint (after writing a marker file) or parking at a file barrier for race tests.
 * argv[2] = JSON ChildRequest. Prints "RESULT <json>" when the operation returns.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDb, get } from '../../src/db/db.js';
import { market } from '../../src/market/store.js';
import { submitEntry, monitorPositions, decideApproval, closePosition, OmsError } from '../../src/exec/oms.js';
import { setCrashHook, type CrashPoint } from '../../src/exec/crashpoint.js';
import { seedInstrument, setBook } from '../helpers.js';
import { BARRIER_TIMEOUT, type ChildRequest } from './harness.js';

const req = JSON.parse(process.argv[2]) as ChildRequest;
const dir = dirname(req.db);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

openDb(req.db);
market.reset(); seedInstrument('BTCUSDT');
const { inst } = seedInstrument('ETHUSDT', { seed: 2 });
if (req.mid) setBook(inst.id, req.mid);

const seen = new Map<CrashPoint, number>();
setCrashHook((p) => {
  const n = (seen.get(p) ?? 0) + 1; seen.set(p, n);
  if (req.barrier === p && n === 1) {
    writeFileSync(join(dir, `ready-${process.pid}`), '');
    const deadline = Date.now() + (req.barrierMs ?? 10_000);
    while (!existsSync(join(dir, req.go ?? 'go'))) {
      if (Date.now() > deadline) { process.stderr.write(`barrier ${p} timed out\n`); process.exit(BARRIER_TIMEOUT); }
      sleep(5);
    }
  }
  if (req.crashAt === p && n === (req.occurrence ?? 1)) {
    writeFileSync(join(dir, 'crash-marker.json'), JSON.stringify({ at: p, occurrence: n, pid: process.pid }));
    try {
      process.kill(process.pid, 'SIGKILL');
    } catch (error) {
      process.stderr.write(`Failed to kill the crash-test process: ${error}\n`);
    }
    // Use a distinct code if the self-kill returned or failed, so Windows cannot mistake this for a crash.
    process.exit(76);
  }
});

function op(): unknown {
  switch (req.op) {
    case 'enter': return submitEntry(JSON.parse(readFileSync(join(dir, req.reportFile ?? 'report.json'), 'utf8')), 'bot');
    case 'approve':
      try { return decideApproval(get<{ id: string }>("SELECT id FROM orders WHERE purpose='ENTRY'")!.id, true); }
      catch (e) { if (e instanceof OmsError) return { error: e.message }; throw e; }
    case 'monitor': monitorPositions(); return null;
    case 'close':
      try { return closePosition('owner', get<{ id: string }>("SELECT id FROM positions ORDER BY opened_at LIMIT 1")!.id); }
      catch (e) { if (e instanceof OmsError) return { error: e.message }; throw e; }
  }
}
process.stdout.write(`RESULT ${JSON.stringify(op() ?? null)}\n`);
