import { ensureRules, refreshTickers, refreshDeep, refreshBackground, refreshBooks } from '../market/fabric.js';
import { scanOnce } from '../market/scanner.js';
import { monitorPositions, expireApprovals, submitEntry, queueForApproval } from '../exec/oms.js';
import { refreshNews } from '../news/news.js';
import { scanPrints } from '../whales/prints.js';
import { checkStrategyHealth } from '../lab/lab.js';
import { getControl, displayMode } from '../core/mode.js';
import { accountState, openPositions } from '../portfolio/ledger.js';
import { currentPolicy } from '../risk/policy.js';
import { notify } from '../notify/notify.js';
import { journal } from '../journal/journal.js';
import { bus } from '../core/bus.js';
import { config } from '../config.js';
import type { DecisionReport } from '../decision/engine.js';
import { tryAcquireLease, releaseLease } from '../ops/lease.js';
import { checkScanStall } from '../ops/readiness.js';
import { maybeScheduledBackup, verifyBackup, backupDir } from '../ops/backup.js';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Part 26 funded (paper) bot runtime + Part 33 hot/background lanes. */
export const botStatus = {
  startedAt: 0, running: false, cycles: 0, lastTickerAt: 0, lastScanAt: 0, lastNewsAt: 0, lastPrintsAt: 0,
  lastError: null as string | null, entriesToday: 0, decisionsTotal: 0,
  /** Single-runner lock: only the LEADER (holder of the 'engine' lease) runs the lanes; a STANDBY copy keeps retrying. */
  role: 'STOPPED' as 'STOPPED' | 'LEADER' | 'STANDBY', instanceId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
};
export const ENGINE_LEASE = 'engine';
/** Lease lifetime: three ticker intervals (minimum 45 s), so one slow tick never hands the engine to another copy. */
export const engineLeaseTtlMs = () => Math.max(45_000, config.tickerIntervalMs * 3);
/** Acquire or renew the engine lease before any lane runs; a lane that does not hold it does nothing (fail closed). */
function holdEngine(): boolean {
  let ok = false;
  try { ok = tryAcquireLease(ENGINE_LEASE, botStatus.instanceId, engineLeaseTtlMs()); } catch (e: any) { botStatus.lastError = `lease: ${e.message}`; }
  const role = ok ? 'LEADER' : 'STANDBY';
  if (botStatus.running && role !== botStatus.role) {
    journal('SYSTEM', role === 'LEADER' ? `Engine lease acquired by ${botStatus.instanceId}` : `Engine lease held by another instance; ${botStatus.instanceId} is on standby`);
    if (botStatus.role === 'LEADER') notify('CRITICAL', 'Engine lease lost', `${botStatus.instanceId} no longer holds the engine lease and stopped scanning/managing positions.`, 'engine-lease');
  }
  if (botStatus.running) botStatus.role = role;
  return ok;
}
let timers: NodeJS.Timeout[] = []; let scanning = false; let ticking = false; let backgrounding = false;

function onDecision(r: DecisionReport) {
  botStatus.decisionsTotal++;
  const ctl = getControl();
  if (r.decision === 'PAPER_TRADE' && ctl.mode === 'PAPER') { const res = submitEntry(r, 'bot'); if (res.ok) botStatus.entriesToday++; }
  else if (r.decision === 'APPROVED_FOR_USER_CONFIRMATION' && ctl.mode !== 'OBSERVE') queueForApproval(r);
}

