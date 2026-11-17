/**
 * Status ribbon model (blueprint ticket 001/006/008). Pure: derives what the header shows from the last /api/shell
 * response and how old that response is. Missing or stale inputs never produce an 'ok' (green) segment.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'unknown' | 'locked';
export type SegmentId = 'mode' | 'live' | 'data' | 'engine' | 'risk' | 'link';
export interface Segment { id: SegmentId; label: string; value: string; tone: Tone; detail: string; to: string | null }

/** Subset of GET /api/shell the ribbon reads (server/src/api/routes.ts). */
export interface ShellDto {
  mode: 'OBSERVE' | 'PAPER' | 'APPROVAL' | 'BOUNDED_LIVE'; display: string;
  control: { emergency: boolean; pausedNewOrders: boolean };
  bot: { running: boolean; cycles: number; lastScanAt: number; lastTickerAt: number; lastError: string | null };
  account: { equity: number; dailyPnlPct: number; drawdownPct: number; openRiskPct: number; openCount: number; deposits: number };
  policyAccepted: boolean;
  riskLimits: { dailyLossPct: number; drawdownWarnPct: number; drawdownHaltPct: number; maxOpenRiskPct: number } | null;
  dataHealth: { stale: boolean; tickersAt: number; scanAt: number; live: number; degraded: number };
  unread: number; gates: string; liveAllowed: boolean; offline: boolean; scanIntervalMs: number; serverTime: number;
}
export interface StatusInput { shell: ShellDto | null; fetchedAt: number | null; error: string | null; streamConnected: boolean; now: number }
export interface RibbonModel { stale: boolean; lastConfirmedAgo: string | null; segments: Segment[] }

/** The shell is polled every 15 s and refetched on SSE events; three missed polls means we no longer know. */
export const SHELL_STALE_MS = 45_000;
/** The engine scans every scanIntervalMs; three missed scans (minimum 3 min) is a stall. */
export const ENGINE_STALL_FACTOR = 3;

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

