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
];

export function migrate(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null };
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(i + 1, Date.now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
export const SCHEMA_VERSION = MIGRATIONS.length;
