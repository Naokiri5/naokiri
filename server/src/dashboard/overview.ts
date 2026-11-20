import { all, get } from '../db/db.js';
import { market } from '../market/store.js';
import { bubbleMap } from '../market/bubbles.js';
import { recentDecisions, rejections } from '../market/scanner.js';
import { classifyRegime } from '../regime/regime.js';
import { accountState, PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { currentPolicy } from '../risk/policy.js';
import { getControl, displayMode } from '../core/mode.js';
import { listNotifications } from '../notify/notify.js';
import { providers } from '../providers/http.js';
import { releaseGates } from '../qa/gates.js';
import { listIncidents, type Incident } from '../exec/incidents.js';
import { workerEffectiveness } from '../workers/effectiveness.js';
import { dailyBriefing } from '../joe/joe.js';

/**
 * Overview dashboard snapshot (read-only composition of authoritative state). Every number comes from the module that
 * owns it — ledger, risk policy, control state, scanner, worker stats, provider health — and nothing here computes an
 * official balance, fill or permission. Missing data is returned as null, never filled in.
 */
export type ActivityKind = 'DECISION' | 'FILL' | 'REJECTION' | 'ALERT' | 'INCIDENT';
export interface Activity { at: number; kind: ActivityKind; title: string; detail: string; tone: 'good' | 'bad' | 'warn' | 'info'; link: string | null; count: number; firstAt: number }

const usage = (used: number, limit: number | null) => ({ used: Math.max(0, used), limit, ratio: limit && limit > 0 ? Math.max(0, used) / limit : null });

export function riskMonitor(nowTs = Date.now()) {
  const ctl = getControl(); const pv = currentPolicy(); const pol = pv?.policy ?? null; const a = accountState(PAPER_ACCOUNT, nowTs);
  const incidents = listIncidents();
  return {
    mode: displayMode(ctl), rawMode: ctl.mode, emergency: ctl.emergency, pausedNewOrders: ctl.pausedNewOrders,
    policy: pv ? { version: pv.version, acceptedAt: pv.created_at } : null,
    // Loss usage is the size of today's/this week's loss; gains count as zero usage.
    limits: {
      dailyLossPct: usage(-a.dailyPnlPct, pol?.dailyLossPct ?? null),
      weeklyLossPct: usage(-a.weeklyPnlPct, pol?.weeklyLossPct ?? null),
      drawdownPct: { ...usage(a.drawdownPct, pol?.drawdownHaltPct ?? null), warnAt: pol?.drawdownWarnPct ?? null },
      openRiskPct: usage(a.openRiskPct, pol?.maxOpenRiskPct ?? null),
      positions: usage(a.openCount, pol?.maxConcurrentPositions ?? null),
    },
    incidents: { open: incidents.filter((i) => i.status === 'OPEN').length, awaitingAck: incidents.filter((i) => i.status === 'RECOVERED').length },
    gates: releaseGates().summary,
  };
}

export function pipelineStatus(nowTs = Date.now()) {
  const consensus = all<{ state: string; created_at: number }>('SELECT state, created_at FROM consensus_records ORDER BY created_at DESC LIMIT 50');
  const states: Record<string, number> = {}; for (const c of consensus) states[c.state] = (states[c.state] ?? 0) + 1;
  return {
    scanner: { lastScanAt: market.lastScanAt || null, ageMs: market.lastScanAt ? nowTs - market.lastScanAt : null, universe: market.universe.length, tickersAsOf: market.tickersFetchedAt || null },
    workers: workerEffectiveness().summary,
    consensus: { recent: consensus.length, lastAt: consensus[0]?.created_at ?? null, states },
    providers: providers().map((p) => ({ id: p.id, name: p.name, sourceClass: p.sourceClass, realtime: p.realtime, status: p.status, lastOkAt: p.lastOkAt, lastLatencyMs: p.lastLatencyMs, lastError: p.lastError, requiresCredentials: p.requiresCredentials })),
  };
}

type Raw = Omit<Activity, 'count' | 'firstAt'>;
const sym = (instrument: string) => instrument.split(':').pop() ?? instrument;
export function activityFeed(limit = 25): Activity[] {
  const items: Raw[] = [];
  for (const d of recentDecisions().slice(0, 30)) {
    const final = d.finalDecision as string; const tone = final === 'ENTER' ? 'good' : final === 'REJECT' ? 'bad' : 'info';
    items.push({ at: Date.parse(d.createdAt), kind: 'DECISION', title: `${final} · ${d.asset} (${d.strategy.id})`, detail: d.reason, tone, link: `/decision/${d.id}` });
  }
  for (const f of all<any>(`SELECT f.ts, f.qty, f.price, f.fee, o.side, o.purpose, o.instrument FROM fills f JOIN orders o ON o.id = f.order_id
      WHERE o.account = ? ORDER BY f.ts DESC LIMIT 30`, PAPER_ACCOUNT)) {
    items.push({ at: f.ts, kind: 'FILL', title: `Paper ${f.side} ${sym(f.instrument)} · ${f.purpose}`, detail: `${f.qty} @ ${f.price} (fee ${Number(f.fee).toFixed(4)})`, tone: f.side === 'BUY' ? 'info' : 'good', link: '/history' });
  }
  for (const r of rejections.slice(-30)) items.push({ at: r.at, kind: 'REJECTION', title: `Rejected · ${r.symbol} at ${r.stage}`, detail: r.reason, tone: 'warn', link: '/scanner' });
  for (const n of listNotifications(30) as any[]) {
    if (n.severity === 'INFO') continue;
    items.push({ at: n.ts, kind: 'ALERT', title: `${n.severity} · ${n.title}`, detail: n.body, tone: n.severity === 'CRITICAL' ? 'bad' : 'warn', link: '/notifications' });
  }
  // Feed window ordered by last_seen_at (the time shown), so a long-running OPEN incident is never pushed out by newer ones.
  for (const i of all<Incident>('SELECT * FROM protection_incidents ORDER BY last_seen_at DESC LIMIT 20')) items.push({ at: i.last_seen_at, kind: 'INCIDENT', title: `Protection ${i.status} · ${sym(i.instrument)}`, detail: i.reason, tone: i.status === 'OPEN' ? 'bad' : 'warn', link: '/risk' });
  // Repeated identical events (e.g. the same rejection on every scan cycle) collapse into one row with a count, so a
  // single noisy instrument cannot push everything else out of the feed. The newest occurrence is kept.
  const grouped = new Map<string, Activity>();
  for (const x of items.filter((i) => Number.isFinite(i.at)).sort((a, b) => b.at - a.at)) {
    const key = `${x.kind}|${x.title}|${x.detail}`; const g = grouped.get(key);
    if (g) { g.count++; g.firstAt = x.at; } else grouped.set(key, { ...x, count: 1, firstAt: x.at });
  }
  return [...grouped.values()].slice(0, Math.min(100, Math.max(1, limit)));
}

export function overviewSnapshot(nowTs = Date.now()) {
  const b = bubbleMap({ limit: 60 }); const btc = market.deep.get('crypto:binance:BTCUSDT')?.engines['1h'].last ?? null;
  const realized = get<{ pnl: number | null; fees: number | null; closed: number }>("SELECT SUM(realized_pnl) pnl, SUM(fees) fees, COUNT(*) closed FROM positions WHERE account=? AND status='CLOSED'", PAPER_ACCOUNT)!;
  return {
    // Fields kept from the original /api/overview contract (existing consumers rely on them).
    breadth: b.breadth, btcRegime: classifyRegime(btc), account: accountState(PAPER_ACCOUNT, nowTs), opportunities: recentDecisions().slice(0, 8),
    alerts: listNotifications(8), briefing: dailyBriefing(), movers: [...b.crypto].sort((x, y) => y.changePct - x.changePct), asOf: b.asOf,
    // Added for the dashboard.
    performance: { realizedPnl: realized.pnl ?? 0, feesPaid: realized.fees ?? 0, closedTrades: realized.closed },
    risk: riskMonitor(nowTs), pipeline: pipelineStatus(nowTs), activity: activityFeed(25),
  };
}
