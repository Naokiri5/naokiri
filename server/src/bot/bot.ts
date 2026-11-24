import { ensureRules, refreshTickers, refreshDeep, refreshBackground, refreshBooks } from '../market/fabric.js';
import { scanOnce } from '../market/scanner.js';
import { evaluateShadowChoices, freezeChoiceEvidence, MAX_SHADOW_CANDIDATES } from '../choice/arbitration.js';
import { runDualResearchPass } from '../choice/dualRuntime.js';
import { recordShadowChoice } from '../ditas/memory.js';
import { uid } from '../core/util.js';
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
import { recordAutonomicObservation, recordLearningEvidence, resetInternalProcesses } from '../knowledge/cognitive/internalProcesses.js';
import { recentInternalLearningEvidence } from '../ditas/service.js';
import { refreshSettingsCapabilitySnapshot } from '../knowledge/settingsCapabilities.js';
import { CAPABILITY_REFRESH_INTERVAL_MS } from '../knowledge/capabilitySnapshot.js';
import { bus } from '../core/bus.js';
import { config } from '../config.js';
import type { DecisionReport } from '../decision/engine.js';
import { acquireOrRenewLease, ownsLease, releaseLease, LeaseLostError, type LeaseFence } from '../ops/lease.js';
import { checkScanStall, protectionIntervalMs, staleAfter } from '../ops/readiness.js';
import { takeoverIntegrity } from '../ops/integrity.js';
import { maybeScheduledBackup } from '../ops/backup.js';
import { record } from '../core/latency.js';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

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
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
let activeLease: LeaseFence | null = null;
let takeoverRefused = false;

function setEngineRole(role: 'LEADER' | 'STANDBY') {
  if (!botStatus.running || botStatus.role === role) return;
  const previous = botStatus.role;
  resetInternalProcesses();
  botStatus.role = role;
  try {
    journal('SYSTEM', role === 'LEADER' ? `Engine lease acquired by ${botStatus.instanceId}` : `Engine on standby: ${botStatus.instanceId}`);
    if (previous === 'LEADER') notify('CRITICAL', 'Engine lease lost', `${botStatus.instanceId} lost scheduling authority.`, 'engine-lease');
  } catch (error) { botStatus.lastError = `lease reporting: ${errorText(error)}`; }
}

function holdEngine(): LeaseFence | null {
  if (!botStatus.running || takeoverRefused) return null;
  try {
    const lease = acquireOrRenewLease(ENGINE_LEASE, botStatus.instanceId, engineLeaseTtlMs());
    if (lease) {
      // Reacquiring an expired lease starts a new generation even when this process was the previous holder.
      if (activeLease?.acquired_at !== lease.acquired_at && !takeoverAllowed(lease)) return null;
      activeLease = { name: lease.name, holder: lease.holder, acquired_at: lease.acquired_at };
      setEngineRole('LEADER');
      return activeLease;
    }
  } catch (error) { botStatus.lastError = `lease: ${errorText(error)}`; }
  activeLease = null;
  setEngineRole('STANDBY');
  return null;
}

/** Verify persisted paper state and expire orphaned approvals before the scheduler starts a new generation. */
function takeoverAllowed(lease: LeaseFence): boolean {
  let failed: ReturnType<typeof takeoverIntegrity>['checks'];
  try {
    const result = takeoverIntegrity();
    if (result.ok) {
      expireApprovals(lease);
      return true;
    }
    failed = result.checks.filter((check) => !check.ok);
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    failed = [{ name: 'takeover verification', ok: false, detail: errorText(error).slice(0, 200) }];
  }
  takeoverRefused = true;
  try { releaseLease(lease.name, lease.holder, lease.acquired_at); } catch { /* lease simply expires */ }
  stopBot(); botStatus.lastError = `integrity: ${failed.map((c) => `${c.name}: ${c.detail}`).join('; ')}`;
  try {
    journal('SYSTEM', `Engine refused takeover: integrity checks failed (${failed.map((c) => c.name).join(', ')})`, undefined, { checks: failed });
    notify('CRITICAL', 'Engine stopped: integrity check failed', `${failed.map((c) => c.name).join(', ')} failed before ${botStatus.instanceId} could take over the engine. Nothing was repaired; open paper positions are not monitored until the owner investigates and restarts.`, 'engine-lease');
  } catch { /* database unusable: lastError still records why */ }
  return false;
}
function stillLeader(lease: LeaseFence): boolean {
  if (!botStatus.running || activeLease?.acquired_at !== lease.acquired_at) return false;
  try { if (ownsLease(lease)) return true; } catch (error) { botStatus.lastError = `lease: ${errorText(error)}`; }
  activeLease = null;
  setEngineRole('STANDBY');
  return false;
}

