/**
 * Two-process lease fixture: one engine copy on MIA_DATA_DIR. Every renewal cadence it runs the real holdEngine()
 * (acquire/renew, takeover integrity checks) and, only while it holds the lease, performs one engine write, exactly as
 * the lanes do. Prints one JSON line per step so the parent test can follow it.
 */
import { openDb, run } from '../../src/db/db.js';
import { uid } from '../../src/core/util.js';
import { botStatus, engineLeaseTtlMs, _test } from '../../src/bot/bot.js';

openDb();
botStatus.running = true;
const step = () => {
  const leader = _test.holdEngine();
  if (leader) run("INSERT INTO journal(id,ts,kind,ref,summary) VALUES (?,?,'SYSTEM',?,'lease-fixture write')", uid('jr'), Date.now(), botStatus.instanceId);
  process.stdout.write(JSON.stringify({ id: botStatus.instanceId, leader, role: botStatus.role, at: Date.now() }) + '\n');
};
step();
setInterval(step, Math.max(50, Math.floor(engineLeaseTtlMs() / 4)));
