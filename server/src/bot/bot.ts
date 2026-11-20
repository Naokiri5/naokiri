import { ensureRules, refreshTickers, refreshDeep, refreshBackground, refreshBooks, syncDepthStreams, stopDepthStreams, depthStreamStatus } from '../market/fabric.js';
import { relayOnce } from '../fabric/relay.js';
import { market } from '../market/store.js';
import { scanOnce } from '../market/scanner.js';
import { monitorPositions, expireApprovals, queueForApproval } from '../exec/oms.js';
import { executionAdapter } from '../exec/environment.js';
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
import { releaseLease, acquireOrRenewLease, withWriteFence } from '../ops/lease.js';
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
const fenced = <T>(fn: () => T): T => withWriteFence(ENGINE_LEASE, botStatus.instanceId, fn);
function holdEngine(): boolean {
  if (takeoverRefused) return false; // integrity checks failed: no lease until the owner restarts the engine
  let ok = false; let acquired = false;
  try { const r = acquireOrRenewLease(ENGINE_LEASE, botStatus.instanceId, engineLeaseTtlMs()); ok = r !== 'HELD_ELSEWHERE'; acquired = r === 'ACQUIRED'; }
  catch (e: any) { botStatus.lastError = `lease: ${e.message}`; }
  // MIA-BOT-001: nothing in here may throw out of a lane (an unhandled rejection from a setInterval lane ends the
  // process). A failing integrity check counts as "not leader" (fail closed); a failing journal/notify is recorded only.
  // Takeover checks run after EVERY acquisition, decided from the persisted lease (CodeRabbit PR #12) — not from the
  // cached role, which is stale when this process paused as LEADER and later re-acquired an expired lease.
  try { if (ok && botStatus.running && (acquired || botStatus.role !== 'LEADER') && !takeoverAllowed()) return false; }
  catch (e: any) {
    // Not leader, and not a cached LEADER either: the next renewal must pass the integrity check before any work.
    botStatus.lastError = `takeover check: ${e.message}`; if (botStatus.running) botStatus.role = 'STANDBY'; return false;
  }
  const role = ok ? 'LEADER' : 'STANDBY';
  if (botStatus.running && role !== botStatus.role) {
    try {
      journal('SYSTEM', role === 'LEADER' ? `Engine lease acquired by ${botStatus.instanceId}` : `Engine lease held by another instance; ${botStatus.instanceId} is on standby`);
      if (botStatus.role === 'LEADER') notify('CRITICAL', 'Engine lease lost', `${botStatus.instanceId} no longer holds the engine lease and stopped scanning/managing positions.`, 'engine-lease');
    } catch (e: any) { botStatus.lastError = `lease journal: ${e.message}`; }
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
  // Bot writes are fenced: the lease is re-checked inside each write transaction (CodeRabbit PR #12).
  // PAPER and future LIVE share decision research, but the account-specific adapter owns the final execution boundary.
  // LIVE is still locked, and must never reinterpret a PAPER_TRADE decision as a live authorization.
  if (r.decision === 'PAPER_TRADE' && ctl.mode === 'PAPER') { const res = fenced(() => executionAdapter('PAPER').submitEntry(r, 'bot')); if (res.ok) botStatus.entriesToday++; }
  else if (r.decision === 'APPROVED_FOR_USER_CONFIRMATION' && ctl.mode !== 'OBSERVE') fenced(() => queueForApproval(r));
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
    try { fenced(() => monitorPositions()); botStatus.lastMonitorAt = Date.now(); botStatus.monitorFailing = false; }
    catch (e: any) { botStatus.lastError = `monitor: ${e.message}`; botStatus.monitorFailing = true; }
    try { fenced(() => expireApprovals()); } catch (e: any) { botStatus.lastError = `approvals: ${e.message}`; }
    try { checkScanStall(botStatus); } catch (e: any) { botStatus.lastError = `watchdog: ${e.message}`; }
  } catch (e: any) { botStatus.lastError = `hot lane: ${e.message}`; }
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
  try { if (holdEngine()) await backgroundPass(); } catch (e: any) { botStatus.lastError = `background lane: ${e.message}`; } finally { backgrounding = false; }
}
async function backgroundPass() {
  // Streaming books for open positions + the deep tier (no-op unless MIA_STREAMING=1); REST stays the fallback.
  try { syncDepthStreams([...openPositions().map((p) => p.instrument), ...market.deep.keys()]); } catch (e: any) { botStatus.lastError = `stream: ${e.message}`; }
  try { await refreshBackground(); } catch { /* tracked per provider */ }
  try { await scanPrints(); botStatus.lastPrintsAt = Date.now(); } catch { /* tracked */ }
  if (Date.now() - botStatus.lastNewsAt > 5 * 60_000) { try { await refreshNews(); botStatus.lastNewsAt = Date.now(); } catch { /* tracked */ } }
  if (!stillLeader()) return; // backups and strategy suspension write: only the current leader, re-checked after the awaits
  // NEXUS fabric relay (N2): leader-only, bounded batch, never throws out of the lane, no financial writes.
  try { relayOnce(); } catch (e: any) { botStatus.lastError = `fabric relay: ${e?.message ?? e}`; }
  await backupPass();
  if (!stillLeader()) return; // the restore check is awaited: re-check before strategy suspension writes
  try { const s = checkStrategyHealth(); if (s.length) notify('WARNING', 'Strategy auto-suspended', s.join(', '), 'strategy-health'); } catch { /* */ }
}

