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
  /* 6 — BrainOS 6.1: durable session checkpoints and advisory research; no second OMS, risk engine or ledger. */ `
  CREATE TABLE brainos_sessions (
    session_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL,
    environment TEXT NOT NULL, mind TEXT NOT NULL, lease_holder TEXT,
    lease_acquired_at INTEGER, fence_epoch INTEGER NOT NULL,
    suspend_reason TEXT NOT NULL, started_at INTEGER, closed_at INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE TABLE brainos_session_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES brainos_sessions(session_id),
    version INTEGER NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL,
    kind TEXT NOT NULL, fence_epoch INTEGER NOT NULL, ts INTEGER NOT NULL,
    UNIQUE(session_id,version)
  );
  CREATE INDEX brainos_session_events_lookup ON brainos_session_events(session_id,seq);
  CREATE TABLE flin_launch_candidates (
    candidate_id TEXT PRIMARY KEY, mint_address TEXT NOT NULL, pair_address TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, source_as_of INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('QUARANTINED','REJECTED')),
    reason TEXT NOT NULL, evidence_json TEXT NOT NULL
  );
  CREATE INDEX flin_launch_recent ON flin_launch_candidates(last_seen_at);
  CREATE TABLE deep_postclose_decisions (
    decision_id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, thesis_lineage_id TEXT NOT NULL,
    close_reason TEXT NOT NULL, decision TEXT NOT NULL, next_state TEXT NOT NULL,
    evaluated_at INTEGER NOT NULL, ledger_reconciled INTEGER NOT NULL CHECK(ledger_reconciled IN (0,1)),
    reason TEXT NOT NULL, UNIQUE(bundle_id,decision_id)
  );
  `,
  /* 7 — BrainOS trading mandate: the owner-authorized market scope, capital ceiling, policy and strategy versions
     and expiry of a session. Existing rows keep NULL mandates and therefore cannot authorize new entries. */ `
  ALTER TABLE brainos_sessions ADD COLUMN market_scope TEXT;
  ALTER TABLE brainos_sessions ADD COLUMN capital_ceiling REAL;
  ALTER TABLE brainos_sessions ADD COLUMN risk_policy_version INTEGER;
  ALTER TABLE brainos_sessions ADD COLUMN authorized_by TEXT;
  ALTER TABLE brainos_sessions ADD COLUMN authorized_at INTEGER;
  ALTER TABLE brainos_sessions ADD COLUMN expires_at INTEGER;
  ALTER TABLE brainos_sessions ADD COLUMN strategy_config_version TEXT;
  ALTER TABLE brainos_session_events ADD COLUMN mandate_json TEXT;
  `,
  /* 8 — DITAS content-addressed blobs: candle history in snapshots is stored once per aligned chunk and referenced by
     hash, instead of being copied into every snapshot (about 220 KB each). Existing v1 snapshots are untouched. */ `
  CREATE TABLE ditas_blobs (hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, bytes INTEGER NOT NULL, payload TEXT NOT NULL);
  `,
];

/** `target` lets upgrade tests stop at an older schema version; production always migrates to the latest. */
export function migrate(db: DatabaseSync, target = MIGRATIONS.length) {
  // Read the schema version under the write lock so simultaneous starters cannot both apply the same migration.
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const row = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null };
    for (let i = row.v ?? 0; i < Math.min(target, MIGRATIONS.length); i++) {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(i + 1, Date.now());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const SCHEMA_VERSION = MIGRATIONS.length;