function laneStatus(priority: 'protective' | 'entry' | 'background') {
  return { priority, inFlight: false, startedAt: 0, completedAt: 0, failedAt: 0, error: null as string | null };
}
const lanes = {
  protection: laneStatus('protective'),
  positionBooks: laneStatus('protective'),
  ticker: laneStatus('entry'),
  scan: laneStatus('entry'),
  background: laneStatus('background'),
  research: { ...laneStatus('background'), deferredAt: 0, deferReason: null as string | null },
};
let timers: NodeJS.Timeout[] = [];

async function runLane(name: keyof typeof lanes, pass: (lease: LeaseFence) => void | Promise<void>) {
  const lane = lanes[name];
  if (lane.inFlight || !botStatus.running) return;
  const lease = holdEngine();
  if (!lease) return;
  lane.inFlight = true;
  lane.startedAt = Date.now();
  const started = performance.now();
  try {
    await pass(lease);
    if (stillLeader(lease)) { lane.completedAt = Date.now(); lane.error = null; }
  } catch (error) {
    if (error instanceof LeaseLostError) { stillLeader(lease); return; }
    lane.failedAt = Date.now();
    lane.error = errorText(error);
    botStatus.lastError = `${name}: ${lane.error}`;
  } finally {
    lane.inFlight = false;
    record(`bot.${name}`, performance.now() - started);
  }
}

function onDecision(r: DecisionReport, lease: LeaseFence | null = activeLease) {
  if (!lease || !stillLeader(lease)) return;
  botStatus.decisionsTotal++;
  if (botStatus.monitorFailing || Date.now() - botStatus.lastMonitorAt > staleAfter().monitorMs) return;
  try {
    if (r.decision === 'PAPER_TRADE') {
      const result = submitEntry(r, 'bot', undefined, lease);
      if (result.ok) botStatus.entriesToday++;
    } else if (r.decision === 'APPROVED_FOR_USER_CONFIRMATION') queueForApproval(r, lease);
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
    stillLeader(lease);
  }
}

const protectionLane = () => runLane('protection', (lease) => {
  try {
    monitorPositions(undefined, lease);
    botStatus.lastMonitorAt = Date.now();
    botStatus.monitorFailing = false;
  } catch (error) {
    if (!(error instanceof LeaseLostError)) botStatus.monitorFailing = true;
    throw error;
  }
  try { checkScanStall(botStatus); } catch (error) { botStatus.lastError = `watchdog: ${errorText(error)}`; }
});

const booksLane = () => runLane('positionBooks', async () => {
  await refreshBooks(openPositions().map((p) => p.instrument));
});

const hotLane = () => runLane('ticker', async (lease) => {
  try { expireApprovals(lease); } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    botStatus.lastError = `approvals: ${errorText(error)}`;
  }
  try { await ensureRules(); } catch (error) { botStatus.lastError = `rules: ${errorText(error)}`; }
  if (!stillLeader(lease)) return;
  await refreshTickers();
  if (stillLeader(lease)) botStatus.lastTickerAt = Date.now();
});

function scanLane() {
  if (!botStatus.lastTickerAt) return;
  return runLane('scan', async (lease) => {
    await refreshDeep();
    if (!stillLeader(lease)) return;
    const shadowEnabled = process.env.MIA_CHOICE_SHADOW !== '0';
    const startedAt = Date.now(), control = getControl(), policy = currentPolicy()?.version;
    const observed: ReturnType<typeof freezeChoiceEvidence>[] = [];
    let totalReportsObserved = 0;
    await scanOnce((report, snapshotId) => {
      totalReportsObserved++;
      if (shadowEnabled && observed.length < MAX_SHADOW_CANDIDATES) observed.push(freezeChoiceEvidence(report, snapshotId));
      onDecision(report, lease);
    }, () => stillLeader(lease));
    if (!stillLeader(lease)) return;
    if (shadowEnabled) {
      const completedAt = Date.now();
      const currentControl = getControl();
      const roundId = totalReportsObserved ? uid('choice') :
        `choice-empty-${control.mode}-${Math.floor(completedAt / (15 * 60_000))}`;
      try {
        recordShadowChoice(evaluateShadowChoices(observed, {
          roundId, startedAt, completedAt, mode: control.mode, totalReportsObserved,
          modeChanged: currentControl.mode !== control.mode || currentControl.updatedAt !== control.updatedAt,
          policyChanged: currentPolicy()?.version !== policy,
        }), lease);
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
        botStatus.lastError = `choice: ${errorText(error)}`;
      }
    }
    botStatus.lastScanAt = Date.now();
    botStatus.cycles++;
    bus.publish('bot', botStatusView());
  });
}

