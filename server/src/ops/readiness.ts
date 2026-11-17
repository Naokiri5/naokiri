import { get } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { market } from '../market/store.js';
import { providers } from '../providers/http.js';
import { currentPolicy } from '../risk/policy.js';
import { notify } from '../notify/notify.js';
import { journal } from '../journal/journal.js';
import { config } from '../config.js';

/**
 * Readiness for an always-on paper server (Phase 1). `ready` answers one question for a supervisor or load balancer:
 * "is this process healthy enough to keep running?" Each check is pass / fail / skip / info; only `fail` makes the
 * process not ready. The response is unauthenticated, so it carries states and ages only — never error text, symbols,
 * balances or provider messages.
 */
export type CheckStatus = 'pass' | 'fail' | 'skip' | 'info';
export interface Check { name: string; status: CheckStatus; detail: string }
export interface EngineView { running: boolean; role: 'STOPPED' | 'LEADER' | 'STANDBY'; startedAt: number; lastTickerAt: number; lastScanAt: number }

/** A lane is stale after three of its intervals; a freshly started engine gets that much grace before its first run. */
export const staleAfter = () => ({ tickerMs: config.tickerIntervalMs * 3, scanMs: config.scanIntervalMs * 3 });
const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

function laneCheck(name: string, lastAt: number, limitMs: number, e: EngineView, nowTs: number): Check {
  if (lastAt > 0) {
    const age = nowTs - lastAt;
    return age <= limitMs ? { name, status: 'pass', detail: `last run ${secs(age)} ago` } : { name, status: 'fail', detail: `stale: last run ${secs(age)} ago (limit ${secs(limitMs)})` };
  }
  return nowTs - e.startedAt <= limitMs ? { name, status: 'pass', detail: 'starting (within grace period)' } : { name, status: 'fail', detail: `no run since start ${secs(nowTs - e.startedAt)} ago` };
}

export function readiness(e: EngineView, nowTs = Date.now()) {
  const checks: Check[] = [];
  try {
    const v = get<{ v: number | null }>('SELECT MAX(version) v FROM schema_migrations')?.v ?? 0;
    checks.push(v === SCHEMA_VERSION ? { name: 'database', status: 'pass', detail: `schema v${v}` } : { name: 'database', status: 'fail', detail: `schema v${v}, expected v${SCHEMA_VERSION}` });
  } catch { checks.push({ name: 'database', status: 'fail', detail: 'database unavailable' }); }

  const lim = staleAfter();
  if (config.offline) {
    checks.push({ name: 'engine', status: 'skip', detail: 'offline mode: market polling disabled' });
  } else if (!e.running) {
    checks.push({ name: 'engine', status: 'fail', detail: 'engine not running' });
  } else if (e.role === 'STANDBY') {
    // Another instance holds the engine lease: this copy is a healthy standby, its lanes intentionally idle.
    checks.push({ name: 'engine', status: 'info', detail: 'standby: another instance holds the engine lease' });
  } else {
    checks.push({ name: 'engine', status: 'pass', detail: e.role === 'LEADER' ? 'leader' : 'starting' });
    checks.push(laneCheck('tickers', e.lastTickerAt, lim.tickerMs, e, nowTs));
    checks.push(laneCheck('scanner', e.lastScanAt, lim.scanMs, e, nowTs));
  }
  const ps = providers().filter((p) => p.status !== 'DISABLED');
  checks.push({ name: 'providers', status: 'info', detail: `${ps.filter((p) => p.status === 'LIVE').length}/${ps.length} live` });
  checks.push({ name: 'risk policy', status: 'info', detail: currentPolicy() ? 'accepted' : 'not accepted (no paper entries until accepted)' });
  return { ready: !checks.some((c) => c.status === 'fail'), at: nowTs, schema: SCHEMA_VERSION, role: config.offline ? 'OFFLINE' : e.role, checks };
}

/**
 * Scan-stall watchdog: the leader alerts once (CRITICAL) when the scanner stops completing, and once more when it
 * recovers. A stall never opens positions or relaxes risk: it only tells the owner the engine is not scanning.
 */
let stalled = false;
export function checkScanStall(e: EngineView, nowTs = Date.now()): 'OK' | 'STALLED' | 'RECOVERED' | 'IDLE' {
  if (config.offline || !e.running || e.role !== 'LEADER') return 'IDLE';
  const c = laneCheck('scanner', e.lastScanAt, staleAfter().scanMs, e, nowTs);
  if (c.status === 'fail' && !stalled) { stalled = true; notify('CRITICAL', 'Scanner stalled', `The market scanner has not completed: ${c.detail}. No new paper entries are being evaluated.`, 'watchdog'); journal('SYSTEM', `Watchdog: scanner stalled (${c.detail})`); return 'STALLED'; }
  if (c.status === 'pass' && stalled) { stalled = false; notify('INFO', 'Scanner recovered', 'The market scanner is completing cycles again.', 'watchdog'); journal('SYSTEM', 'Watchdog: scanner recovered'); return 'RECOVERED'; }
  return stalled ? 'STALLED' : 'OK';
}
export const _resetWatchdog = () => { stalled = false; };
