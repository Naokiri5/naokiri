/**
 * Parent-side harness for the paper-OMS crash suite: file-backed DB stages, child spawning, snapshots.
 * The parent opens the DB only between children (open → read/write → close), so it never holds a connection while
 * a child runs.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, closeDb, openDb, run, J } from '../../src/db/db.js';
import { market } from '../../src/market/store.js';
import { seedStrategies } from '../../src/lab/lab.js';
import { acceptPolicy, DEFAULT_POLICY } from '../../src/risk/policy.js';
import { updateControl } from '../../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../../src/portfolio/ledger.js';
import { queueForApproval, submitEntry } from '../../src/exec/oms.js';
import type { CrashPoint } from '../../src/exec/crashpoint.js';
import type { DecisionReport } from '../../src/decision/engine.js';
import { seedInstrument } from '../helpers.js';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHILD = join(SERVER_DIR, 'test', 'crash', 'child.ts');
export const CANDIDATE = 'cand_crash1';
export const DEPOSIT = 10_000;
/** Child exit code when a barrier is never released; exits directly so the OMS cannot catch it and carry on. */
export const BARRIER_TIMEOUT = 75;

export interface ChildRequest { db: string; op: 'enter' | 'approve' | 'monitor' | 'close'; reportFile?: string; mid?: number; crashAt?: CrashPoint; occurrence?: number; barrier?: CrashPoint; go?: string; barrierMs?: number }
export interface ChildOutcome { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; result: unknown; marker: { at: CrashPoint; occurrence: number } | null }

/** Deterministic ETHUSDT last price; children seed the same synthetic market. */
export function seedMarket() { market.reset(); seedInstrument('BTCUSDT'); return seedInstrument('ETHUSDT', { seed: 2 }); }

/** Synchronous open → fn → close, so nothing is held open while a child runs. */
export function withDb<T>(file: string, fn: () => T): T {
  closeDb(); openDb(file);
  try { return fn(); } finally { closeDb(); }
}

/** Every temp dir this module creates, registered at allocation so a failing setup cannot leak one. */
const created: string[] = [];
export function removeCaseDirs() { for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true }); }
export function newCaseDir(template?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'mia-crash-')); created.push(dir);
  if (template) { copyFileSync(template, join(dir, 'mia.db')); copyFileSync(join(dirname(template), 'report.json'), join(dir, 'report.json')); }
  return { dir, db: join(dir, 'mia.db') };
}

export function report(instrumentId: string, last: number, decision: DecisionReport['decision']): DecisionReport {
  return { id: `dec_${CANDIDATE}`, candidateId: CANDIDATE, traceId: 'tr_crash', asset: 'ETHUSDT', instrumentId, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
    decision, opportunity: { score: 70, version: 'v', factors: [], missing: [] } } as unknown as DecisionReport;
}

export type Stage = 'fresh' | 'pending' | 'open' | 'aged';
/**
 * Build a template DB at a lifecycle stage: fresh (policy, PAPER mode, deposit, decision row), pending (APPROVAL mode,
 * entry queued), open (entry filled, protective stop active), aged (open, opened past trend_pullback's 48h max hold).
 */
export function buildStage(stage: Stage) {
  const { dir, db } = newCaseDir();
  const { inst, last } = seedMarket();
  const rep = report(inst.id, last, stage === 'pending' ? 'APPROVED_FOR_USER_CONFIRMATION' : 'PAPER_TRADE');
  writeFileSync(join(dir, 'report.json'), J(rep));
  withDb(db, () => {
    seedStrategies(); run("UPDATE strategies SET status='PAPER'");
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: stage === 'pending' ? 'APPROVAL' : 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', DEPOSIT);
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)', rep.id, rep.candidateId, inst.id, 'crypto', 'LONG', 'trend_pullback', rep.decision, 70, Date.now(), J(rep));
    if (stage === 'pending' && !queueForApproval(rep)) throw new Error('approval was not queued');
    if (stage === 'open' || stage === 'aged') { const r = submitEntry(rep, 'bot'); if (!r.ok) throw new Error(`stage entry failed: ${r.reason}`); }
    if (stage === 'aged') run('UPDATE positions SET opened_at=opened_at-?', 49 * 3600_000);
  });
  return { db, last };
}

