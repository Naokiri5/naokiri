/**
 * Status ribbon model (blueprint tickets 001/006/008). Pure: derives what the header shows from the last /api/shell
 * response and how long ago it was requested. Missing, malformed, stale or contradictory inputs never produce an
 * 'ok' (green) segment.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'unknown' | 'locked';
export type SegmentId = 'mode' | 'live' | 'data' | 'engine' | 'risk' | 'link';
export interface Segment { id: SegmentId; label: string; value: string; tone: Tone; detail: string; to: string | null }

/** Subset of GET /api/shell the ribbon reads (server/src/api/routes.ts). */
export interface ShellDto {
  mode: 'OBSERVE' | 'PAPER' | 'APPROVAL' | 'BOUNDED_LIVE'; display: string;
  control: { emergency: boolean; pausedNewOrders: boolean };
  bot: { running: boolean; cycles: number; lastScanAt: number; lastTickerAt: number; lastError: string | null; lastMonitorAt?: number; monitorFailing?: boolean };
  account: { equity: number; dailyPnlPct: number; weeklyPnlPct: number; drawdownPct: number; openRiskPct: number; openCount: number; deposits: number; consecutiveLosses: number; marksMissing: number };
  policyAccepted: boolean;
  riskLimits: { dailyLossPct: number; weeklyLossPct: number; drawdownWarnPct: number; drawdownHaltPct: number; maxOpenRiskPct: number; maxConsecutiveLosses: number } | null;
  dataHealth: { stale: boolean; tickersAt: number; scanAt: number; live: number; degraded: number };
  unread: number; gates: string; liveAllowed: boolean; offline: boolean; scanIntervalMs: number; tickerIntervalMs: number; serverTime: number;
}
/** `requestedAt` and `now` are monotonic milliseconds (performance.now()), so a wall-clock jump cannot un-stale a snapshot. */
export interface StatusInput { shell: unknown; requestedAt: number | null; error: string | null; streamConnected: boolean; now: number }
export interface RibbonModel { stale: boolean; lastConfirmedAgo: string | null; segments: Segment[] }

/** The shell is polled every 15 s and refetched on SSE events; three missed polls means we no longer know. */
export const SHELL_STALE_MS = 45_000;
/** Same threshold the server uses for dataHealth.stale (routes.ts /api/shell). */
export const DATA_STALE_MS = 60_000;
/** A lane that misses three of its intervals (minimum 3 min) is stalled. */
export const LANE_STALL_FACTOR = 3;

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
/** Counts must be nonnegative integers: live=-1 used to pass and show green DATA LIVE (CodeRabbit PR #9). */
const count = (x: unknown): x is number => fin(x) && Number.isInteger(x) && x >= 0;
/** Runtime check of every field the model reads: a TypeScript cast is not validation. */
export function isShellDto(x: any): x is ShellDto {
  if (!x || typeof x !== 'object' || typeof x.display !== 'string' || typeof x.mode !== 'string' || typeof x.gates !== 'string') return false;
  const { control: c, bot: b, account: a, dataHealth: d, riskLimits: l } = x;
  return !!c && bool(c.emergency) && bool(c.pausedNewOrders)
    && !!b && bool(b.running) && count(b.cycles) && fin(b.lastScanAt) && fin(b.lastTickerAt)
    && (b.lastMonitorAt === undefined || fin(b.lastMonitorAt)) && (b.monitorFailing === undefined || bool(b.monitorFailing))
    && !!a && [a.dailyPnlPct, a.weeklyPnlPct, a.drawdownPct, a.openRiskPct].every(fin) && count(a.consecutiveLosses) && count(a.marksMissing)
    && !!d && bool(d.stale) && fin(d.tickersAt) && count(d.live) && count(d.degraded)
    && bool(x.policyAccepted) && bool(x.liveAllowed) && bool(x.offline)
    && fin(x.serverTime) && fin(x.scanIntervalMs) && x.scanIntervalMs > 0 && fin(x.tickerIntervalMs) && x.tickerIntervalMs > 0
    && (l === null || (!!l && [l.dailyLossPct, l.weeklyLossPct, l.drawdownWarnPct, l.drawdownHaltPct, l.maxOpenRiskPct, l.maxConsecutiveLosses].every(fin)));
}

