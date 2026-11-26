import { statSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbFilePath } from '../db/db.js';

/**
 * Capacity of the volume that holds the SQLite database. When the disk fills, SQLite rejects writes (SQLITE_FULL): a
 * fill, an exit settlement or a protective-stop update could then fail mid-lifecycle. So new risk stops well before the
 * disk is full, while protection keeps running on the remaining headroom.
 *
 * CRITICAL: free < max(5% of the volume, 25 MB) → new entries are denied by the risk gate and readiness fails.
 * LOW:      free < max(15% of the volume, 75 MB) → warning only.
 * NOT_APPLICABLE: in-memory database (tests). UNKNOWN: the filesystem could not be read → treated as CRITICAL.
 */
export type StorageLevel = 'OK' | 'LOW' | 'CRITICAL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export interface StorageStatus { level: StorageLevel; freeBytes: number | null; totalBytes: number | null; databaseBytes: number | null; checkedAt: number }

const MB = 1024 * 1024;
export const STORAGE_THRESHOLDS = { criticalPct: 5, criticalMinBytes: 25 * MB, lowPct: 15, lowMinBytes: 75 * MB } as const;
const CACHE_MS = 5_000;
let cached: StorageStatus | null = null;

type Probe = (dir: string) => { freeBytes: number; totalBytes: number };
const realProbe: Probe = (dir) => { const s = statfsSync(dir); return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }; };
let probe: Probe = realProbe;

export function classifyStorage(freeBytes: number, totalBytes: number): StorageLevel {
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0 || freeBytes < 0) return 'UNKNOWN';
  const t = STORAGE_THRESHOLDS;
  if (freeBytes < Math.max(totalBytes * t.criticalPct / 100, t.criticalMinBytes)) return 'CRITICAL';
  if (freeBytes < Math.max(totalBytes * t.lowPct / 100, t.lowMinBytes)) return 'LOW';
  return 'OK';
}

/** Cached for a few seconds: cheap enough for the risk gate on every entry. */
export function storageStatus(nowTs = Date.now()): StorageStatus {
  if (cached && nowTs - cached.checkedAt >= 0 && nowTs - cached.checkedAt < CACHE_MS) return cached;
  const file = dbFilePath();
  if (!file) return (cached = { level: 'NOT_APPLICABLE', freeBytes: null, totalBytes: null, databaseBytes: null, checkedAt: nowTs });
  try {
    const { freeBytes, totalBytes } = probe(dirname(file));
    let databaseBytes: number | null = null;
    try { databaseBytes = statSync(file).size; } catch { /* reported as unknown size */ }
    cached = { level: classifyStorage(freeBytes, totalBytes), freeBytes, totalBytes, databaseBytes, checkedAt: nowTs };
  } catch {
    cached = { level: 'UNKNOWN', freeBytes: null, totalBytes: null, databaseBytes: null, checkedAt: nowTs };
  }
  return cached;
}

/** New exposure is refused when the volume is critically full or cannot be read. */
export const storageBlocksEntries = (s = storageStatus()) => s.level === 'CRITICAL' || s.level === 'UNKNOWN';

/** A backup writes a full copy of the database: require that much free space plus the critical reserve. */
export function backupSpaceDenial(s = storageStatus()): string | null {
  if (s.level === 'NOT_APPLICABLE') return null;
  if (s.freeBytes === null || s.databaseBytes === null) return 'BACKUP_SPACE_UNVERIFIABLE';
  const reserve = Math.max((s.totalBytes ?? 0) * STORAGE_THRESHOLDS.criticalPct / 100, STORAGE_THRESHOLDS.criticalMinBytes);
  const need = s.databaseBytes * 1.1 + reserve;
  return s.freeBytes < need ? `BACKUP_INSUFFICIENT_SPACE: need ${Math.ceil(need / MB)} MB free, have ${Math.floor(s.freeBytes / MB)} MB` : null;
}

export const _storageTest = {
  setProbe(next: Probe | null) { probe = next ?? realProbe; cached = null; },
  reset() { cached = null; },
};
