import { get, run, tx } from '../db/db.js';
import { uid } from '../core/util.js';
import { config } from '../config.js';

/** Progress another process can read from the lease row while this one owns the engine. */
export interface LeaseHeartbeat { startedAt: number; lastTickerAt: number; lastMonitorAt: number; lastScanAt: number; cycles: number; laneErrors: Record<string, string | null> }
export interface LeaseRow { instanceId: string; epoch: number; seq: number; pid: number; heartbeatAt: number; released: boolean; hb: LeaseHeartbeat }
export type LeaseState = 'OWNER' | 'STANDBY' | 'VACANT';
export interface LeaseView { state: LeaseState; epoch: number; heartbeatAgeMs: number | null; ttlMs: number }

const KEY = 'engine.lease';
const EMPTY_HB: LeaseHeartbeat = { startedAt: 0, lastTickerAt: 0, lastMonitorAt: 0, lastScanAt: 0, cycles: 0, laneErrors: {} };
const read = () => { const r = get<{ value: string }>('SELECT value FROM settings WHERE key=?', KEY); return r ? (JSON.parse(r.value) as LeaseRow) : null; };
const write = (row: LeaseRow) => run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', KEY, JSON.stringify(row), row.heartbeatAt);

/**
 * Single-scheduler lease for one database (ticket 012). Compare-and-set runs inside BEGIN IMMEDIATE so it is atomic
 * across processes, and local state changes only after COMMIT succeeds. Takeover never trusts the wall clock: a
 * candidate waits until it has seen the same (instanceId, epoch, seq) for a full TTL on its own monotonic clock.
 * The holder fences itself by monotonic clock, and fenced() re-verifies the row under the write lock before any effect.
 */
export class EngineLease {
  readonly instanceId = uid('eng');
  readonly renewMs: number;
  epoch = 0;
  private maxEpoch = 0; private seq = 0; private renewedAt = -Infinity; private seen: { key: string; at: number } | null = null;
  constructor(readonly ttlMs = config.leaseTtlMs, private mono = () => performance.now(), private now = () => Date.now()) { this.renewMs = Math.floor(ttlMs / 3); }

  /** True only while the last committed renew is younger than ttl - renewMs. Synchronous, no I/O. */
  holds(m = this.mono()) { return this.epoch > 0 && m - this.renewedAt < this.ttlMs - this.renewMs; }

  /** One renew (owner) or observe/takeover (candidate) step. Any DB error means no renewal. Never throws. */
  tick(hb?: LeaseHeartbeat) {
    const m = this.mono(); let staged = false;
    try {
      const next = tx(() => {
        const row = read(); const maxEpoch = Math.max(this.maxEpoch, row?.epoch ?? 0);
        const stage = (epoch: number, prev: LeaseHeartbeat) => {
          staged = true;
          write({ instanceId: this.instanceId, epoch, seq: this.seq + 1, pid: process.pid, heartbeatAt: this.now(), released: false, hb: hb ?? prev });
          return { epoch, maxEpoch: Math.max(maxEpoch, epoch), seen: null };
        };
        if (this.epoch > 0 && row && row.instanceId === this.instanceId && row.epoch === this.epoch && !row.released) return stage(this.epoch, row.hb);
        if (row && !row.released) {
          const key = `${row.instanceId}|${row.epoch}|${row.seq}`;
          const seen = this.seen?.key === key ? this.seen : { key, at: m };
          if (m - seen.at < this.ttlMs) return { epoch: 0, maxEpoch, seen };
        }
        return stage(maxEpoch + 1, EMPTY_HB);
      });
      this.epoch = next.epoch; this.maxEpoch = next.maxEpoch; this.seen = next.seen;
      if (staged) { this.seq++; this.renewedAt = m; }
    } catch { if (staged) { this.epoch = 0; this.renewedAt = -Infinity; } }
    return this.holds();
  }

  /**
   * Run fn only if, under the write lock, the persisted row still names this instance and epoch and the monotonic
   * self-fence still holds. fn runs synchronously inside the same transaction (nested tx() calls become savepoints),
   * so a stale owner writes nothing. Returns false when skipped; DB and fn errors roll back and propagate.
   */
  fenced(fn: () => void): boolean {
    if (!this.holds()) return false;
    return tx(() => {
      const row = read();
      if (!row || row.released || row.instanceId !== this.instanceId || row.epoch !== this.epoch || !this.holds()) return false;
      fn(); return true;
    });
  }

  /** Owner only: mark the row released (epoch kept) so a standby can take over at once. */
  release() {
    if (this.epoch === 0) return;
    try {
      tx(() => { const row = read(); if (row && row.instanceId === this.instanceId && row.epoch === this.epoch) write({ ...row, released: true, heartbeatAt: this.now() }); });
    } catch { /* the row then simply expires after the TTL */ }
    this.epoch = 0; this.renewedAt = -Infinity;
  }

  view(): LeaseView {
    const holds = this.holds();
    try {
      const row = read();
      return { state: holds ? 'OWNER' : !row || row.released ? 'VACANT' : 'STANDBY', epoch: holds ? this.epoch : row?.epoch ?? 0, heartbeatAgeMs: row ? Math.max(0, this.now() - row.heartbeatAt) : null, ttlMs: this.ttlMs };
    } catch { return { state: holds ? 'OWNER' : 'VACANT', epoch: this.epoch, heartbeatAgeMs: null, ttlMs: this.ttlMs }; }
  }
}
