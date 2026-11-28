import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { updateControl } from '../src/core/mode.js';
import { all, closeDb, dbFilePath, get, openDb, run } from '../src/db/db.js';
import { writeFileSync } from 'node:fs';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';
import { market } from '../src/market/store.js';
import { readiness } from '../src/ops/readiness.js';
import { _storageTest, backupSpaceDenial, classifyStorage, storageBlocksEntries, storageStatus } from '../src/ops/storage.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { compactConsensusEvidence } from '../src/qci/retention.js';
import { setSetting } from '../src/core/settings.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { freshDb, seedInstrument } from './helpers.js';

const MB = 1024 * 1024;
let dir: string | undefined;
afterEach(() => { _storageTest.setProbe(null); closeDb(); market.reset(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
const fileDb = () => { dir = mkdtempSync(join(tmpdir(), 'mia-storage-')); freshDb(true, join(dir, 'mia.db')); };
const disk = (freeMb: number, totalMb = 500) => _storageTest.setProbe(() => ({ freeBytes: freeMb * MB, totalBytes: totalMb * MB }));

describe('storage capacity guard', () => {
  it('classifies free space against percentage and absolute floors', () => {
    expect(classifyStorage(100 * MB, 500 * MB)).toBe('OK');
    expect(classifyStorage(70 * MB, 500 * MB)).toBe('LOW');      // < max(15% = 75 MB, 75 MB)
    expect(classifyStorage(24 * MB, 500 * MB)).toBe('CRITICAL'); // < max(5% = 25 MB, 25 MB)
    expect(classifyStorage(400 * MB, 5_000 * MB)).toBe('LOW');   // 8% of a large volume
    expect(classifyStorage(200 * MB, 5_000 * MB)).toBe('CRITICAL');
    for (const [free, total] of [[Number.NaN, 1], [1, 0], [-1, 10]]) expect(classifyStorage(free, total)).toBe('UNKNOWN');
  });

  it('does not apply to an in-memory database', () => {
    freshDb(true);
    disk(1);
    expect(storageStatus()).toMatchObject({ level: 'NOT_APPLICABLE' });
    expect(storageBlocksEntries()).toBe(false);
  });

  it('makes the risk gate deny new exposure when the volume is critically full or unreadable', () => {
    fileDb();
    const { inst, last } = seedInstrument('ETHUSDT');
    acceptPolicy('owner', DEFAULT_POLICY);
    updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const reasons = () => evaluateRisk({ instrumentId: inst.id, strategyId: 'trend_pullback', side: 'buy', entryPrice: last,
      stopPrice: last * 0.95, idempotencyKey: 'k', traceId: 't' }).reasonCodes;
    disk(200);
    expect(reasons().some((r) => r.startsWith('STORAGE_'))).toBe(false);
    disk(10);
    expect(reasons()).toContainEqual(expect.stringMatching(/^STORAGE_CRITICAL/));
    _storageTest.setProbe(() => { throw new Error('EIO'); });
    expect(reasons()).toContainEqual(expect.stringMatching(/^STORAGE_UNKNOWN/));
    expect(readiness({ running: false, role: 'STOPPED', startedAt: 0, lastTickerAt: 0, lastScanAt: 0, lastMonitorAt: 0, monitorFailing: false } as any)
      .checks).toContainEqual(expect.objectContaining({ name: 'storage', status: 'fail' }));
  });

  it('refuses a backup that would not fit next to the live database', () => {
    expect(backupSpaceDenial({ level: 'OK', freeBytes: 100 * MB, totalBytes: 500 * MB, databaseBytes: 362 * MB, checkedAt: 1 }))
      .toMatch(/^BACKUP_INSUFFICIENT_SPACE: need \d+ MB free, have 100 MB$/);
    expect(backupSpaceDenial({ level: 'OK', freeBytes: 1_000 * MB, totalBytes: 5_000 * MB, databaseBytes: 362 * MB, checkedAt: 1 })).toBeNull();
    expect(backupSpaceDenial({ level: 'UNKNOWN', freeBytes: null, totalBytes: null, databaseBytes: null, checkedAt: 1 })).toBe('BACKUP_SPACE_UNVERIFIABLE');
    expect(backupSpaceDenial({ level: 'NOT_APPLICABLE', freeBytes: null, totalBytes: null, databaseBytes: null, checkedAt: 1 })).toBeNull();
  });
});

describe('database open failure', () => {
  it('does not report the path of a database whose setup failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-open-fail-'));
    const file = join(dir, 'mia.db');
    try {
      closeDb();
      writeFileSync(file, 'this is not a sqlite database'.repeat(100));
      expect(() => openDb(file)).toThrow();
      expect(dbFilePath()).toBeNull();
    } finally { closeDb(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('consensus evidence retention', () => {
  const HOUR = 3_600_000, NOW = Date.UTC(2026, 10, 26, 12);
  const packets = Array.from({ length: 94 }, (_, i) => ({ worker_id: `w${i}`, stance: 'SUPPORT', reason_codes: ['x'.repeat(400)] }));
  function consensus(id: string, at: number) {
    run('INSERT INTO consensus_records(id,candidate_id,instrument,state,created_at,expires_at,record) VALUES (?,?,?,?,?,?,?)',
      id, `cand-${id}`, 'crypto:binance:ETHUSDT', 'STRONG_CONSENSUS', at, at + 60_000,
      JSON.stringify({ consensus_id: id, state: 'STRONG_CONSENSUS', domains: [{ domain: 'trend', score: 1 }], vetoes: [], packets }));
  }
  function traded(consensusId: string) {
    run(`INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,consensus_id,created_at,report)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, `d-${consensusId}`, `cand-${consensusId}`, 'crypto:binance:ETHUSDT', 'crypto', 'long', 's', 'PAPER_TRADE', consensusId, 1, '{}');
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,decision_id,created_at,updated_at)
      VALUES (?,?,'paper-bot','binance-paper','crypto:binance:ETHUSDT','BUY','MARKET',1,'FILLED','ENTRY',?,1,1)`, `o-${consensusId}`, `c-${consensusId}`, `d-${consensusId}`);
  }
  const record = (id: string) => JSON.parse(get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', id)!.record);

  it('drops worker packets only from old, never-traded records and keeps their summary', () => {
    freshDb(true);
    consensus('old-untraded', NOW - 48 * HOUR);
    consensus('old-traded', NOW - 47 * HOUR); traded('old-traded');
    consensus('recent', NOW - HOUR);
    const before = get<{ n: number }>('SELECT SUM(length(record)) n FROM consensus_records')!.n;
    expect(compactConsensusEvidence(NOW, 24 * HOUR)).toMatchObject({ examined: 2, compacted: 1, keptTraded: 1 });
    expect(record('old-untraded')).toEqual({ consensus_id: 'old-untraded', state: 'STRONG_CONSENSUS', domains: [{ domain: 'trend', score: 1 }], vetoes: [], packetsCompactedAt: NOW });
    expect(record('old-traded').packets).toHaveLength(94);
    expect(record('recent').packets).toHaveLength(94);
    expect(get<{ n: number }>('SELECT SUM(length(record)) n FROM consensus_records')!.n).toBeLessThan(before * 0.7);
    // Idempotent: the watermark moved past both old records.
    expect(compactConsensusEvidence(NOW, 24 * HOUR)).toMatchObject({ examined: 0, compacted: 0 });
    expect(all('SELECT id FROM consensus_records')).toHaveLength(3);
  });

  it('advances in bounded batches and picks up records once they age past the window', () => {
    freshDb(true);
    for (let i = 0; i < 5; i++) consensus(`r${i}`, NOW - (50 - i) * HOUR);
    expect(compactConsensusEvidence(NOW, 24 * HOUR, 2)).toMatchObject({ examined: 2, compacted: 2 });
    expect(compactConsensusEvidence(NOW, 24 * HOUR, 2)).toMatchObject({ compacted: 2 });
    expect(compactConsensusEvidence(NOW, 24 * HOUR, 2)).toMatchObject({ compacted: 1 });
    expect(all<{ n: number }>("SELECT COUNT(*) n FROM consensus_records WHERE json_type(record,'$.packets') IS NOT NULL")[0].n).toBe(0);
    consensus('later', NOW + HOUR);
    expect(compactConsensusEvidence(NOW + 26 * HOUR, 24 * HOUR)).toMatchObject({ compacted: 1 });
    expect(() => compactConsensusEvidence(NOW, 0)).toThrow('INVALID_RETENTION_PASS');
  });

  it('does not skip records that share a timestamp across a batch boundary', () => {
    freshDb(true);
    for (const id of ['t1', 't2', 't3']) consensus(id, NOW - 30 * HOUR);
    expect(compactConsensusEvidence(NOW, 24 * HOUR, 2)).toMatchObject({ examined: 2, compacted: 2 });
    expect(compactConsensusEvidence(NOW, 24 * HOUR, 2)).toMatchObject({ examined: 1, compacted: 1 });
    expect(record('t3').packetsCompactedAt).toBe(NOW);
    expect(compactConsensusEvidence(NOW, 24 * HOUR, 2)).toMatchObject({ examined: 0 });
  });

  it('honours a legacy numeric watermark as strictly after that millisecond', () => {
    freshDb(true);
    consensus('at-mark', NOW - 30 * HOUR); consensus('after', NOW - 29 * HOUR);
    setSetting('qci.consensusCompactedThrough', NOW - 30 * HOUR);
    expect(compactConsensusEvidence(NOW, 24 * HOUR)).toMatchObject({ examined: 1, compacted: 1 });
    expect(record('at-mark').packets).toHaveLength(94);
  });

  it('adds the retention indexes to a v8 database without changing its rows', () => {
    closeDb();
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 8);
    raw.prepare("INSERT INTO consensus_records(id,candidate_id,instrument,state,created_at,expires_at,record) VALUES ('k','c','i','s',1,2,'{}')").run();
    migrate(raw);
    expect((raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
    expect(raw.prepare("SELECT record FROM consensus_records WHERE id='k'").get()).toEqual({ record: '{}' });
    const names = (raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['consensus_records_created', 'orders_decision']));
    raw.close();
  });
});

describe('read snapshots hold no write authority', () => {
  it('refuses a write transaction inside a read snapshot and does not report one as open', async () => {
    const { readSnapshot, tx, inTransaction } = await import('../src/db/db.js');
    freshDb(true);
    readSnapshot(() => {
      expect(inTransaction()).toBe(false);
      expect(() => tx(() => run("INSERT INTO settings(key,value,updated_at) VALUES ('x','1',1)"))).toThrow('WRITE_TRANSACTION_INSIDE_READ_SNAPSHOT');
    });
    expect(tx(() => inTransaction())).toBe(true);
    expect(get("SELECT 1 FROM settings WHERE key='x'")).toBeUndefined();
  });
});