/** Scheduled backup + restore check (leader only, from the background lane). Failures alert at most hourly. */
let lastBackupAlertAt = 0;
async function backupPass() {
  try {
    const m = await maybeScheduledBackup(); if (!m) return;
    const v = m.verification;
    journal('SYSTEM', `Backup ${m.file} written (${m.encrypted ? 'encrypted' : 'not encrypted'}); restore check ${v.ok ? 'passed' : 'FAILED'}`);
    // CodeRabbit #14: decide the restore-check outcome first; retention reporting can never replace or mask it.
    const failure = !v.ok ? new Error(`restore check failed: ${v.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`) : null;
    if (m.retentionWarning) {
      try { journal('SYSTEM', `Backup retention warning for ${m.file}: ${m.retentionWarning}`); notify('WARNING', 'Backup retention failed', m.retentionWarning, 'backup'); }
      catch { /* a reporting failure must not hide the restore-check result below */ }
    }
    if (failure) throw failure;
    if (v.recordError) throw new Error(v.recordError);
  } catch (e: any) {
    botStatus.lastError = `backup: ${e.message}`;
    if (Date.now() - lastBackupAlertAt > 3_600_000) { lastBackupAlertAt = Date.now(); notify('WARNING', 'Backup failed', String(e.message).slice(0, 300), 'backup'); }
  }
}

export function startBot() {
  if (botStatus.running || config.offline) return;
  botStatus.running = true; botStatus.startedAt = Date.now(); botStatus.monitorFailing = false; takeoverRefused = false;
  journal('SYSTEM', `MIA engine started in ${displayMode()} mode`);
  hotLane().then(() => backgroundLane()).then(() => scanLane()).catch((e: any) => { botStatus.lastError = `startup: ${e?.message ?? e}`; });
  timers = [
    setInterval(hotLane, config.tickerIntervalMs),
    setInterval(scanLane, config.scanIntervalMs),
    setInterval(backgroundLane, 60_000),
  ];
}
export function stopBot() { timers.forEach(clearInterval); timers = []; botStatus.running = false; botStatus.role = 'STOPPED'; stopDepthStreams(); }
/** Hand the engine lease to a successor now (graceful stop), instead of letting it expire. */
export function releaseEngineLease() { try { releaseLease(ENGINE_LEASE, botStatus.instanceId); } catch { /* DB already closed: lease expires */ } }
/** Lanes currently executing (graceful drain waits for these before the lease is released and the DB closed). */
export const lanesBusy = () => ticking || scanning || backgrounding;
/**
 * Graceful stop: no new lane starts, in-flight lanes finish (bounded wait), then the lease is released so a successor
 * starts at once instead of waiting for expiry. Returns whether every lane drained in time.
 */
export async function drainBot(timeoutMs = 20_000, release = true): Promise<boolean> {
  stopBot();
  const until = Date.now() + timeoutMs;
  while (lanesBusy() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  const drained = !lanesBusy();
  // Release only after the lanes stopped; if one is still stuck, keep the lease so it expires rather than overlapping.
  if (drained && release) releaseEngineLease();
  return drained;
}
export function botStatusView() {
  const ctl = getControl(); const acct = accountState();
  return {
    ...botStatus, display: displayMode(ctl), mode: ctl.mode, paused: ctl.pausedNewOrders, emergency: ctl.emergency,
    policyAccepted: !!currentPolicy()?.policy, funded: acct.deposits > 0, equity: acct.equity,
    /** Streaming-book connection health (null when MIA_STREAMING is off: REST polling only). */
    depthStream: depthStreamStatus(),
    state: ctl.emergency ? 'EMERGENCY' : ctl.pausedNewOrders ? 'PAUSED' : ctl.mode === 'OBSERVE' ? 'OBSERVING' : ctl.mode === 'PAPER' ? 'PAPER_TRADING' : ctl.mode === 'APPROVAL' ? 'AWAITING_APPROVAL' : 'BOUNDED_LIVE',
  };
}
export const _test = { onDecision, holdEngine, hotLane, scanLane, backgroundLane, resetTakeoverRefusal: () => { takeoverRefused = false; } };
