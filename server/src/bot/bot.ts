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

/** Part 26 funded (paper) bot runtime + Part 33 hot/background lanes. */
export const botStatus = {
  startedAt: 0, running: false, cycles: 0, lastTickerAt: 0, lastScanAt: 0, lastNewsAt: 0, lastPrintsAt: 0,
  lastError: null as string | null, entriesToday: 0, decisionsTotal: 0,
};
let timers: NodeJS.Timeout[] = []; let scanning = false; let ticking = false; let backgrounding = false;

function onDecision(r: DecisionReport) {
  botStatus.decisionsTotal++;
  const ctl = getControl();
  if (r.decision === 'PAPER_TRADE' && ctl.mode === 'PAPER') { const res = submitEntry(r, 'bot'); if (res.ok) botStatus.entriesToday++; }
  else if (r.decision === 'APPROVED_FOR_USER_CONFIRMATION' && ctl.mode !== 'OBSERVE') queueForApproval(r);
}

async function hotLane() {
  if (ticking) return; ticking = true;
  try {
    // Steps fail independently. A rules or ticker outage must never skip position monitoring: with stale prices
    // monitorPositions() raises the "protection unverified" alert, which is exactly when the owner needs it.
    try { await ensureRules(); } catch (e: any) { botStatus.lastError = `rules: ${e.message}`; }
    try { await refreshTickers(); botStatus.lastTickerAt = Date.now(); } catch (e: any) { botStatus.lastError = `ticker: ${e.message}`; }
    // Exits are priced against the book: keep the books of open positions as fresh as the tickers that trigger them.
    try { await refreshBooks(openPositions().map((p) => p.instrument)); } catch (e: any) { botStatus.lastError = `books: ${e.message}`; }
    try { monitorPositions(); expireApprovals(); } catch (e: any) { botStatus.lastError = `monitor: ${e.message}`; }
  }
  finally { ticking = false; }
}
async function scanLane() {
  if (scanning) return; scanning = true;
  try {
    if (!botStatus.lastTickerAt) await hotLane();
    await refreshDeep(); await scanOnce(onDecision); botStatus.lastScanAt = Date.now(); botStatus.cycles++;
    bus.publish('bot', { ...botStatusView() });
  } catch (e: any) { botStatus.lastError = `scan: ${e.message}`; }
  finally { scanning = false; }
}
async function backgroundLane() {
  if (backgrounding) return; backgrounding = true; // a slow pass must not overlap the next (duplicated prints/news)
  try { await backgroundPass(); } finally { backgrounding = false; }
}
async function backgroundPass() {
  try { await refreshBackground(); } catch { /* tracked per provider */ }
  try { await scanPrints(); botStatus.lastPrintsAt = Date.now(); } catch { /* tracked */ }
  if (Date.now() - botStatus.lastNewsAt > 5 * 60_000) { try { await refreshNews(); botStatus.lastNewsAt = Date.now(); } catch { /* tracked */ } }
  try { const s = checkStrategyHealth(); if (s.length) notify('WARNING', 'Strategy auto-suspended', s.join(', '), 'strategy-health'); } catch { /* */ }
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
export function stopBot() { timers.forEach(clearInterval); timers = []; botStatus.running = false; }
export function botStatusView() {
  const ctl = getControl(); const acct = accountState();
  return {
    ...botStatus, display: displayMode(ctl), mode: ctl.mode, paused: ctl.pausedNewOrders, emergency: ctl.emergency,
    policyAccepted: !!currentPolicy(), funded: acct.deposits > 0, equity: acct.equity,
    state: ctl.emergency ? 'EMERGENCY' : ctl.pausedNewOrders ? 'PAUSED' : ctl.mode === 'OBSERVE' ? 'OBSERVING' : ctl.mode === 'PAPER' ? 'PAPER_TRADING' : ctl.mode === 'APPROVAL' ? 'AWAITING_APPROVAL' : 'BOUNDED_LIVE',
  };
}
export const _test = { onDecision };
