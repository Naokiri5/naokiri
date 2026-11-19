import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { getDb, run, get } from '../src/db/db.js';

/** G-01 (100-agent audit, Squad G): INSERT OR REPLACE must not rewrite immutable DITAS rows. */
describe('DITAS rows cannot be replaced (G-01)', () => {
  beforeEach(() => { freshDb(); });
  it('INSERT OR REPLACE of an existing DITAS blob is refused and the row is unchanged', () => {
    run("INSERT INTO ditas_blobs(hash, kind, created_at, payload) VALUES ('h1','book',1,'{\"a\":1}')");
    expect(() => run("INSERT OR REPLACE INTO ditas_blobs(hash, kind, created_at, payload) VALUES ('h1','book',2,'{\"a\":999}')")).toThrow(/immutable/);
    expect(get<{ payload: string }>("SELECT payload FROM ditas_blobs WHERE hash='h1'")!.payload).toBe('{"a":1}');
  });
  it('INSERT OR IGNORE (store-once dedupe) still works', () => {
    run("INSERT INTO ditas_blobs(hash, kind, created_at, payload) VALUES ('h2','book',1,'x')");
    expect(() => run("INSERT OR IGNORE INTO ditas_blobs(hash, kind, created_at, payload) VALUES ('h2','book',2,'y')")).not.toThrow();
  });
  it('the setting is on for the app database', () => {
    expect((getDb().prepare('PRAGMA recursive_triggers').get() as any).recursive_triggers).toBe(1);
  });
});
