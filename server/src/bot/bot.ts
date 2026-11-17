import { ensureRules, refreshTickers, refreshDeep, refreshBackground } from '../market/fabric.js';
import { scanOnce } from '../market/scanner.js';
import { monitorPositions, expireApprovals, submitEntry, queueForApproval } from '../exec/oms.js';
import { refreshNews } from '../news/news.js';
import { scanPrints } from '../whales/prints.js';
import { checkStrategyHealth } from '../lab/lab.js';
import { getControl, displayMode } from '../core/mode.js';
import { runStartupChecks, startupReport, type StartupReport } from '../core/startup.js';
import { accountState } from '../portfolio/ledger.js';
import { currentPolicy } from '../risk/policy.js';
import { notify } from '../notify/notify.js';
import { journal } from '../journal/journal.js';
import { bus } from '../core/bus.js';
import { config } from '../config.js';
import { EngineLease } from './lease.js';
import type { DecisionReport } from '../decision/engine.js';

type Lane = 'ticker' | 'monitor' | 'scan' | 'background' | 'startup';
/** Bounded lane error codes; raw exception text goes to the owner's journal only, once per failure streak. */
const CODES: Record<Lane, string> = { ticker: 'TICKER_REFRESH_FAILED', monitor: 'MONITOR_FAILED', scan: 'SCAN_FAILED', background: 'BACKGROUND_FAILED', startup: 'STARTUP_CHECKS_FAILED' };
/**
 * Part 26 funded (paper) bot runtime + Part 33 hot/background lanes. `running` = this process owns the engine lease and
 * lanes are scheduled. lastMonitorAt advances only after a committed position-monitor pass.
 */
export const botStatus = {
  startedAt: 0, running: false, cycles: 0, lastTickerAt: 0, lastMonitorAt: 0, lastScanAt: 0, lastNewsAt: 0, lastPrintsAt: 0,
  laneErrors: { ticker: null, monitor: null, scan: null, background: null, startup: null } as Record<Lane, string | null>, entriesToday: 0, decisionsTotal: 0,
};
/** One scheduler per database (ticket 012). */
export const engineLease = new EngineLease();
let timers: NodeJS.Timeout[] = []; let leaseTimer: NodeJS.Timeout | null = null; let scanning = false; let ticking = false;
const note = (msg: string) => { try { journal('SYSTEM', msg); } catch { /* database unavailable */ } };
function laneError(lane: Lane, e: unknown, code = CODES[lane]) {
  if (e != null && !botStatus.laneErrors[lane]) note(`${lane} lane failed: ${String((e as any)?.message ?? e).slice(0, 200)}`);
  botStatus.laneErrors[lane] = e == null ? null : code;
}
const failStartup = (s: StartupReport) => { const ids = s.checks.filter((c) => c.status !== 'PASS').map((c) => c.id).join(', '); laneError('startup', ids, `${CODES.startup}: ${ids}`); };

function onDecision(r: DecisionReport) {
  if (!engineLease.holds()) return;
  botStatus.decisionsTotal++;
  let entered = false;
  engineLease.fenced(() => {
    const ctl = getControl();
    if (r.decision === 'PAPER_TRADE' && ctl.mode === 'PAPER') entered = submitEntry(r, 'bot').ok;
    else if (r.decision === 'APPROVED_FOR_USER_CONFIRMATION' && ctl.mode !== 'OBSERVE') queueForApproval(r);
  });
  if (entered) botStatus.entriesToday++;
}

