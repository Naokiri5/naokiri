/**
 * Two-process lease fixture: one engine copy on MIA_DATA_DIR. Every renewal cadence it runs the real holdEngine()
 * (acquire/renew, takeover integrity checks) and, only while it holds the lease, performs one engine write, exactly as
 * the lanes do. Prints one JSON line per step so the parent test can follow it.
 */
import { closeDb, openDb, run } from '../../src/db/db.js';
import { uid } from '../../src/core/util.js';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const startFile = process.env.MIA_TEST_LEASE_START_FILE;
if (startFile) {
  writeFileSync(`${startFile}-ready-${process.pid}`, '');
  const deadline = Date.now() + 15_000;
  while (!existsSync(startFile)) {
    if (Date.now() > deadline) throw new Error('lease fixture did not receive its start signal');
    await delay(5);
  }
}

openDb();
if (startFile) {
  closeDb();
  process.exit(0);
}
const { botStatus, engineLeaseTtlMs, _test } = await import('../../src/bot/bot.js');
botStatus.running = true;
const step = () => {
  const leader = _test.holdEngine();
  if (leader) run("INSERT INTO journal(id,ts,kind,ref,summary) VALUES (?,?,'SYSTEM',?,'lease-fixture write')", uid('jr'), Date.now(), botStatus.instanceId);
  process.stdout.write(JSON.stringify({ id: botStatus.instanceId, leader, role: botStatus.role, at: Date.now() }) + '\n');
};
step();
setInterval(step, Math.max(50, Math.floor(engineLeaseTtlMs() / 4)));
