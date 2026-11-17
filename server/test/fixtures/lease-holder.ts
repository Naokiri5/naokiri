/** Test fixture: one process contending for the engine lease on MIA_DATA_DIR. Prints its state as JSON lines. */
import { openDb } from '../../src/db/db.js';
import { EngineLease } from '../../src/bot/lease.js';

openDb();
const lease = new EngineLease();
const report = () => process.stdout.write(JSON.stringify({ pid: process.pid, holds: lease.holds(), epoch: lease.epoch }) + '\n');
lease.tick(); report();
setInterval(() => lease.tick(), lease.renewMs);
setInterval(report, 50);
process.on('SIGTERM', () => { lease.release(); process.exit(0); });
