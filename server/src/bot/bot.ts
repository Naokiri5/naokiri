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
import { refreshBrainSnapshot } from '../knowledge/brain.js';
import { refreshSettingsCapabilitySnapshot } from '../knowledge/settingsCapabilities.js';
import { bus } from '../core/bus.js';
import { config } from '../config.js';
import type { DecisionReport } from '../decision/engine.js';
import { tryAcquireLease, releaseLease } from '../ops/lease.js';
import { checkScanStall } from '../ops/readiness.js';
import { takeoverIntegrity } from '../ops/integrity.js';
import { maybeScheduledBackup } from '../ops/backup.js';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Part 26 funded (paper) bot runtime + Part 33 hot/background lanes. */
export const botStatus = {
  startedAt: 0, running: false, cycles: 0, lastTickerAt: 0, lastScanAt: 0, lastNewsAt: 0, lastPrintsAt: 0,
  lastError: null as string | null, entriesToday: 0, decisionsTotal: 0,
  /** Last position-monitor pass that completed without an error; monitorFailing is true while the latest pass threw. */
  lastMonitorAt: 0, monitorFailing: false,
  /** Single-runner lock: only the LEADER (holder of the 'engine' lease) runs the lanes; a STANDBY copy keeps retrying. */
  role: 'STOPPED' as 'STOPPED' | 'LEADER' | 'STANDBY', instanceId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
};
export const ENGINE_LEASE = 'engine';
/** Lease lifetime: three ticker intervals (minimum 45 s), so one slow tick never hands the engine to another copy. */
export const engineLeaseTtlMs = () => (config.offline && config.engineLeaseTtlMs) || Math.max(45_000, config.tickerIntervalMs * 3);
/** Acquire or renew the engine lease before any lane runs; a lane that does not hold it does nothing (fail closed). */
function holdEngine(): boolean {
  if (takeoverRefused) return false; // integrity checks failed: no lease until the owner restarts the engine
  let ok = false;
  try { ok = tryAcquireLease(ENGINE_LEASE, botStatus.instanceId, engineLeaseTtlMs()); } catch (e: any) { botStatus.lastError = `lease: ${e.message}`; }
  if (ok && botStatus.running && botStatus.role !== 'LEADER' && !takeoverAllowed()) return false;
  const role = ok ? 'LEADER' : 'STANDBY';
  if (botStatus.running && role !== botStatus.role) {
    journal('SYSTEM', role === 'LEADER' ? `Engine lease acquired by ${botStatus.instanceId}` : `Engine lease held by another instance; ${botStatus.instanceId} is on standby`);
    if (botStatus.role === 'LEADER') notify('CRITICAL', 'Engine lease lost', `${botStatus.instanceId} no longer holds the engine lease and stopped scanning/managing positions.`, 'engine-lease');
  }
  if (botStatus.running) botStatus.role = role;
  return ok;
}
let takeoverRefused = false;
/**
 * Integrity gate on every takeover (STOPPED or STANDBY → LEADER): a corrupt or inconsistent database never gets a
 * scheduler. On failure the lease is released, the engine stops and the reason is recorded; nothing is repaired.
 */
function takeoverAllowed(): boolean {
  const r = takeoverIntegrity(); if (r.ok) return true;
  takeoverRefused = true;
  const failed = r.checks.filter((c) => !c.ok);
  try { releaseLease(ENGINE_LEASE, botStatus.instanceId); } catch { /* lease simply expires */ }
  stopBot(); botStatus.lastError = `integrity: ${failed.map((c) => `${c.name}: ${c.detail}`).join('; ')}`;
  try {
    journal('SYSTEM', `Engine refused takeover: integrity checks failed (${failed.map((c) => c.name).join(', ')})`, undefined, { checks: r.checks });
    notify('CRITICAL', 'Engine stopped: integrity check failed', `${failed.map((c) => c.name).join(', ')} failed before ${botStatus.instanceId} could take over the engine. Nothing was repaired; open paper positions are not monitored until the owner investigates and restarts.`, 'engine-lease');
  } catch { /* database unusable: lastError still records why */ }
  return false;
}
/** Synchronous lease re-check right before a write that follows awaited network calls. A DB error counts as lost (fail closed). */
function stillLeader(): boolean {
  try { return holdEngine(); } catch (e: any) { botStatus.lastError = `lease: ${e.message}`; return false; }
}
let timers: NodeJS.Timeout[] = []; let scanning = false; let ticking = false; let backgrounding = false;

function onDecision(r: DecisionReport) {
  // scanOnce awaits consensus before every decision: re-check the lease synchronously right before any OMS write.
  if (!stillLeader()) return;
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
    // The awaits above can outlast the lease: re-check synchronously before writing; a copy that lost it skips to STANDBY.
    if (!stillLeader()) return;
    try { monitorPositions(); botStatus.lastMonitorAt = Date.now(); botStatus.monitorFailing = false; }
    catch (e: any) { botStatus.lastError = `monitor: ${e.message}`; botStatus.monitorFailing = true; }
    try { expireApprovals(); } catch (e: any) { botStatus.lastError = `approvals: ${e.message}`; }
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
  // Refresh an internal read-only view of canonical capabilities; this is not another scanner/OMS.
  try { refreshBrainSnapshot(); } catch (e: unknown) { botStatus.lastError = 'brain: ' + String(e instanceof Error ? e.message : e).slice(0, 200); }
  // Observe Settings safety, strategies, connection health, notification, security and release gates internally.
  // Never auto-accept a policy, promote a strategy, mutate credentials, or unlock live trading.
  try { refreshSettingsCapabilitySnapshot(); } catch (e: unknown) { botStatus.lastError = 'settings-brain: ' + String(e instanceof Error ? e.message : e).slice(0, 200); }
  if (Date.now() - botStatus.lastNewsAt > 5 * 60_000) { try { await refreshNews(); botStatus.lastNewsAt = Date.now(); } catch { /* tracked */ } }
  if (!stillLeader()) return; // backups and strategy suspension write: only the current leader, re-checked after the awaits
  backupPass();
  try { const s = checkStrategyHealth(); if (s.length) notify('WARNING', 'Strategy auto-suspended', s.join(', '), 'strategy-health'); } catch { /* */ }
}

/** Scheduled backup + restore check (leader only, from the background lane). Failures alert at most hourly. */
let lastBackupAlertAt = 0;
function backupPass() {
  try {
    const m = maybeScheduledBackup(); if (!m) return;
    journal('SYSTEM', `Backup ${m.file} written (${m.encrypted ? 'encrypted' : 'plaintext offline'}), restore check passed`);
  } catch (e: any) {
    botStatus.lastError = `backup: ${e.message}`;
    if (Date.now() - lastBackupAlertAt > 3_600_000) { lastBackupAlertAt = Date.now(); notify('WARNING', 'Backup failed', String(e.message).slice(0, 300), 'backup'); }
  }
}

export function startBot() {
  if (botStatus.running || config.offline) return;
  botStatus.running = true; botStatus.startedAt = Date.now(); botStatus.monitorFailing = false; takeoverRefused = false;
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
export const _test = { onDecision, holdEngine, hotLane, scanLane, backgroundLane, resetTakeoverRefusal: () => { takeoverRefused = false; } };
