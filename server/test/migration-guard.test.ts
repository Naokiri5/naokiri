import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate, migrationChecksum, migrationObjects, MigrationMismatchError, SCHEMA_VERSION } from '../src/db/migrations.js';

/**
 * SAFE-02 (ticket #93): PR #18 owns v6 (ditas_blobs) and v7 (indexes); draft PR #20 also used v6 for Telegram tables.
 * A database migrated by such a build must make this build REFUSE to start, never silently skip its own v6.
 */
const TELEGRAM_V6 = `CREATE TABLE telegram_links (id TEXT PRIMARY KEY, status TEXT NOT NULL);
  CREATE TABLE telegram_update_dedupe (update_id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL);`;
const versions = (db: DatabaseSync) => db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string | null }[];
const has = (db: DatabaseSync, name: string) => !!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name);

describe('migration identity guard (SAFE-02)', () => {
  it('a fresh database records a checksum per version and re-running is a no-op', () => {
    const db = new DatabaseSync(':memory:'); migrate(db); migrate(db);
    const v = versions(db);
    expect(v).toHaveLength(SCHEMA_VERSION); expect(v.every((r) => /^[0-9a-f]{64}$/.test(r.checksum!))).toBe(true);
  });

  it('a database from before checksums existed upgrades normally and gets checksums backfilled', () => {
    const db = new DatabaseSync(':memory:'); migrate(db, 5);
    db.exec('ALTER TABLE schema_migrations DROP COLUMN checksum'); // as written by builds before SAFE-02
    migrate(db);
    expect(versions(db).map((r) => r.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
    expect(versions(db).every((r) => !!r.checksum)).toBe(true);
    expect(has(db, 'ditas_blobs')).toBe(true);
  });

  it('a database whose v6 was created by another branch (no checksum) is refused, and nothing is changed', () => {
    const db = new DatabaseSync(':memory:'); migrate(db, 5);
    db.exec('ALTER TABLE schema_migrations DROP COLUMN checksum');
    db.exec(TELEGRAM_V6); db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (6, 1)').run(); // old PR #20 build
    expect(() => migrate(db)).toThrow(MigrationMismatchError);
    expect(() => migrate(db)).toThrow(/v6 .*missing \(ditas_blobs/);
    expect(has(db, 'ditas_blobs')).toBe(false); expect(has(db, 'telegram_links')).toBe(true); // untouched
    expect(Math.max(...versions(db).map((r) => r.version))).toBe(6);  // was: silently "migrated" with v6 skipped
  });

  it('a recorded checksum from different migration code is refused', () => {
    const db = new DatabaseSync(':memory:'); migrate(db, 5);
    db.exec(TELEGRAM_V6); db.prepare('INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (6, 1, ?)').run(migrationChecksum(TELEGRAM_V6));
    expect(() => migrate(db)).toThrow(/different migration code/);
  });

  it('a database newer than this build is refused instead of being run by older code', () => {
    const db = new DatabaseSync(':memory:'); migrate(db);
    db.prepare('INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (?, 1, ?)').run(SCHEMA_VERSION + 1, 'x');
    expect(() => migrate(db)).toThrow(/newer than this build/);
  });

  it('object extraction finds tables, indexes and triggers', () => {
    expect(migrationObjects("CREATE TABLE a (x); CREATE UNIQUE INDEX IF NOT EXISTS b ON a(x); CREATE TRIGGER c BEFORE DELETE ON a BEGIN SELECT 1; END;")).toEqual(['a', 'b', 'c']);
  });
});