let lastResearchSample = performance.eventLoopUtilization();
function researchLane() {
  const sample = performance.eventLoopUtilization();
  const busy = performance.eventLoopUtilization(sample, lastResearchSample).utilization;
  lastResearchSample = sample;
  if (!botStatus.running || botStatus.role !== 'LEADER') return;
  const autonomic = recordAutonomicObservation({
    now: Date.now(), monitorAt: botStatus.lastMonitorAt,
    monitorMaxAgeMs: staleAfter().monitorMs, monitorFailing: botStatus.monitorFailing,
    eventLoopUtilization: busy,
  });
  if (!autonomic.researchAllowed) {
    lanes.research.deferredAt = Date.now();
    lanes.research.deferReason = autonomic.reason;
    return;
  }
  return runLane('research', async () => {
    lanes.research.deferReason = null;
    await runDualResearchPass();
  });
}

const backgroundLane = () => runLane('background', async (lease) => {
  try { await refreshBackground(); } catch { /* tracked per provider */ }
  try { await scanPrints(); botStatus.lastPrintsAt = Date.now(); } catch { /* tracked */ }
  if (Date.now() - botStatus.lastNewsAt > 5 * 60_000) { try { await refreshNews(); botStatus.lastNewsAt = Date.now(); } catch { /* tracked */ } }
  if (!stillLeader(lease)) return;
  try { refreshBrainSnapshot(); } catch (error) { botStatus.lastError = `brain: ${errorText(error).slice(0, 200)}`; }
  try { refreshSettingsCapabilitySnapshot(); } catch (error) { botStatus.lastError = `settings-brain: ${errorText(error).slice(0, 200)}`; }
  backupPass();
  if (!stillLeader(lease)) return;
  const suspended = checkStrategyHealth(lease);
  // Reuse the background lane and canonical memory; never delay protective exits.
  if (stillLeader(lease)) {
    try { recordLearningEvidence(recentInternalLearningEvidence()); }
    catch (error) { botStatus.lastError = `learning-evidence: ${errorText(error).slice(0, 200)}`; }
  }
  if (suspended.length) notify('WARNING', 'Strategy auto-suspended', suspended.join(', '), 'strategy-health');
});

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
  if (botStatus.running || lanesBusy() || config.offline) return;
  Object.assign(botStatus, { running: true, startedAt: Date.now(), lastMonitorAt: 0, lastTickerAt: 0, lastScanAt: 0, monitorFailing: false });
  takeoverRefused = false;
  journal('SYSTEM', `MIA engine started in ${displayMode()} mode`);
  timers = [
    setInterval(protectionLane, protectionIntervalMs()),
    setInterval(booksLane, protectionIntervalMs()),
    setInterval(hotLane, config.tickerIntervalMs),
    setInterval(scanLane, config.scanIntervalMs),
    setInterval(backgroundLane, CAPABILITY_REFRESH_INTERVAL_MS),
    setInterval(researchLane, 60_000),
  ];
  void protectionLane();
  void booksLane();
  void hotLane().then(scanLane);
  void backgroundLane();
}
export function stopBot() {
  timers.forEach(clearInterval);
  timers = [];
  activeLease = null;
  botStatus.running = false;
  botStatus.role = 'STOPPED';
  resetInternalProcesses();
}
/** Lanes currently executing (graceful drain waits for these before the lease is released and the DB closed). */
export const lanesBusy = () => Object.values(lanes).some((lane) => lane.inFlight);
/**
 * Graceful stop: no new lane starts, in-flight lanes finish (bounded wait), then the lease is released so a successor
 * starts at once instead of waiting for expiry. Returns whether every lane drained in time.
 */
export async function drainBot(timeoutMs = 20_000): Promise<boolean> {
  const lease = activeLease;
  stopBot();
  const until = Date.now() + timeoutMs;
  while (lanesBusy() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  const drained = !lanesBusy();
  // Release only after the lanes stopped; if one is still stuck, keep the lease so it expires rather than overlapping.
  if (drained && lease) { try { releaseLease(lease.name, lease.holder, lease.acquired_at); } catch { /* lease expires */ } }
  return drained;
}
export function botStatusView(acct = accountState()) {
  const ctl = getControl();
  return {
    ...botStatus, lanes, display: displayMode(ctl), mode: ctl.mode, paused: ctl.pausedNewOrders, emergency: ctl.emergency,
    policyAccepted: !!currentPolicy(), funded: acct.deposits > 0, equity: acct.equity,
    state: ctl.emergency ? 'EMERGENCY' : ctl.pausedNewOrders ? 'PAUSED' : ctl.mode === 'OBSERVE' ? 'OBSERVING' : ctl.mode === 'PAPER' ? 'PAPER_TRADING' : ctl.mode === 'APPROVAL' ? 'AWAITING_APPROVAL' : 'BOUNDED_LIVE',
  };
}
export const _test = { onDecision, holdEngine: () => !!holdEngine(), hotLane, protectionLane, scanLane, backgroundLane, resetTakeoverRefusal: () => { takeoverRefused = false; } };
