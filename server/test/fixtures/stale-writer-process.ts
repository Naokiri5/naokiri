/**
 * Stale-writer fixture (blueprint L-01). Takes the engine lease once, then deliberately stops renewing, as a process
 * paused mid-lane would. On each "write" line from stdin it performs a fenced engine write WITHOUT re-checking the lease
 * first (the window between the lane's lease check and its write). The fence inside the write transaction must refuse
 * it once another instance holds the lease.
 */
import { createInterface } from 'node:readline';
import { openDb, run, tx } from '../../src/db/db.js';
import { uid } from '../../src/core/util.js';
import { botStatus, ENGINE_LEASE, _test } from '../../src/bot/bot.js';
import { withWriteFence, assertWriteFence } from '../../src/ops/lease.js';

openDb();
botStatus.running = true;
const leader = _test.holdEngine();
process.stdout.write(JSON.stringify({ id: botStatus.instanceId, ready: true, leader }) + '\n');
createInterface({ input: process.stdin }).on('line', (l) => {
  const cmd = l.trim();
  if (cmd !== 'write' && cmd !== 'renew-write') return;
  // Positive control only (CodeRabbit PR #18): renew the lease immediately before the write, so a slow parent cannot let
  // the 1.5 s lease lapse before the control runs. The stale write ('write') never renews.
  if (cmd === 'renew-write' && !_test.holdEngine()) { process.stdout.write(JSON.stringify({ wrote: false, error: 'RenewFailed' }) + '\n'); return; }
  try {
    withWriteFence(ENGINE_LEASE, botStatus.instanceId, () => tx(() => {
      assertWriteFence();
      run("INSERT INTO journal(id,ts,kind,ref,summary) VALUES (?,?,'SYSTEM',?,'stale-writer write')", uid('jr'), Date.now(), botStatus.instanceId);
    }));
    process.stdout.write(JSON.stringify({ wrote: true }) + '\n');
  } catch (e: any) { process.stdout.write(JSON.stringify({ wrote: false, error: e.constructor?.name, message: e.message }) + '\n'); }
});
