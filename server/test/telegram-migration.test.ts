import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrations.js';

describe('Telegram migrations', () => {
  it.each([5, 7])('preserves data and applied migrations when upgrading from v%i', (version) => {
    const db = new DatabaseSync(':memory:');
    try {
      migrate(db, version);
      if (version === 5) db.exec('ALTER TABLE schema_migrations DROP COLUMN checksum');
      db.prepare('INSERT INTO runtime_leases VALUES (?, ?, ?, ?, ?)').run('engine', 'test', 1, 2, 3);
      if (version === 7) {
        db.prepare('INSERT INTO ditas_blobs VALUES (?, ?, ?, ?)').run('fixture', 'book', 1, '{}');
      }
      const columns = version === 5 ? 'version, applied_at' : '*';
      const applied = db.prepare(`SELECT ${columns} FROM schema_migrations WHERE version <= ? ORDER BY version`);
      const before = applied.all(version);

      migrate(db);
      expect(applied.all(version)).toEqual(before);
      expect(db.prepare('SELECT holder FROM runtime_leases WHERE name = ?').get('engine')).toEqual({ holder: 'test' });
      if (version === 7) {
        expect(db.prepare('SELECT payload FROM ditas_blobs WHERE hash = ?').get('fixture')).toEqual({ payload: '{}' });
      }
      expect(db.prepare('SELECT version FROM schema_migrations WHERE version = 8').get()).toEqual({ version: 8 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'telegram_%' ORDER BY name").all())
        .toEqual([{ name: 'telegram_links' }, { name: 'telegram_outbox' }, { name: 'telegram_update_dedupe' }]);

      db.prepare('INSERT INTO telegram_update_dedupe VALUES (?, ?)').run(123, 456);
      migrate(db);
      expect(db.prepare('SELECT received_at FROM telegram_update_dedupe WHERE update_id = 123').get())
        .toEqual({ received_at: 456 });
    } finally {
      db.close();
    }
  });

  it('invalidates legacy queued replies when adding link authorization', () => {
    const db = new DatabaseSync(':memory:');
    try {
      migrate(db, 8);
      const v8 = db.prepare('SELECT checksum FROM schema_migrations WHERE version = 8');
      const checksum = v8.get();
      const insert = db.prepare('INSERT INTO telegram_outbox(id, chat_id, text, status, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      insert.run('queued', 123, 'Legacy account reply', 'QUEUED', 1, 1, 1);
      insert.run('sent', 123, 'Already accepted', 'PROVIDER_ACCEPTED', 1, 1, 1);

      migrate(db);
      expect(v8.get()).toEqual(checksum);
      expect(db.prepare('SELECT id, link_id, status, text FROM telegram_outbox ORDER BY id').all()).toEqual([
        { id: 'queued', link_id: null, status: 'FAILED', text: '' },
        { id: 'sent', link_id: null, status: 'PROVIDER_ACCEPTED', text: 'Already accepted' },
      ]);
    } finally {
      db.close();
    }
  });
});
