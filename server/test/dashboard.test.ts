import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { rejections } from '../src/market/scanner.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry } from '../src/exec/oms.js';
import { overviewSnapshot, activityFeed, riskMonitor } from '../src/dashboard/overview.js';
import type { DecisionReport } from '../src/decision/engine.js';

/** Overview dashboard contract: figures come from authoritative state; unknowns stay null; noisy repeats collapse. */
function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

describe('overview dashboard snapshot', () => {
  const T = Date.UTC(2026, 10, 10, 12, 0, 0); // fixed clock: fixtures and freshness checks see the same time
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T); freshDb(); market.reset(); rejections.splice(0); });
  afterEach(() => vi.useRealTimers());
  it('keeps the original contract and reports an unfunded, policy-less account honestly', () => {
    const o = overviewSnapshot();
    for (const k of ['breadth', 'btcRegime', 'account', 'opportunities', 'alerts', 'briefing', 'movers', 'asOf']) expect(o, k).toHaveProperty(k);
    expect(o.account.equity).toBe(0); expect(o.performance).toEqual({ realizedPnl: 0, feesPaid: 0, closedTrades: 0 });
    expect(o.risk.policy).toBeNull(); expect(o.risk.limits.dailyLossPct.limit).toBeNull(); expect(o.risk.limits.dailyLossPct.ratio).toBeNull();
    expect(o.pipeline.scanner.lastScanAt).toBeNull(); expect(o.pipeline.workers.registered).toBe(100);
    expect(o.risk.gates).toMatch(/LOCKED/);
  });
  it('risk monitor reads limits from the accepted policy and usage from the ledger', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any;
    expect(submitEntry(report(inst.id, last), 'bot').ok).toBe(true);
    const r = riskMonitor();
    expect(r.mode).toBe('PAPER'); expect(r.policy?.version).toBe(1);
    expect(r.limits.positions).toMatchObject({ used: 1, limit: DEFAULT_POLICY.maxConcurrentPositions });
    expect(r.limits.openRiskPct.limit).toBe(DEFAULT_POLICY.maxOpenRiskPct); expect(r.limits.openRiskPct.used).toBeGreaterThan(0);
    const feed = activityFeed(); expect(feed.find((x) => x.kind === 'FILL')?.title).toMatch(/Paper BUY ETHUSDT · ENTRY/);
    expect(openPositions()).toHaveLength(1);
  });
  it('the feed keeps a long-running OPEN incident even after many newer incidents', async () => {
    const { run } = await import('../src/db/db.js');
    run(`INSERT INTO protection_incidents(id,position_id,instrument,status,reason,opened_at,last_seen_at,last_notified_at,occurrences) VALUES ('inc_old','pos_old','crypto:binance:OLDUSDT','OPEN','still no book',1,${T},1,9)`);
    for (let i = 0; i < 25; i++) run(`INSERT INTO protection_incidents(id,position_id,instrument,status,reason,opened_at,last_seen_at,last_notified_at,occurrences,acknowledged_at) VALUES ('inc_${i}','pos_${i}','crypto:binance:X${i}USDT','ACKNOWLEDGED','old',${1000 + i},${1000 + i},1,1,2)`);
    expect(activityFeed(100).some((x) => x.kind === 'INCIDENT' && x.title.includes('OLDUSDT') && x.title.includes('OPEN'))).toBe(true);
  });
  it('collapses repeated identical events into one row with a count, newest first', () => {
    const t = Date.now();
    for (let i = 0; i < 12; i++) rejections.push({ at: t - i * 1000, symbol: 'NOISYUSDT', stage: 'data-quality', reason: 'stale quote' });
    rejections.push({ at: t - 500, symbol: 'OTHERUSDT', stage: 'risk', reason: 'spread' });
    const feed = activityFeed();
    const noisy = feed.filter((x) => x.title.includes('NOISYUSDT'));
    expect(noisy).toHaveLength(1); expect(noisy[0]).toMatchObject({ count: 12, at: t, firstAt: t - 11_000 });
    expect(feed.some((x) => x.title.includes('OTHERUSDT'))).toBe(true);
    expect(feed.map((x) => x.at)).toEqual([...feed.map((x) => x.at)].sort((a, b) => b - a));
  });
});
