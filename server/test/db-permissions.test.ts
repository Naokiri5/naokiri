import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb, run } from '../src/db/db.js';
import { freshDb } from './helpers.js';

/** MIA-OPS-003: the database (passphrase hash, sessions, ledger) must not be readable by other local accounts. */
const mode = (f: string) => statSync(f).mode & 0o777;
describe('database file permissions', () => {
  let dir = '';
  afterEach(() => { closeDb(); if (dir) rmSync(dir, { recursive: true, force: true }); freshDb(); });
  it('a new database and its WAL are owner-only', () => {
    dir = mkdtempSync(join(tmpdir(), 'mia-perm-')); const f = join(dir, 'mia.db');
    closeDb(); openDb(f); run("INSERT INTO settings(key,value,updated_at) VALUES('k','1',0)");
    expect(mode(f)).toBe(0o600);
    expect(mode(`${f}-wal`)).toBe(0o600);
  });
  it('tightens an existing world-readable database on open', () => {
    dir = mkdtempSync(join(tmpdir(), 'mia-perm-')); const f = join(dir, 'mia.db');
    writeFileSync(f, ''); chmodSync(f, 0o644);
    closeDb(); openDb(f);
    expect(mode(f)).toBe(0o600);
  });
});
