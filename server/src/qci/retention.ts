import { getSetting, setSetting } from '../core/settings.js';
import { all, run, tx } from '../db/db.js';

/**
 * Consensus evidence retention. Every QCI run persists all worker packets (~66 KB per candidate, measured with the
 * fixture instrument) so the evidence behind a decision can be inspected. Nothing ever removed them, which filled the
 * production volume. After a retention window, records whose decision never produced an order keep their summary
 * (state, domains, vetoes, worker counts, expiry) and lose only the per-worker packet list (~3 KB remains). Records
 * linked to any order keep their packets permanently. Trading logic never reads stored packets; the explanation
 * views already handle records without them. Runs in short batches on the leader's background lane.
 */
export const CONSENSUS_RETENTION = { defaultHours: 24, minHours: 1, maxHours: 24 * 90, batch: 200 } as const;
const WATERMARK = 'qci.consensusCompactedThrough';

export function consensusDetailRetentionMs(env = process.env.MIA_CONSENSUS_DETAIL_HOURS) {
  const hours = env === undefined || env === '' ? CONSENSUS_RETENTION.defaultHours : Number(env);
  const bounded = Number.isFinite(hours) ? Math.min(Math.max(hours, CONSENSUS_RETENTION.minHours), CONSENSUS_RETENTION.maxHours) : CONSENSUS_RETENTION.defaultHours;
  return bounded * 3_600_000;
}

export interface CompactionResult { examined: number; compacted: number; keptTraded: number; through: number }

/** Compact at most `batch` records older than the retention window, oldest first, advancing a durable watermark. */
export function compactConsensusEvidence(nowTs = Date.now(), retentionMs = consensusDetailRetentionMs(), batch: number = CONSENSUS_RETENTION.batch): CompactionResult {
  if (!Number.isSafeInteger(nowTs) || nowTs <= 0 || !(retentionMs > 0) || !Number.isSafeInteger(batch) || batch < 1) throw new Error('INVALID_RETENTION_PASS');
  const cutoff = nowTs - retentionMs;
  return tx(() => {
    // Durable (created_at, id) cursor, so records sharing one millisecond across a batch boundary are not skipped. A
    // legacy numeric watermark means "strictly after that millisecond", which is what it meant when it was written.
    const stored = getSetting<number | { at: number; id: string }>(WATERMARK, 0);
    const cursor = typeof stored === 'number' ? { at: stored, id: null as string | null } : { at: stored.at, id: stored.id };
    const rows = all<{ id: string; created_at: number; traded: number }>(
      `SELECT c.id, c.created_at, EXISTS (SELECT 1 FROM decisions d JOIN orders o ON o.decision_id=d.id WHERE d.consensus_id=c.id) traded
       FROM consensus_records c WHERE (c.created_at > ? OR (c.created_at = ? AND ? IS NOT NULL AND c.id > ?)) AND c.created_at < ?
       ORDER BY c.created_at, c.id LIMIT ?`, cursor.at, cursor.at, cursor.id, cursor.id, cutoff, batch);
    let compacted = 0, keptTraded = 0;
    for (const row of rows) {
      if (row.traded) { keptTraded++; continue; }
      compacted += Number(run(`UPDATE consensus_records SET record=json_set(json_remove(record,'$.packets'),'$.packetsCompactedAt',?)
        WHERE id=? AND json_type(record,'$.packets') IS NOT NULL`, nowTs, row.id).changes);
    }
    const lastRow = rows.at(-1);
    if (lastRow) setSetting(WATERMARK, { at: lastRow.created_at, id: lastRow.id });
    return { examined: rows.length, compacted, keptTraded, through: lastRow?.created_at ?? cursor.at };
  });
}
