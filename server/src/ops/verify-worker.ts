/**
 * Worker-thread entry for the backup restore check (MA-14). verifyBackup reads and hashes every audit and DITAS row of
 * the backup; on a large database that took 0.75 s per 100k audit rows on the main thread and stalled the engine.
 * It only reads the backup file (never the live database), so it can safely run off the event loop.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { verifyBackup } from './backup.js';

const { file, keyHex, workspace } = workerData as { file: string; keyHex: string | null; workspace: string };
try { parentPort!.postMessage({ ok: true, result: verifyBackup(file, keyHex ? Buffer.from(keyHex, 'hex') : null, workspace) }); }
catch (e: any) { parentPort!.postMessage({ ok: false, error: String(e?.message ?? e) }); }
