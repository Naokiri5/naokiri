import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** A-01 / A-02 (100-agent audit, Squad A). */
const example = readFileSync(resolve(__dirname, '..', '..', '.env.example'), 'utf8');
describe('.env.example and setting validation', () => {
  it('no active line carries an inline comment (systemd EnvironmentFile would keep it as part of the value)', () => {
    const bad = example.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l) && /\s#/.test(l));
    expect(bad).toEqual([]);
  });
  it('documents the backup key', () => { expect(example).toMatch(/MIA_BACKUP_KEY/); });
  it('a malformed MIA_KB_MAX_UPLOAD_MB fails with a named error', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/knowledge/extract.ts').then(() => console.log('LOADED'))"], { cwd: resolve(__dirname, '..'), env: { ...process.env, MIA_KB_MAX_UPLOAD_MB: '60   # max document upload size', MIA_OFFLINE: '1' }, encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout).not.toMatch(/LOADED/);
    expect(r.stderr).toMatch(/MIA_KB_MAX_UPLOAD_MB must be an integer/);
  }, 60_000);
});