async function hotLane() {
  if (ticking || !botStatus.running) return; ticking = true;
  try {
    if (!holdEngine()) return;
    // Steps fail independently. A rules or ticker outage must never skip position monitoring: with stale prices
    // monitorPositions() raises the "protection unverified" alert, which is exactly when the owner needs it.
    try { await ensureRules(); } catch (e: any) { botStatus.lastError = `rules: ${e.message}`; }
    try { await refreshTickers(); botStatus.lastTickerAt = Date.now(); } catch (e: any) { botStatus.lastError = `ticker: ${e.message}`; }
    // Exits are priced against the book: keep the books of open positions as fresh as the tickers that trigger them.
    try { await refreshBooks(openPositions().map((p) => p.instrument)); } catch (e: any) { botStatus.lastError = `books: ${e.message}`; }
    try { monitorPositions(); expireApprovals(); } catch (e: any) { botStatus.lastError = `monitor: ${e.message}`; }
    try { checkScanStall(botStatus); } catch (e: any) { botStatus.lastError = `watchdog: ${e.message}`; }
  }
  finally { ticking = false; }
}
async function scanLane() {
  if (scanning || !botStatus.running) return; scanning = true;
  try {
    if (!holdEngine()) return;
    if (!botStatus.lastTickerAt) await hotLane();
    await refreshDeep(); await scanOnce(onDecision); botStatus.lastScanAt = Date.now(); botStatus.cycles++;
    bus.publish('bot', { ...botStatusView() });
  } catch (e: any) { botStatus.lastError = `scan: ${e.message}`; }
  finally { scanning = false; }
}
async function backgroundLane() {
  if (backgrounding || !botStatus.running) return; backgrounding = true; // a slow pass must not overlap the next (duplicated prints/news)
  try { if (holdEngine()) await backgroundPass(); } finally { backgrounding = false; }
}
async function backgroundPass() {
  try { await refreshBackground(); } catch { /* tracked per provider */ }
  try { await scanPrints(); botStatus.lastPrintsAt = Date.now(); } catch { /* tracked */ }
  if (Date.now() - botStatus.lastNewsAt > 5 * 60_000) { try { await refreshNews(); botStatus.lastNewsAt = Date.now(); } catch { /* tracked */ } }
  backupPass();
  try { const s = checkStrategyHealth(); if (s.length) notify('WARNING', 'Strategy auto-suspended', s.join(', '), 'strategy-health'); } catch { /* */ }
}

/** Scheduled backup + restore check (leader only, from the background lane). Failures alert at most hourly. */
let lastBackupAlertAt = 0;
function backupPass() {
  try {
    const m = maybeScheduledBackup(); if (!m) return;
    const v = verifyBackup(join(backupDir(), m.file));
    journal('SYSTEM', `Backup ${m.file} written (${m.encrypted ? 'encrypted' : 'not encrypted'}); restore check ${v.ok ? 'passed' : 'FAILED'}`);
    if (!v.ok) throw new Error(`restore check failed: ${v.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`);
  } catch (e: any) {
    botStatus.lastError = `backup: ${e.message}`;
    if (Date.now() - lastBackupAlertAt > 3_600_000) { lastBackupAlertAt = Date.now(); notify('WARNING', 'Backup failed', String(e.message).slice(0, 300), 'backup'); }
  }
}

export function startBot() {
  if (botStatus.running || config.offline) return;
  botStatus.running = true; botStatus.startedAt = Date.now();
  journal('SYSTEM', `MIA engine started in ${displayMode()} mode`);
  hotLane().then(() => backgroundLane()).then(() => scanLane());
  timers = [
    setInterval(hotLane, config.tickerIntervalMs),
    setInterval(scanLane, config.scanIntervalMs),
    setInterval(backgroundLane, 60_000),
  ];
}
export function stopBot() { timers.forEach(clearInterval); timers = []; botStatus.running = false; botStatus.role = 'STOPPED'; }
/** Lanes currently executing (graceful drain waits for these before the lease is released and the DB closed). */
export const lanesBusy = () => ticking || scanning || backgrounding;
/**
 * Graceful stop: no new lane starts, in-flight lanes finish (bounded wait), then the lease is released so a successor
 * starts at once instead of waiting for expiry. Returns whether every lane drained in time.
 */
export async function drainBot(timeoutMs = 20_000): Promise<boolean> {
  stopBot();
  const until = Date.now() + timeoutMs;
  while (lanesBusy() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  const drained = !lanesBusy();
  // Release only after the lanes stopped; if one is still stuck, keep the lease so it expires rather than overlapping.
  if (drained) { try { releaseLease(ENGINE_LEASE, botStatus.instanceId); } catch { /* DB already closed: lease expires */ } }
  return drained;
}
export function botStatusView() {
  const ctl = getControl(); const acct = accountState();
  return {
    ...botStatus, display: displayMode(ctl), mode: ctl.mode, paused: ctl.pausedNewOrders, emergency: ctl.emergency,
    policyAccepted: !!currentPolicy(), funded: acct.deposits > 0, equity: acct.equity,
    state: ctl.emergency ? 'EMERGENCY' : ctl.pausedNewOrders ? 'PAUSED' : ctl.mode === 'OBSERVE' ? 'OBSERVING' : ctl.mode === 'PAPER' ? 'PAPER_TRADING' : ctl.mode === 'APPROVAL' ? 'AWAITING_APPROVAL' : 'BOUNDED_LIVE',
  };
}
export const _test = { onDecision, holdEngine, hotLane, scanLane, backgroundLane };