const LIVE_LOCKED: Segment = { id: 'live', label: 'Live', value: 'LOCKED', tone: 'locked', detail: 'Real-money execution, signing and withdrawals are locked: this build has no live venue adapter or signer.', to: '/qa' };

export function deriveStatus({ shell: raw, requestedAt, error, streamConnected, now }: StatusInput): RibbonModel {
  const unknown = (id: SegmentId, label: string, value: string, detail: string, to: string | null): Segment => ({ id, label, value, tone: 'unknown', detail, to });
  const valid = isShellDto(raw);
  if (!valid || requestedAt == null) {
    const why = error ? `MIA server unreachable: ${error}` : raw != null ? 'status response is malformed or from an incompatible server' : 'waiting for the first status response';
    const v = error || raw != null ? 'UNKNOWN' : 'CHECKING';
    return { stale: !!error || raw != null, lastConfirmedAgo: null, segments: [
      unknown('mode', 'Mode', v, why, '/bot'), LIVE_LOCKED, unknown('data', 'Data', v, why, '/connections'),
      unknown('engine', 'Engine', v, why, '/bot'), unknown('risk', 'Risk', v, why, '/risk'),
      { id: 'link', label: 'Link', value: error ? 'OFFLINE' : v, tone: error ? 'bad' : 'unknown', detail: why, to: null },
    ] };
  }
  const shell = raw;
  const age = Math.max(0, now - requestedAt);
  const stale = age > SHELL_STALE_MS;
  const confirmed = ago(age);
  const serverNow = shell.serverTime + age;
  const staleNote = `last confirmed ${confirmed} ago — may be out of date`;
  const segs: Segment[] = [];
  const c = shell.control;
  const base = shell.mode === 'OBSERVE' ? 'READ-ONLY' : 'PAPER';

  const modeValue = c.emergency || c.pausedNewOrders ? `${shell.display} · ${base}` : shell.display;
  segs.push(stale
    ? unknown('mode', 'Mode', `${modeValue} · STALE`, `Execution mode ${modeValue}, ${staleNote}`, '/bot')
    : { id: 'mode', label: 'Mode', value: modeValue, tone: c.emergency ? 'bad' : c.pausedNewOrders ? 'warn' : 'locked',
      detail: base === 'READ-ONLY' ? 'READ-ONLY: MIA observes and analyzes; no orders are placed.' : 'PAPER: every balance, order and PnL is simulated. No real funds are used.', to: '/bot' });

  segs.push(shell.liveAllowed
    ? { id: 'live', label: 'Live', value: 'GATES PASSED', tone: 'warn', detail: `${shell.gates}. No live venue adapter or signer exists in this build.`, to: '/qa' }
    : { ...LIVE_LOCKED, detail: `${LIVE_LOCKED.detail} ${shell.gates}.` });

  const d = shell.dataHealth; const tickAge = serverNow - d.tickersAt;
  const dataFresh = !stale && !shell.offline && d.tickersAt > 0 && tickAge >= -5_000 && tickAge <= DATA_STALE_MS && !d.stale && d.live > 0;
  if (stale) segs.push(unknown('data', 'Data', 'STALE', `Market-data health ${staleNote}`, '/connections'));
  else if (shell.offline) segs.push({ id: 'data', label: 'Data', value: 'OFFLINE', tone: 'bad', detail: 'Server runs with MIA_OFFLINE=1: market-data polling is disabled.', to: '/connections' });
  else if (!d.tickersAt) segs.push(unknown('data', 'Data', 'NO DATA', 'No market data received yet.', '/connections'));
  else if (tickAge < -5_000) segs.push(unknown('data', 'Data', 'CLOCK?', 'Last ticker timestamp is in the future relative to the server clock.', '/connections'));
  else if (d.stale || tickAge > DATA_STALE_MS) segs.push({ id: 'data', label: 'Data', value: `STALE · ${ago(tickAge)}`, tone: 'bad', detail: `Last ticker update ${ago(tickAge)} ago. New entries are blocked by the data-quality gate.`, to: '/connections' });
  else if (d.live === 0) segs.push(unknown('data', 'Data', 'NO FEEDS', 'No provider reports LIVE.', '/connections'));
  else if (d.degraded > 0) segs.push({ id: 'data', label: 'Data', value: `DEGRADED · ${d.live} live`, tone: 'warn', detail: `${d.degraded} provider(s) degraded or down, ${d.live} live.`, to: '/connections' });
  else segs.push({ id: 'data', label: 'Data', value: `LIVE · ${ago(tickAge)}`, tone: 'ok', detail: `${d.live} feeds live; last ticker update ${ago(tickAge)} ago.`, to: '/connections' });

  const b = shell.bot; const errNote = b.lastError ? ` Last recorded error (not cleared on recovery): ${b.lastError}.` : '';
  const scanAge = serverNow - b.lastScanAt; const monAt = b.lastMonitorAt ?? b.lastTickerAt; const monAge = serverNow - monAt;
  const scanStall = Math.max(180_000, LANE_STALL_FACTOR * shell.scanIntervalMs); const monStall = Math.max(180_000, LANE_STALL_FACTOR * shell.tickerIntervalMs);
  if (stale) segs.push(unknown('engine', 'Engine', 'STALE', `Engine state ${staleNote}`, '/bot'));
  else if (!b.running) segs.push({ id: 'engine', label: 'Engine', value: shell.offline ? 'OFF (OFFLINE)' : 'STOPPED', tone: 'bad', detail: `The headless scan/monitor loop is not running, so open paper positions are not being monitored.${errNote}`, to: '/bot' });
  // A completion time in the future cannot prove the engine is healthy (CodeRabbit PR #9): same 5 s tolerance as the ticker.
  else if (monAt > serverNow + 5_000 || b.lastScanAt > serverNow + 5_000) segs.push(unknown('engine', 'Engine', 'CLOCK?', `An engine completion time is in the future relative to the server clock.${errNote}`, '/bot'));
  else if (b.monitorFailing) segs.push({ id: 'engine', label: 'Engine', value: 'MONITOR FAILING', tone: 'bad', detail: `The last position-monitor pass failed; open paper positions are not being evaluated.${errNote}`, to: '/bot' });
  else if (!monAt) segs.push(unknown('engine', 'Engine', 'STARTING', `Engine started; position monitor has not completed a pass yet.${errNote}`, '/bot'));
  else if (monAge > monStall) segs.push({ id: 'engine', label: 'Engine', value: `MONITOR STALLED · ${ago(monAge)}`, tone: 'bad', detail: `Position monitoring has not completed for ${ago(monAge)} (expected every ${ago(shell.tickerIntervalMs)}).${errNote}`, to: '/bot' });
  else if (!b.lastScanAt) segs.push(unknown('engine', 'Engine', 'STARTING', `Monitor running; no completed scan yet.${errNote}`, '/bot'));
  else if (scanAge > scanStall) segs.push({ id: 'engine', label: 'Engine', value: `SCAN STALLED · ${ago(scanAge)}`, tone: 'bad', detail: `No completed scan for ${ago(scanAge)} (expected every ${ago(shell.scanIntervalMs)}).${errNote}`, to: '/bot' });
  else segs.push({ id: 'engine', label: 'Engine', value: `SCANNING · ${ago(scanAge)}`, tone: 'ok', detail: `${b.cycles} scan cycles; last scan ${ago(scanAge)} ago, last monitor pass ${ago(monAge)} ago.${errNote}`, to: '/bot' });

  const a = shell.account; const lim = shell.riskLimits;
  const nums = `${a.openRiskPct.toFixed(2)}% open · DD ${a.drawdownPct.toFixed(1)}%`;
  const risk = (value: string, tone: Tone, detail: string) => segs.push({ id: 'risk', label: 'Risk', value, tone, detail, to: '/risk' });
  if (stale) segs.push(unknown('risk', 'Risk', 'STALE', `Risk state ${staleNote}`, '/risk'));
  else if (c.emergency) risk('EMERGENCY STOP', 'bad', 'Emergency stop active: new orders blocked, positions still monitored.');
  else if (!shell.policyAccepted || !lim) risk('NO POLICY', 'warn', 'No risk policy accepted: paper execution stays disabled until the owner accepts one.');
  else if (-a.dailyPnlPct >= lim.dailyLossPct || -a.weeklyPnlPct >= lim.weeklyLossPct || a.drawdownPct >= lim.drawdownHaltPct)
    risk(`BREAKER · ${nums}`, 'bad', `A loss limit is reached (day ${a.dailyPnlPct.toFixed(2)}% vs −${lim.dailyLossPct}%, week ${a.weeklyPnlPct.toFixed(2)}% vs −${lim.weeklyLossPct}%, drawdown ${a.drawdownPct.toFixed(2)}% vs ${lim.drawdownHaltPct}%). The risk gate denies new entries.`);
  else if (a.marksMissing > 0) risk(`MARKS MISSING · ${a.marksMissing}`, 'unknown', `${a.marksMissing} open position(s) have no mark price, so equity, open risk and drawdown are understated and cannot be confirmed. The risk gate denies new entries.`);
  else if (!dataFresh) risk(nums, 'unknown', 'Marks are based on stale or missing market data, so open risk and drawdown cannot be confirmed.');
  else if (a.consecutiveLosses >= lim.maxConsecutiveLosses) risk(`LOSS STREAK · ${a.consecutiveLosses}`, 'warn', `${a.consecutiveLosses} consecutive losses (limit ${lim.maxConsecutiveLosses}): the risk gate applies a cooldown, then requires review.`);
  else if (c.pausedNewOrders || a.drawdownPct >= lim.drawdownWarnPct || a.openRiskPct >= lim.maxOpenRiskPct)
    risk(nums, 'warn', c.pausedNewOrders ? 'New orders paused by the owner or Trader Joe.' : `Near a limit: drawdown warn ${lim.drawdownWarnPct}%, max open risk ${lim.maxOpenRiskPct}%.`);
  else risk(nums, 'ok', `Account-wide limits not reached (max open risk ${lim.maxOpenRiskPct}%, drawdown halt ${lim.drawdownHaltPct}%). Each new entry is still checked by the risk gate.`);

  if (stale) segs.push({ id: 'link', label: 'Link', value: `LOST · ${confirmed}`, tone: 'bad', detail: `No status response for ${confirmed}${error ? ` (${error})` : ''}. Click to retry.`, to: null });
  else if (error) segs.push({ id: 'link', label: 'Link', value: 'RETRYING', tone: 'warn', detail: `Last status request failed (${error}); showing the response from ${confirmed} ago. Click to retry.`, to: null });
  else if (!streamConnected) segs.push({ id: 'link', label: 'Link', value: 'POLLING', tone: 'warn', detail: `Live event stream disconnected; status refreshes every 15 s (last ${confirmed} ago). Click to refresh.`, to: null });
  else segs.push({ id: 'link', label: 'Link', value: 'LIVE', tone: 'ok', detail: `Live event stream connected; status confirmed ${confirmed} ago.`, to: null });

  return { stale, lastConfirmedAgo: confirmed, segments: segs };
}