async function hotLane() {
  if (!engineLease.holds() || ticking) return; ticking = true;
  try {
    try { await ensureRules(); await refreshTickers(); botStatus.lastTickerAt = Date.now(); laneError('ticker', null); }
    catch (e) { laneError('ticker', e); return; }
    try { if (engineLease.fenced(() => { monitorPositions(); expireApprovals(); })) { botStatus.lastMonitorAt = Date.now(); laneError('monitor', null); } }
    catch (e) { laneError('monitor', e); }
  } finally { ticking = false; }
}
async function scanLane() {
  if (!engineLease.holds() || scanning) return; scanning = true;
  try {
    if (!botStatus.lastTickerAt) await hotLane();
    await refreshDeep();
    if (!engineLease.holds()) return;
    await scanOnce(onDecision); botStatus.lastScanAt = Date.now(); botStatus.cycles++; laneError('scan', null);
    bus.publish('bot', { ...botStatusView() });
  } catch (e) { laneError('scan', e); }
  finally { scanning = false; }
}
async function backgroundLane() {
  const held = () => engineLease.holds();
  let err: unknown = null;
  if (!held()) return;
  try { await refreshBackground(); } catch (e) { err = e; }
  if (!held()) return;
  try { await scanPrints(); botStatus.lastPrintsAt = Date.now(); } catch (e) { err = e; }
  if (!held()) return;
  if (Date.now() - botStatus.lastNewsAt > 5 * 60_000) { try { await refreshNews(); botStatus.lastNewsAt = Date.now(); } catch (e) { err = e; } }
  if (!held()) return;
  try { engineLease.fenced(() => { const s = checkStrategyHealth(); if (s.length) notify('WARNING', 'Strategy auto-suspended', s.join(', '), 'strategy-health'); }); } catch (e) { err = e; }
  laneError('background', err);
}

function startLanes() {
  botStatus.running = true; botStatus.startedAt = Date.now();
  note(`engine lease acquired (epoch ${engineLease.epoch})`);
  note(`MIA engine started in ${displayMode()} mode`);
  hotLane().then(() => backgroundLane()).then(() => scanLane());
  timers = [
    setInterval(hotLane, config.tickerIntervalMs),
    setInterval(scanLane, config.scanIntervalMs),
    setInterval(backgroundLane, 60_000),
  ];
}
function stopLanes() { timers.forEach(clearInterval); timers = []; botStatus.running = false; }
function leaseStep() {
  const { startedAt, lastTickerAt, lastMonitorAt, lastScanAt, cycles, laneErrors } = botStatus;
  const holds = engineLease.tick({ startedAt, lastTickerAt, lastMonitorAt, lastScanAt, cycles, laneErrors });
  if (holds && !botStatus.running) {
    const s = runStartupChecks();
    if (s.ok) return startLanes();
    failStartup(s); engineLease.release();
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = null;
  } else if (!holds && botStatus.running) { stopLanes(); note('engine lease lost'); }
}

export function startBot() {
  if (botStatus.running || leaseTimer || config.offline) return;
  const s = startupReport() ?? runStartupChecks();
  if (!s.ok) return failStartup(s);
  laneError('startup', null);
  leaseTimer = setInterval(leaseStep, engineLease.renewMs);
  leaseStep();
}
export function stopBot() {
  if (leaseTimer) clearInterval(leaseTimer);
  leaseTimer = null; stopLanes(); engineLease.release();
}
export const engineRunning = () => botStatus.running && engineLease.holds();
export function botStatusView() {
  const ctl = getControl(); const acct = accountState(); const s = startupReport();
  const err = Object.entries(botStatus.laneErrors).find(([, e]) => e != null);
  return {
    ...botStatus, running: engineRunning(), lastError: err ? `${err[0]}: ${err[1]}` : null,
    lease: engineLease.view(), ...(s && { startup: { ok: s.ok, failed: s.checks.filter((c) => c.status !== 'PASS').map((c) => c.id) } }),
    display: displayMode(ctl), mode: ctl.mode, paused: ctl.pausedNewOrders, emergency: ctl.emergency,
    policyAccepted: !!currentPolicy(), funded: acct.deposits > 0, equity: acct.equity,
    state: ctl.emergency ? 'EMERGENCY' : ctl.pausedNewOrders ? 'PAUSED' : ctl.mode === 'OBSERVE' ? 'OBSERVING' : ctl.mode === 'PAPER' ? 'PAPER_TRADING' : ctl.mode === 'APPROVAL' ? 'AWAITING_APPROVAL' : 'BOUNDED_LIVE',
  };
}
export const _test = { onDecision, hotLane, scanLane, backgroundLane, leaseStep };