export function runChild(req: ChildRequest): Promise<ChildOutcome> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, MIA_OFFLINE: '1', MIA_DATA_DIR: dirname(req.db), NODE_OPTIONS: '--disable-warning=ExperimentalWarning' };
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, J(req)], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d));
  const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
      const markerFile = join(dirname(req.db), 'crash-marker.json');
      const marker = existsSync(markerFile) ? JSON.parse(readFileSync(markerFile, 'utf8')) : null;
      rmSync(markerFile, { force: true });
      done({ code, signal, stdout, stderr, result: line ? JSON.parse(line.slice(7)) : undefined, marker });
    });
  });
}

/** Wait until `n` children have parked at their barrier. */
export async function awaitParked(dir: string, n: number) {
  const parked = () => readdirSync(dir).filter((f) => f.startsWith('ready-')).length;
  const deadline = Date.now() + 15_000;
  while (parked() < n) {
    if (Date.now() > deadline) throw new Error(`only ${parked()}/${n} children reached the barrier`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
/** Release the children parked on `go` once `n` of them are waiting. */
export async function releaseBarrier(dir: string, n: number, go = 'go') { await awaitParked(dir, n); writeFileSync(join(dir, go), ''); }

const TABLES = ['orders', 'fills', 'positions', 'ledger_entries'] as const;
/** Every row of the trading tables, ids and timestamps included: a rolled-back crash must leave these byte-identical. */
export const rawState = () => Object.fromEntries(TABLES.map((t) => [t, all(`SELECT * FROM ${t} ORDER BY id`)]));

const num = (v: number | null) => (v == null ? v : Number(v.toPrecision(12)));
/**
 * Id- and timestamp-free view of the trading tables, comparable across runs: two processes applying the same operation
 * to the same stage must produce the same shape.
 */
export function shape() {
  const coid = new Map<string, string>();
  const posLabel = new Map(all<{ id: string }>('SELECT id FROM positions ORDER BY opened_at').map((p, i) => [p.id, `pos${i}`]));
  const label = (s: string) => [...posLabel].reduce((acc, [id, l]) => acc.replaceAll(id, l), s);
  const orders = all<any>('SELECT * FROM orders').map((o) => { coid.set(o.id, label(o.client_order_id)); return o; })
    .map((o) => ({ coid: coid.get(o.id), side: o.side, type: o.type, qty: num(o.qty), filled: num(o.filled_qty), avg: num(o.avg_price), fees: num(o.fees), stop: num(o.stop_price), status: o.status, purpose: o.purpose, reject: o.reject_reason }))
    .sort((a, b) => a.coid!.localeCompare(b.coid!));
  const fills = all<any>('SELECT * FROM fills').map((f) => ({ order: coid.get(f.order_id), qty: num(f.qty), price: num(f.price), fee: num(f.fee) })).sort((a, b) => a.order!.localeCompare(b.order!));
  const ledgerRows = all<any>('SELECT * FROM ledger_entries').map((l) => ({ kind: l.kind, amount: num(l.amount), ref: l.ref ? coid.get(l.ref) ?? l.ref : null, note: l.note })).sort((a, b) => `${a.ref}${a.kind}`.localeCompare(`${b.ref}${b.kind}`));
  const positions = all<any>('SELECT * FROM positions ORDER BY opened_at').map((p) => ({ id: posLabel.get(p.id), status: p.status, qty: num(p.qty), entry: num(p.entry_price), stop: num(p.stop_price), targets: JSON.parse(p.targets), realized: num(p.realized_pnl), fees: num(p.fees), exitPrice: num(p.exit_price), exitReason: p.exit_reason, mfe: num(p.mfe), mae: num(p.mae) }));
  return { orders, fills, ledger: ledgerRows, positions };
}

/** SQLite's own view of the file after a restart. */
export const sqliteHealth = () => ({ integrity: all<{ integrity_check: string }>('PRAGMA integrity_check').map((r) => r.integrity_check), foreignKeys: all('PRAGMA foreign_key_check') });
