/**
 * Runtime integrity latch (BrainOS Omega section 11, RuntimePreFlightLatch).
 *
 * takeoverIntegrity (ops/integrity.ts) proves the database is sound when this process takes over the engine, but a
 * long-running leader could lose that guarantee later (corruption, a broken audit or memory chain, a ledger that no
 * longer reconciles, an open position without a matching protective stop) and keep opening positions until restart.
 * The background lane now re-runs the same checks every RUNTIME_INTEGRITY_INTERVAL_MS and stores the result; the risk
 * gate denies new entries while the latest result failed, is malformed, or has not been refreshed within
 * RUNTIME_INTEGRITY_MAX_AGE_MS. Exits, protection and monitoring never pass through the gate and are never affected.
 *
 * A missing result does not deny (the process has not taken over yet, or this is a test database). Anyone able to
 * write the database can also forge the stored result: this detects faults, it is not a defence against an attacker.
 */
import { tx } from '../db/db.js';
import { readValidatedSetting, setSetting } from '../core/settings.js';
import { assertWriteFence, type LeaseFence } from './lease.js';
import type { takeoverIntegrity } from './integrity.js';

export const RUNTIME_INTEGRITY_KEY = 'ops.runtimeIntegrity';
/** About 0.5 s per run on a 600 MB database (measured locally), so a 30 minute cadence keeps the cost negligible. */
export const RUNTIME_INTEGRITY_INTERVAL_MS = 30 * 60_000;
/** A failed result is re-checked sooner, so one transient failure (a busy lock) does not pause entries for 30 minutes. */
export const RUNTIME_INTEGRITY_RETRY_MS = 5 * 60_000;
/** Three missed runs of slack before a stalled background lane is treated as an unverified database. */
export const RUNTIME_INTEGRITY_MAX_AGE_MS = 3 * RUNTIME_INTEGRITY_INTERVAL_MS;

export interface RuntimeIntegrityRecord { checkedAt: number; ok: boolean; failed: { name: string; detail: string }[]; source: 'takeover' | 'runtime' }
export interface RuntimeIntegrityStatus { ok: boolean; reasons: string[]; record: RuntimeIntegrityRecord | null }

const isFailedCheck = (f: unknown): f is { name: string; detail: string } =>
  !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string' && typeof (f as { detail?: unknown }).detail === 'string';
const isRecord = (v: unknown): v is RuntimeIntegrityRecord => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<Record<keyof RuntimeIntegrityRecord, unknown>>;
  if (!Number.isSafeInteger(r.checkedAt) || (r.checkedAt as number) <= 0 || typeof r.ok !== 'boolean') return false;
  if ((r.source !== 'takeover' && r.source !== 'runtime') || !Array.isArray(r.failed) || !r.failed.every(isFailedCheck)) return false;
  return r.ok ? r.failed.length === 0 : r.failed.length > 0;
};

function readRecord(): { record: RuntimeIntegrityRecord | null; invalid: boolean } {
  const { value, invalid } = readValidatedSetting(RUNTIME_INTEGRITY_KEY, isRecord);
  return { record: value, invalid };
}

/** Stores a completed integrity result (from takeover or the background lane) under the engine write fence. */
export function storeIntegrityResult(result: ReturnType<typeof takeoverIntegrity>, source: RuntimeIntegrityRecord['source'], nowTs = Date.now(), fence?: LeaseFence): RuntimeIntegrityRecord {
  const record: RuntimeIntegrityRecord = { checkedAt: nowTs, ok: result.ok, source,
    failed: result.checks.filter((c) => !c.ok).map((c) => ({ name: c.name, detail: String(c.detail).slice(0, 300) })) };
  if (!record.ok && !record.failed.length) record.failed.push({ name: 'integrity', detail: 'check reported failure without a failed check' });
  tx(() => { assertWriteFence(fence); setSetting(RUNTIME_INTEGRITY_KEY, record); });
  return record;
}

/** True when the background lane should re-run the checks: no result yet, or the last one is older than the interval (sooner after a failure). */
export function runtimeIntegrityDue(nowTs = Date.now()): boolean {
  const { record } = readRecord();
  if (!record || record.checkedAt > nowTs) return true;
  return nowTs - record.checkedAt >= (record.ok ? RUNTIME_INTEGRITY_INTERVAL_MS : RUNTIME_INTEGRITY_RETRY_MS);
}

/**
 * Background lane: run the checks (passed in, so this module stays free of the OMS import chain the risk gate sits on)
 * and store the result. A check that throws is stored as a failure: a check that cannot run is not a clean result.
 */
export function refreshRuntimeIntegrity(run: typeof takeoverIntegrity, nowTs = Date.now(), fence?: LeaseFence): RuntimeIntegrityRecord | null {
  if (!runtimeIntegrityDue(nowTs)) return null;
  let result: ReturnType<typeof takeoverIntegrity>;
  try { result = run(); }
  catch (error) { result = { ok: false, checks: [{ name: 'integrity', ok: false, detail: `check failed: ${String((error as Error)?.message ?? error).slice(0, 200)}` }] }; }
  return storeIntegrityResult(result, 'runtime', nowTs, fence);
}

/** What the risk gate consults on every entry evaluation. Cheap: one settings read. */
export function runtimeIntegrityStatus(nowTs = Date.now()): RuntimeIntegrityStatus {
  const { record, invalid } = readRecord();
  const reasons: string[] = [];
  if (invalid) reasons.push('RUNTIME_INTEGRITY_INVALID: stored integrity result is malformed');
  if (record && !record.ok) reasons.push(`RUNTIME_INTEGRITY_FAILED: ${record.failed.map((f) => `${f.name} (${f.detail})`).join('; ').slice(0, 400)}`);
  if (record && record.checkedAt > nowTs) reasons.push('RUNTIME_INTEGRITY_INVALID: integrity result is dated in the future');
  else if (record && nowTs - record.checkedAt > RUNTIME_INTEGRITY_MAX_AGE_MS)
    reasons.push(`RUNTIME_INTEGRITY_STALE: database integrity not re-verified for more than ${RUNTIME_INTEGRITY_MAX_AGE_MS / 60_000} minutes`);
  return { ok: reasons.length === 0, reasons, record };
}