export function deriveStatus({ shell, fetchedAt, error, streamConnected, now }: StatusInput): RibbonModel {
  const unknown = (id: SegmentId, label: string, value: string, detail: string, to: string | null): Segment => ({ id, label, value, tone: 'unknown', detail, to });
  if (!shell || fetchedAt == null) {
    const why = error ? `MIA server unreachable: ${error}` : 'waiting for the first status response';
    const v = error ? 'UNKNOWN' : 'CHECKING';
    return { stale: !!error, lastConfirmedAgo: null, segments: [
      unknown('mode', 'Mode', v, why, '/bot'), unknown('live', 'Live', v, why, '/qa'), unknown('data', 'Data', v, why, '/connections'),
      unknown('engine', 'Engine', v, why, '/bot'), unknown('risk', 'Risk', v, why, '/risk'),
      { id: 'link', label: 'Link', value: error ? 'OFFLINE' : 'CHECKING', tone: error ? 'bad' : 'unknown', detail: why, to: null },
    ] };
  }
  const age = now - fetchedAt;
  const stale = age > SHELL_STALE_MS;
  const confirmed = ago(age);
  const serverNow = shell.serverTime + age;
  const staleNote = `last confirmed ${confirmed} ago — may be out of date`;
  const segs: Segment[] = [];

  const c = shell.control;
  segs.push(stale
    ? unknown('mode', 'Mode', `${shell.display} · STALE`, `Execution mode ${shell.display}, ${staleNote}`, '/bot')
    : { id: 'mode', label: 'Mode', value: shell.display, tone: c.emergency ? 'bad' : c.pausedNewOrders ? 'warn' : 'locked',
      detail: shell.mode === 'OBSERVE' ? 'READ-ONLY: MIA observes and analyzes; no orders are placed.' : 'PAPER: every balance, order and PnL is simulated. No real funds are used.', to: '/bot' });

  segs.push(shell.liveAllowed
    ? { id: 'live', label: 'Live', value: 'GATES PASSED', tone: 'warn', detail: `${shell.gates}. No live venue adapter or signer exists in this build.`, to: '/qa' }
    : { id: 'live', label: 'Live', value: 'LOCKED', tone: 'locked', detail: `Real-money execution, signing and withdrawals are locked: ${shell.gates}.`, to: '/qa' });

  const d = shell.dataHealth;
  if (stale) segs.push(unknown('data', 'Data', 'STALE', `Market-data health ${staleNote}`, '/connections'));
  else if (shell.offline) segs.push({ id: 'data', label: 'Data', value: 'OFFLINE', tone: 'bad', detail: 'Server runs with MIA_OFFLINE=1: market-data polling is disabled.', to: '/connections' });
  else if (!d.tickersAt) segs.push(unknown('data', 'Data', 'NO DATA', 'No market data received yet.', '/connections'));
  else if (d.stale) segs.push({ id: 'data', label: 'Data', value: `STALE · ${ago(serverNow - d.tickersAt)}`, tone: 'bad', detail: `Last ticker update ${ago(serverNow - d.tickersAt)} ago. New entries are blocked by the data-quality gate.`, to: '/connections' });
  else if (d.degraded > 0) segs.push({ id: 'data', label: 'Data', value: `DEGRADED · ${d.live} live`, tone: 'warn', detail: `${d.degraded} provider(s) degraded or down, ${d.live} live.`, to: '/connections' });
  else segs.push({ id: 'data', label: 'Data', value: `LIVE · ${ago(serverNow - d.tickersAt)}`, tone: 'ok', detail: `${d.live} feeds live; last ticker update ${ago(serverNow - d.tickersAt)} ago.`, to: '/connections' });

  const b = shell.bot; const stallMs = Math.max(180_000, ENGINE_STALL_FACTOR * shell.scanIntervalMs);
  const errNote = b.lastError ? ` Last recorded error: ${b.lastError}.` : '';
  if (stale) segs.push(unknown('engine', 'Engine', 'STALE', `Engine state ${staleNote}`, '/bot'));
  else if (!b.running) segs.push({ id: 'engine', label: 'Engine', value: shell.offline ? 'OFF (OFFLINE)' : 'STOPPED', tone: 'bad', detail: `The headless scan/monitor loop is not running, so open paper positions are not being monitored.${errNote}`, to: '/bot' });
  else if (!b.lastScanAt) segs.push(unknown('engine', 'Engine', 'STARTING', `Engine started; no completed scan yet.${errNote}`, '/bot'));
  else if (serverNow - b.lastScanAt > stallMs) segs.push({ id: 'engine', label: 'Engine', value: `STALLED · ${ago(serverNow - b.lastScanAt)}`, tone: 'bad', detail: `No completed scan for ${ago(serverNow - b.lastScanAt)} (expected every ${ago(shell.scanIntervalMs)}).${errNote}`, to: '/bot' });
  else segs.push({ id: 'engine', label: 'Engine', value: `SCANNING · ${ago(serverNow - b.lastScanAt)}`, tone: 'ok', detail: `${b.cycles} scan cycles; last completed ${ago(serverNow - b.lastScanAt)} ago.${errNote}`, to: '/bot' });

  const a = shell.account; const lim = shell.riskLimits;
  const nums = `${a.openRiskPct.toFixed(2)}% open · DD ${a.drawdownPct.toFixed(1)}%`;
  if (stale) segs.push(unknown('risk', 'Risk', 'STALE', `Risk state ${staleNote}`, '/risk'));
  else if (c.emergency) segs.push({ id: 'risk', label: 'Risk', value: 'EMERGENCY STOP', tone: 'bad', detail: 'Emergency stop active: new orders blocked, positions still monitored.', to: '/risk' });
  else if (!shell.policyAccepted || !lim) segs.push({ id: 'risk', label: 'Risk', value: 'NO POLICY', tone: 'warn', detail: 'No risk policy accepted: paper execution stays disabled until the owner accepts one.', to: '/risk' });
  else if (-a.dailyPnlPct >= lim.dailyLossPct || a.drawdownPct >= lim.drawdownHaltPct) segs.push({ id: 'risk', label: 'Risk', value: `BREAKER · ${nums}`, tone: 'bad', detail: `A loss limit is reached (day ${a.dailyPnlPct.toFixed(2)}% vs −${lim.dailyLossPct}%, drawdown ${a.drawdownPct.toFixed(2)}% vs ${lim.drawdownHaltPct}%). The risk gate denies new entries.`, to: '/risk' });
  else if (d.stale || shell.offline) segs.push(unknown('risk', 'Risk', nums, 'Marks are based on stale or missing prices, so open risk and drawdown cannot be confirmed.', '/risk'));
  else if (c.pausedNewOrders || a.drawdownPct >= lim.drawdownWarnPct || a.openRiskPct >= lim.maxOpenRiskPct) segs.push({ id: 'risk', label: 'Risk', value: nums, tone: 'warn', detail: c.pausedNewOrders ? 'New orders paused by the owner or Trader Joe.' : `Near a limit: drawdown warn ${lim.drawdownWarnPct}%, max open risk ${lim.maxOpenRiskPct}%.`, to: '/risk' });
  else segs.push({ id: 'risk', label: 'Risk', value: nums, tone: 'ok', detail: `Within policy limits (max open risk ${lim.maxOpenRiskPct}%, drawdown halt ${lim.drawdownHaltPct}%).`, to: '/risk' });

  if (stale) segs.push({ id: 'link', label: 'Link', value: `LOST · ${confirmed}`, tone: 'bad', detail: `No status response for ${confirmed}${error ? ` (${error})` : ''}. Click to retry.`, to: null });
  else if (error) segs.push({ id: 'link', label: 'Link', value: 'RETRYING', tone: 'warn', detail: `Last status request failed (${error}); showing the response from ${confirmed} ago. Click to retry.`, to: null });
  else if (!streamConnected) segs.push({ id: 'link', label: 'Link', value: 'POLLING', tone: 'warn', detail: `Live event stream disconnected; status refreshes every 15 s (last ${confirmed} ago). Click to refresh.`, to: null });
  else segs.push({ id: 'link', label: 'Link', value: 'LIVE', tone: 'ok', detail: `Live event stream connected; status confirmed ${confirmed} ago.`, to: null });

  return { stale, lastConfirmedAgo: confirmed, segments: segs };
}
