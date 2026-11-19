/**
 * Backup command line (works while the server runs: the snapshot is a consistent read).
 *   create             write a backup to MIA_BACKUP_DIR (default <data>/backups), verify it, prune to MIA_BACKUP_KEEP
 *   verify <file>      restore check of one backup file (exit 1 if any check fails)
 *   list               list complete backups, newest first
 * Encryption key (optional): MIA_BACKUP_KEY in the environment — never on the command line, where it would be logged.
 */
import { join } from 'node:path';
import { backupDir, backupKey, createBackup, listBackups, liveDatabasePath, pruneBackups, verifyBackup } from './backup.js';
import { closeDb } from '../db/db.js';

const [cmd, arg] = process.argv.slice(2);
function print(v: ReturnType<typeof verifyBackup>) {
  for (const c of v.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
  console.log(v.ok ? `Restore check passed: ${v.file}` : `Restore check FAILED: ${v.file}`);
}
try {
  if (cmd === 'create') {
    console.log(`Database: ${liveDatabasePath()}`); // throws before anything opens (and creates) a wrong, empty database
    if (!backupKey()) console.warn('⚠ MIA_BACKUP_KEY is not set in this shell: this backup will be PLAINTEXT. The service reads it from /etc/mia/mia.env.');
    const m = createBackup(); const v = verifyBackup(join(backupDir(), m.file)); print(v);
    const removed = pruneBackups(); if (removed.length) console.log(`Pruned ${removed.length} old backup(s).`);
    process.exitCode = v.ok ? 0 : 1;
  } else if (cmd === 'verify' && arg) { const v = verifyBackup(arg); print(v); process.exitCode = v.ok ? 0 : 1; }
  else if (cmd === 'list') { for (const m of listBackups()) console.log(`${new Date(m.createdAt).toISOString()}  ${m.file}  ${m.bytes} bytes  schema v${m.schema}${m.encrypted ? '  encrypted' : ''}`); }
  else { console.error('usage: backup create | verify <file> | list'); process.exitCode = 2; }
} catch (e: any) { console.error(`✖ ${e?.message ?? e}`); process.exitCode = 1; }
finally { closeDb(); }
