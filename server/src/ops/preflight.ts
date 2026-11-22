import { accessSync, constants, existsSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Startup-only guard for the existing MIA server. Read-only: never migrates, checkpoints,
 * creates a competing ledger, changes execution mode, or opens a venue connection.
 */
export interface PreflightCheck {
  name: 'runtime' | 'execution_authority' | 'environment_contract' | 'heap_thresholds' | 'data_directory' | 'sqlite_integrity';
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}
export interface PreflightReport {
  ok: boolean;
  checks: PreflightCheck[];
}
export interface PreflightOptions {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  nodeVersion?: string;
}

const LEGACY_UNSUPPORTED = [
  'PORT', 'MIA_AUTO_START', 'MIA_LEDGER_DB_PATH', 'MIA_TCA_DB_PATH',
  'MIA_ORDER_NOTIONAL_USD', 'MIA_MAX_SINGLE_ORDER_USD', 'MIA_MAX_DAILY_LOSS_USD',
  'MIA_INITIAL_PAPER_BALANCE_USD', 'MIA_RESERVE_FLOOR_USD', 'MIA_MAX_HEAP_RATIO',
] as const;

function checkExistingDb(dbFile: string): string {
  // sqlite readOnly is essential: existing schema/migrations are owned by db/db.ts.
  // A first boot has no DB yet; buildApp() alone creates and migrates the canonical mia.db.
  if (!existsSync(dbFile)) return 'new installation: canonical database will be initialized by buildApp';
  const stat = lstatSync(dbFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('canonical SQLite path is not a regular file');
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
    if (String(mode?.journal_mode ?? '').toLowerCase() !== 'wal') {
      throw new Error('canonical SQLite journal is not WAL');
    }
    const rows = db.prepare('PRAGMA quick_check').all() as Array<{ quick_check?: string }>;
    if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') {
      throw new Error('canonical SQLite quick_check failed');
    }
    return 'canonical SQLite WAL + quick_check verified read-only';
  } finally {
    db.close();
  }
}

/** Pure-config checks plus an optional read-only probe of MIA_DATA_DIR/mia.db. */
export function runPreflightChecks({ env, dataDir, nodeVersion = process.versions.node }: PreflightOptions): PreflightReport {
  const checks: PreflightCheck[] = [];
  const add = (name: PreflightCheck['name'], status: PreflightCheck['status'], detail: string) =>
    checks.push({ name, status, detail });

  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 13)) {
    add('runtime', 'fail', 'Node.js 22.13 or newer is required');
  } else add('runtime', 'pass', 'supported Node.js runtime');

  const legacyMode = (env.EXECUTION_MODE ?? '').trim().toLowerCase();
  const liveFlag = (env.MIA_ALLOW_LIVE_TRADING ?? '').trim().toLowerCase();
  if ((legacyMode && legacyMode !== 'paper') || (liveFlag && liveFlag !== 'false' && liveFlag !== '0')) {
    add('execution_authority', 'fail', 'environment-based LIVE/REPLAY execution flags are not authorized; use canonical owner mode and release gates');
  } else {
    add('execution_authority', 'pass', 'no environment-based LIVE enablement; canonical release gates remain authoritative');
  }

  const unsupported = LEGACY_UNSUPPORTED.filter((name) => env[name] !== undefined && env[name]?.trim() !== '');
  if (unsupported.length) {
    add('environment_contract', 'fail', `unsupported MIA 5 prototype settings: ${unsupported.join(', ')}; use canonical MIA_* configuration`);
  } else add('environment_contract', 'pass', 'no silently ignored prototype runtime settings');

  const warnRaw = env.MIA_HEALTH_HEAP_WARN_RATIO;
  const critRaw = env.MIA_HEALTH_HEAP_CRIT_RATIO;
  const warn = warnRaw === undefined || warnRaw === '' ? 0.80 : Number(warnRaw);
  const crit = critRaw === undefined || critRaw === '' ? 0.92 : Number(critRaw);
  if (!(warn > 0 && warn < crit && crit < 1) || !Number.isFinite(warn) || !Number.isFinite(crit)) {
    add('heap_thresholds', 'fail', 'MIA_HEALTH_HEAP_WARN_RATIO and CRIT_RATIO must satisfy 0 < warn < critical < 1');
  } else add('heap_thresholds', 'pass', 'runtime heap warning/critical thresholds valid');

  // Fail before HTTP bind if the canonical data directory is inaccessible.
  try {
    let p = dataDir;
    if (existsSync(p)) {
      if (!lstatSync(p).isDirectory()) throw new Error('data directory is not a directory');
    } else {
      while (!existsSync(p)) {
        const parent = dirname(p);
        if (parent === p) throw new Error('no usable parent for data directory');
        p = parent;
      }
    }
    accessSync(p, constants.R_OK | constants.W_OK);
    add('data_directory', 'pass', 'canonical data directory accessible');
  } catch {
    add('data_directory', 'fail', 'canonical data directory is inaccessible or unwritable');
  }

  if (checks.some((c) => c.status === 'fail')) {
    add('sqlite_integrity', 'skip', 'unsafe environment or inaccessible data directory; database not opened');
    return { ok: false, checks };
  }

  try {
    const dbFile = join(dataDir, 'mia.db');
    const firstBoot = !existsSync(dbFile);
    const detail = checkExistingDb(dbFile);
    add('sqlite_integrity', firstBoot ? 'skip' : 'pass', detail);
  } catch {
    // Never include SQLite filenames, queries, or potentially secret error messages in public status.
    add('sqlite_integrity', 'fail', 'canonical SQLite WAL or integrity verification failed; startup blocked');
  }
  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}
