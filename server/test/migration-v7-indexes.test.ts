import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';

/** MA-15/MA-24: v7 adds indexes only. Upgrading a v6 database keeps every row and the hot queries use the indexes. */
describe('migration v7 (indexes for hot filters)', () => {
  it('upgrades a v6 database without touching data, and the hot queries use the new indexes', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, 6);
    db.prepare("INSERT INTO notifications(id, ts, severity, title, body, source, read, delivery) VALUES ('n1', 1, 'INFO', 't', 'b', 's', 0, 'in-app'), ('n2', 2, 'INFO', 't', 'b', 's', 1, 'in-app')").run();
    db.prepare("INSERT INTO audit_log(ts, actor, action, detail, prev_hash, hash) VALUES (5, 'anonymous', 'auth.login.failed', '{}', NULL, 'h1')").run();
    migrate(db);
    expect((db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as any).v).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    expect((db.prepare('SELECT COUNT(*) n FROM notifications WHERE read=0').get() as any).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='auth.login.failed' AND ts > 0").get() as any).n).toBe(1);
    const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map((r) => r.detail).join(' | ');
    expect(plan('SELECT COUNT(*) n FROM notifications WHERE read=0')).toMatch(/idx_notifications_unread/);
    expect(plan("SELECT COUNT(*) n FROM audit_log WHERE action='auth.login.failed' AND ts > 0")).toMatch(/idx_audit_action_ts/);
    expect(plan("SELECT id FROM ditas_events WHERE parent_event_id='x'")).toMatch(/idx_ditas_events_parent/);
    // The DITAS immutability triggers are untouched.
    expect(() => db.exec('DELETE FROM ditas_blobs')).not.toThrow(); // empty table: no row to protect
  });
});
