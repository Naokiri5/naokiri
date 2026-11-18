import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { liveDatabasePath } from '../src/ops/backup.js';

/** MA-09: a manual backup run against the wrong data directory must fail, not back up a brand-new empty database. */
describe('backup CLI refuses a data directory without a database (MA-09)', () => {
  it('liveDatabasePath throws for a directory with no mia.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-nodb-'));
    try { expect(() => liveDatabasePath(dir)).toThrow(/no MIA database/); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('`backup create` exits non-zero and creates no database or backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-nodb-'));
    try {
      // Node itself with the tsx loader (CodeRabbit PR #18): node_modules/.bin/tsx is a shell script that spawnSync cannot
      // run on native Windows.
      const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/ops/backup-cli.ts', 'create'], { cwd: resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, MIA_DATA_DIR: dir, MIA_BACKUP_KEY: '' }, timeout: 60_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/no MIA database/);
      expect(existsSync(join(dir, 'mia.db'))).toBe(false);
      expect(existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')) : []).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
