/**
 * Scanner evaluation bookkeeping (BrainOS continuous multi-trade, CT01-04).
 *
 * A scan evaluates each instrument/strategy once per closed candle. Before this module, every evaluated key was
 * marked processed whatever the outcome, so a valid signal denied only because capacity was full (all slots used,
 * cash or open risk exhausted) was never reconsidered on that candle, even right after a settlement freed capacity.
 *
 * Now a key whose risk denial consists only of capacity codes is held as WAITING_CAPACITY instead of processed:
 *  - it is re-evaluated only after the capacity epoch changes (a paper position settled), never on every scan;
 *  - it expires when its candle is superseded, so an old signal cannot re-enter later;
 *  - re-evaluation builds a fresh candidate, fresh QCI and a fresh risk decision; nothing old is reused;
 *  - any other denial (safety, data, strategy, breaker, cooldown, mode...) or any approval ends the key as before.
 * This only changes when the full decision pipeline runs again; it never relaxes a gate.
 */
import { all, get } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import type { RiskDecision } from '../risk/gate.js';

/** Risk denial prefixes that a settlement can clear. Everything else is terminal for the candle. */
export const CAPACITY_CODES = ['MAX_CONCURRENT_POSITIONS', 'CORRELATION_LIMIT', 'INSUFFICIENT_BUYING_POWER', 'CASH_RESERVE_FLOOR_REACHED', 'AGGREGATE_OPEN_RISK'] as const;
export const MAX_WAITING = 500;

const isCapacityCode = (code: string) => CAPACITY_CODES.some((c) => code === c || code.startsWith(`${c} `) || code.startsWith(`${c}:`));

/** True only for a DENY whose every reason is a capacity code. Missing, approved or mixed decisions are false. */
export function isCapacityOnlyDenial(risk: Pick<RiskDecision, 'decision' | 'reasonCodes'> | null | undefined): boolean {
  return !!risk && risk.decision === 'DENY' && Array.isArray(risk.reasonCodes) && risk.reasonCodes.length > 0
    && risk.reasonCodes.every((c) => typeof c === 'string' && isCapacityCode(c));
}

/** Changes whenever a paper position settles (closes), which is what frees slots, cash and open risk. */
export function capacityEpoch(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM positions WHERE account=? AND status='CLOSED'", PAPER_ACCOUNT)?.n ?? 0;
}

export interface WaitingCandidate { key: string; instrumentId: string; strategyId: string; epoch: number; expiresAt: number; reasons: string[]; since: number; evaluations: number }
export type EvaluationVerdict = 'EVALUATE' | 'PROCESSED' | 'WAITING_CAPACITY' | 'EXPIRED';

export class ScanLedger {
  private processed = new Set<string>();
  private waiting = new Map<string, WaitingCandidate>();

  /** Whether the full pipeline should run for this key now. */
  verdict(key: string, nowTs: number, epoch: number): EvaluationVerdict {
    if (this.processed.has(key)) return 'PROCESSED';
    const w = this.waiting.get(key);
    if (!w) return 'EVALUATE';
    if (nowTs >= w.expiresAt) { this.waiting.delete(key); this.processed.add(key); return 'EXPIRED'; }
    return epoch === w.epoch ? 'WAITING_CAPACITY' : 'EVALUATE';
  }

  /** Records the outcome of a completed evaluation. Returns true when the key is held for capacity. */
  record(key: string, meta: { instrumentId: string; strategyId: string }, risk: RiskDecision | null, epoch: number, expiresAt: number, nowTs: number): boolean {
    const previous = this.waiting.get(key);
    if (isCapacityOnlyDenial(risk) && nowTs < expiresAt && (previous || this.waiting.size < MAX_WAITING)) {
      this.waiting.set(key, { key, ...meta, epoch, expiresAt, reasons: risk!.reasonCodes.slice(0, 5), since: previous?.since ?? nowTs, evaluations: (previous?.evaluations ?? 0) + 1 });
      return true;
    }
    this.waiting.delete(key);
    this.processed.add(key);
    return false;
  }

  /** A terminal decision found in storage (restart) ends the key. */
  markProcessed(key: string) { this.waiting.delete(key); this.processed.add(key); }

  /** A failed evaluation is retried on the next scan, as before. */
  forget(key: string) { this.processed.delete(key); }

  prune(nowTs: number) {
    for (const [k, w] of this.waiting) if (nowTs >= w.expiresAt) { this.waiting.delete(k); this.processed.add(k); }
    if (this.processed.size > 50_000) this.processed.clear();
  }

  waitingList(nowTs = Date.now()): WaitingCandidate[] {
    return [...this.waiting.values()].filter((w) => nowTs < w.expiresAt).sort((a, b) => a.expiresAt - b.expiresAt);
  }

  clear() { this.processed.clear(); this.waiting.clear(); }
}

/**
 * Restart guard: a stored decision for this key after its candle closed ends the key, unless every such decision was
 * a capacity-only denial (then one fresh evaluation is allowed after restart, which re-enters the waiting state).
 * An unreadable stored report counts as terminal.
 */
export function storedDecisionsEndKey(instrumentId: string, strategyId: string, sinceTs: number): boolean {
  const rows = all<{ risk_decision: string | null; report: string }>(
    'SELECT risk_decision, report FROM decisions WHERE instrument=? AND strategy=? AND created_at>=? LIMIT 50', instrumentId, strategyId, sinceTs);
  if (!rows.length) return false;
  return rows.some((r) => {
    if (r.risk_decision !== 'DENY') return true;
    try { return !isCapacityOnlyDenial(JSON.parse(r.report)?.risk); } catch { return true; }
  });
}
