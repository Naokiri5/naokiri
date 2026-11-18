import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Ordered, append-only migrations. Never edit a shipped migration — add a new one. */
const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL,
    action TEXT NOT NULL, detail TEXT, prev_hash TEXT, hash TEXT NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE risk_policy_versions (version INTEGER PRIMARY KEY, policy TEXT NOT NULL, created_at INTEGER NOT NULL,
    accepted_by TEXT NOT NULL);
  CREATE TABLE consensus_records (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, instrument TEXT NOT NULL,
    state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, record TEXT NOT NULL);
  CREATE TABLE decisions (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, instrument TEXT NOT NULL, market TEXT NOT NULL,
    direction TEXT NOT NULL, strategy TEXT NOT NULL, decision TEXT NOT NULL, score REAL, risk_decision TEXT,
    consensus_id TEXT, created_at INTEGER NOT NULL, report TEXT NOT NULL);
  CREATE INDEX decisions_ts ON decisions(created_at);
  CREATE TABLE orders (id TEXT PRIMARY KEY, client_order_id TEXT UNIQUE NOT NULL, account TEXT NOT NULL, venue TEXT NOT NULL,
    instrument TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL, qty REAL NOT NULL, limit_price REAL, stop_price REAL,
    status TEXT NOT NULL, purpose TEXT NOT NULL, position_id TEXT, decision_id TEXT, filled_qty REAL NOT NULL DEFAULT 0,
    avg_price REAL, fees REAL NOT NULL DEFAULT 0, reject_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE fills (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), qty REAL NOT NULL, price REAL NOT NULL,
    fee REAL NOT NULL, liquidity TEXT NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE positions (id TEXT PRIMARY KEY, account TEXT NOT NULL, instrument TEXT NOT NULL, market TEXT NOT NULL,
    direction TEXT NOT NULL, strategy TEXT NOT NULL, qty REAL NOT NULL, entry_price REAL NOT NULL, stop_price REAL NOT NULL,
    initial_stop REAL NOT NULL, targets TEXT NOT NULL, status TEXT NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER,
    exit_price REAL, realized_pnl REAL NOT NULL DEFAULT 0, fees REAL NOT NULL DEFAULT 0, max_hold_ms INTEGER,
    decision_id TEXT, exit_reason TEXT, planned_risk REAL NOT NULL, mfe REAL NOT NULL DEFAULT 0, mae REAL NOT NULL DEFAULT 0);
  CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, account TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
    amount REAL NOT NULL, ref TEXT, note TEXT);
  CREATE INDEX ledger_acct_ts ON ledger_entries(account, ts);
  CREATE TABLE journal (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT, summary TEXT NOT NULL, detail TEXT);
  CREATE INDEX journal_ts ON journal(ts);
  CREATE TABLE news (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, fetched_at INTEGER NOT NULL, title TEXT NOT NULL,
    source TEXT, url TEXT, query TEXT, impact TEXT NOT NULL, assets TEXT NOT NULL, credibility TEXT NOT NULL);
  CREATE TABLE notifications (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT, source TEXT, read INTEGER NOT NULL DEFAULT 0, delivery TEXT NOT NULL);
  CREATE TABLE address_book (id TEXT PRIMARY KEY, label TEXT NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL,
    memo TEXT, created_at INTEGER NOT NULL, verified_at INTEGER, cooldown_until INTEGER NOT NULL);
  CREATE TABLE withdrawal_requests (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, network TEXT NOT NULL, asset TEXT NOT NULL,
    amount REAL NOT NULL, address_id TEXT NOT NULL, status TEXT NOT NULL, reasons TEXT NOT NULL);
  CREATE TABLE strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL,
    params TEXT NOT NULL, updated_at INTEGER NOT NULL, note TEXT);
  CREATE TABLE backtests (id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, created_at INTEGER NOT NULL, instrument TEXT NOT NULL,
    interval TEXT NOT NULL, result TEXT NOT NULL);
  CREATE TABLE worker_stats (worker_id TEXT PRIMARY KEY, support INTEGER NOT NULL DEFAULT 0, oppose INTEGER NOT NULL DEFAULT 0,
    abstain INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0,
    incorrect INTEGER NOT NULL DEFAULT 0, quarantined INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  CREATE TABLE chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
  `,
  /* 2 — DITAS immutable research memory; existing execution tables remain authoritative. */ `
  CREATE TABLE ditas_snapshots (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, instrument TEXT NOT NULL, payload TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE ditas_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, dedupe_key TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL, kind TEXT NOT NULL, instrument TEXT NOT NULL, strategy TEXT, decision_id TEXT,
    snapshot_id TEXT REFERENCES ditas_snapshots(id), parent_event_id TEXT REFERENCES ditas_events(id), payload TEXT NOT NULL,
    prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE INDEX ditas_events_ts ON ditas_events(created_at);
  CREATE INDEX ditas_events_decision ON ditas_events(decision_id);
  CREATE TABLE ditas_twin_runs (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES ditas_events(id), created_at INTEGER NOT NULL, result TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE ditas_forecasts (id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, event_id TEXT NOT NULL REFERENCES ditas_events(id), created_at INTEGER NOT NULL,
    target_at INTEGER NOT NULL, probability REAL NOT NULL CHECK(probability>=0 AND probability<=1), cohort TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE ditas_outcomes (id TEXT PRIMARY KEY, forecast_id TEXT UNIQUE NOT NULL REFERENCES ditas_forecasts(id), created_at INTEGER NOT NULL,
    outcome INTEGER NOT NULL CHECK(outcome IN (0,1)), payload TEXT NOT NULL);
  ${['ditas_snapshots', 'ditas_events', 'ditas_twin_runs', 'ditas_forecasts', 'ditas_outcomes'].map(table => `
  CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'DITAS records are immutable'); END;
  CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'DITAS records are immutable'); END;`).join('')}
  `,
  /* 3 — Quantitative Trading Intelligence Academy: knowledge store, taxonomy, research experiments, candle history.
     Sources are never overwritten: re-processing replaces derived chunks only and is recorded in kb_document_events. */ `
  CREATE TABLE kb_documents (id TEXT PRIMARY KEY, sha256 TEXT UNIQUE NOT NULL, filename TEXT NOT NULL, format TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, title TEXT, authors TEXT, edition TEXT, publisher TEXT, published TEXT, discipline TEXT,
    catalog_id TEXT, evidence_class TEXT NOT NULL DEFAULT 'AUTHOR_INTERPRETATION', status TEXT NOT NULL, error TEXT,
    pages INTEGER, unreadable_pages TEXT NOT NULL DEFAULT '[]', text_hash TEXT, duplicate_of TEXT,
    progress TEXT NOT NULL DEFAULT '{}', extractor_version TEXT, uploaded_at INTEGER NOT NULL, processed_at INTEGER);
  CREATE TABLE kb_document_files (document_id TEXT PRIMARY KEY REFERENCES kb_documents(id), bytes BLOB NOT NULL);
  CREATE TABLE kb_document_events (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL, ts INTEGER NOT NULL, event TEXT NOT NULL, detail TEXT);
  CREATE TABLE kb_chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES kb_documents(id), seq INTEGER NOT NULL,
    chapter TEXT, heading TEXT, page_start INTEGER, page_end INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL,
    tokens INTEGER NOT NULL, extractor_version TEXT NOT NULL, UNIQUE(document_id, seq));
  CREATE INDEX kb_chunks_hash ON kb_chunks(hash);
  CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(text, heading, chunk_id UNINDEXED, tokenize='porter unicode61');
  CREATE TABLE kb_embeddings (chunk_id TEXT PRIMARY KEY REFERENCES kb_chunks(id), provider TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL);
  CREATE TABLE kb_catalog (id TEXT PRIMARY KEY, title TEXT NOT NULL, authors TEXT NOT NULL, discipline TEXT NOT NULL, priority INTEGER,
    document_id TEXT, notes TEXT, added_at INTEGER NOT NULL, UNIQUE(title, authors));
  CREATE TABLE kb_concepts (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, discipline TEXT NOT NULL, origin TEXT NOT NULL,
    evidence_class TEXT NOT NULL, card TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE kb_concept_sources (concept_id TEXT NOT NULL REFERENCES kb_concepts(id), chunk_id TEXT NOT NULL REFERENCES kb_chunks(id),
    relation TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY(concept_id, chunk_id));
  CREATE TABLE kb_claims (id TEXT PRIMARY KEY, concept_id TEXT NOT NULL REFERENCES kb_concepts(id), proposition TEXT NOT NULL,
    stance TEXT NOT NULL CHECK(stance IN ('SUPPORTS','CONTRADICTS','QUALIFIES')), evidence_class TEXT NOT NULL,
    chunk_id TEXT REFERENCES kb_chunks(id), document_id TEXT, page INTEGER, quote TEXT, origin TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE research_experiments (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, kind TEXT NOT NULL, concept_id TEXT,
    hypothesis TEXT NOT NULL, spec TEXT NOT NULL, dataset TEXT NOT NULL, data_hash TEXT NOT NULL, results TEXT NOT NULL,
    verdict TEXT NOT NULL, limitations TEXT NOT NULL, code_version TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TRIGGER research_experiments_no_update BEFORE UPDATE ON research_experiments BEGIN SELECT RAISE(ABORT, 'research experiments are immutable'); END;
  CREATE TABLE research_candles (instrument TEXT NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL, o REAL NOT NULL, h REAL NOT NULL,
    l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, close_time INTEGER, source TEXT NOT NULL, fetched_at INTEGER NOT NULL,
    PRIMARY KEY(instrument, interval, t));
  `,
  // v4 — persistent protection incidents: a paper position that cannot be exited (stale/missing/thin market data)
  // stays visible across restarts until the owner acknowledges it.
  `
  CREATE TABLE protection_incidents (id TEXT PRIMARY KEY, position_id TEXT NOT NULL, instrument TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN','RECOVERED','ACKNOWLEDGED')), reason TEXT NOT NULL,
    opened_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, last_notified_at INTEGER NOT NULL, occurrences INTEGER NOT NULL,
    recovered_at INTEGER, acknowledged_at INTEGER, acknowledged_by TEXT, ack_note TEXT);
  CREATE UNIQUE INDEX protection_incidents_one_active ON protection_incidents(position_id) WHERE status IN ('OPEN','RECOVERED');
  CREATE INDEX protection_incidents_instrument ON protection_incidents(instrument, status);
  `,
  // v5 — renewable runtime leases: only the instance holding 'engine' runs the scheduler lanes, so two processes on
  // the same database (a restart overlap, an accidental second copy) can never both scan or manage paper positions.
  `
  CREATE TABLE runtime_leases (name TEXT PRIMARY KEY, holder TEXT NOT NULL, acquired_at INTEGER NOT NULL,
    renewed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `,
  // v6 — DITAS store-once market data (owner-approved 2026-11-18). Candle windows and order books are stored once,
  // keyed by the sha256 of their canonical JSON, and snapshots reference them as {"$blob": hash}. Measured before:
  // every event stored a full 223 KB snapshot (~394 MB/day). Blobs are immutable like every other DITAS table; older
  // v1 snapshots are left exactly as written.
  `
  CREATE TABLE ditas_blobs (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE TRIGGER ditas_blobs_no_update BEFORE UPDATE ON ditas_blobs BEGIN SELECT RAISE(ABORT, 'DITAS records are immutable'); END;
  CREATE TRIGGER ditas_blobs_no_delete BEFORE DELETE ON ditas_blobs BEGIN SELECT RAISE(ABORT, 'DITAS records are immutable'); END;
  `,
  // v7 — indexes for hot filters (master audit MA-15/MA-24). Additive only: no table, row or trigger changes.
  //  - unread notification count on every /api/shell poll (was a full scan);
  //  - failed-login count in the security center (audit_log is hash-chained and append-only, so it only grows);
  //  - DITAS child-event lookups by parent.
  `
  CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read) WHERE read = 0;
  CREATE INDEX IF NOT EXISTS idx_audit_action_ts ON audit_log(action, ts);
  CREATE INDEX IF NOT EXISTS idx_ditas_events_parent ON ditas_events(parent_event_id);
  `,
];

const OBJECT_RE = /CREATE\s+(?:UNIQUE\s+)?(?:VIRTUAL\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
/** Names of the tables, indexes, triggers and views a migration creates (migrations never drop or rename). */
export function migrationObjects(sql: string): string[] { return [...sql.matchAll(OBJECT_RE)].map((m) => m[1]); }
export const migrationChecksum = (sql: string) => createHash('sha256').update(sql.replace(/\s+/g, ' ').trim()).digest('hex');
export class MigrationMismatchError extends Error {}

/**
 * SAFE-02 (ticket #93): refuse to run on a database whose recorded schema version N was produced by DIFFERENT
 * migration code — e.g. a branch that reused version 6 for other tables. Without this, migrate() would see "6
 * applied", skip this build's v6 and run with tables missing. Checks, for every applied version:
 *  - the recorded checksum (stored since SAFE-02) equals this build's migration text;
 *  - every object this build's migration creates exists (also covers databases from before checksums existed).
 * A database newer than this build (unknown versions) is refused too: running old code on it is unsafe.
 */
function verifyApplied(db: DatabaseSync, current: number) {
  if (current > MIGRATIONS.length) throw new MigrationMismatchError(`database schema v${current} is newer than this build (v${MIGRATIONS.length}); refusing to start. Use the build that created it, or restore a matching backup.`);
  const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string | null }[];
  const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name));
  for (const r of rows) {
    const sql = MIGRATIONS[r.version - 1];
    if (r.checksum && r.checksum !== migrationChecksum(sql)) throw new MigrationMismatchError(`schema v${r.version} in this database was created by different migration code than this build's v${r.version}; refusing to start (no table was skipped or modified). Restore a backup made by this build, or reconcile the branches that both used v${r.version}.`);
    const missing = migrationObjects(sql).filter((n) => !existing.has(n));
    if (missing.length) throw new MigrationMismatchError(`schema v${r.version} is recorded as applied but its objects are missing (${missing.slice(0, 5).join(', ')}): this database was migrated by a different build that reused v${r.version}. Refusing to start; nothing was changed.`);
  }
  // Databases from before SAFE-02 passed the structural check above: record this build's checksums for the future.
  const fill = db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=? AND checksum IS NULL');
  for (const r of rows) if (!r.checksum) fill.run(migrationChecksum(MIGRATIONS[r.version - 1]), r.version);
}

/** `target` lets upgrade tests stop at an older schema version; production always migrates to the latest. */
export function migrate(db: DatabaseSync, target = MIGRATIONS.length) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const cols = (db.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('checksum')) db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT'); // migration-ledger metadata only
  const row = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null };
  const current = row?.v ?? 0;
  verifyApplied(db, current);
  for (let i = current; i < Math.min(target, MIGRATIONS.length); i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (?, ?, ?)').run(i + 1, Date.now(), migrationChecksum(MIGRATIONS[i]));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
export const SCHEMA_VERSION = MIGRATIONS.length;
