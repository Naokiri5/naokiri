import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEvidenceKey } from '../src/config.js';
import { closeDb, dbFilePath, openDb } from '../src/db/db.js';

describe.skipIf(process.platform === 'win32')('private application storage', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'mia-storage-')); });
  afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }); });

  it('creates private SQLite files and evidence without altering an existing data mount', () => {
    const mount = join(directory, 'mount');
    mkdirSync(mount);
    chmodSync(mount, 0o755);
    const path = join(mount, 'mia.db');
    expect(loadEvidenceKey(mount, '', true).source).toBe('generated');
    expect(loadEvidenceKey(mount, '', true).source).toBe('file');
    openDb(path);
    for (const file of [path, `${path}-wal`, `${path}-shm`, join(mount, 'evidence.key')]) {
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
    }
    expect(lstatSync(mount).mode & 0o777).toBe(0o755);
    closeDb();
    chmodSync(path, 0o644);
    openDb(path);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  });

  it('refuses linked or permissive evidence keys and preserves their source', () => {
    const source = join(directory, 'source');
    const keyName = join(directory, 'evidence.key');
    writeFileSync(source, `${'a'.repeat(64)}\n`, { mode: 0o600 });
    symlinkSync(source, keyName);
    expect(() => loadEvidenceKey(directory, '', true)).toThrow(/persistent evidence signing key/);
    expect(lstatSync(keyName).isSymbolicLink()).toBe(true);
    rmSync(keyName);
    writeFileSync(keyName, `${'b'.repeat(64)}\n`, { mode: 0o600 });
    chmodSync(keyName, 0o644);
    expect(() => loadEvidenceKey(directory, '', true)).toThrow(/persistent evidence signing key/);
    expect(lstatSync(keyName).mode & 0o777).toBe(0o644);
  });

  it('rejects linked databases and dangling SQLite state before opening a new database', () => {
    const source = join(directory, 'source');
    const path = join(directory, 'mia.db');
    writeFileSync(source, '', { mode: 0o600 });
    linkSync(source, path);
    expect(() => openDb(path)).toThrow(/expected a single link/);
    expect(dbFilePath()).toBeNull();
    rmSync(path);
    symlinkSync(source, `${path}-wal`);
    expect(() => openDb(path)).toThrow(/regular file without symbolic links/);
    expect(existsSync(path)).toBe(false);
    rmSync(`${path}-wal`);
    writeFileSync(`${path}-shm`, '', { mode: 0o600 });
    expect(() => openDb(path)).toThrow(/database is missing while sidecar files remain/);
    expect(existsSync(`${path}-shm`)).toBe(true);
    expect(dbFilePath()).toBeNull();
  });
});
