import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, listOrders } from '../src/exec/oms.js';
import { reconcile } from '../src/portfolio/calendar.js';
import type { DecisionReport } from '../src/decision/engine.js';

/**
 * Integration regression for the existing autonomous PAPER lifecycle.
 * No second orchestrator, risk engine, OMS, or venue is introduced.
 * The report is a deterministic fixture, not a claim that QCI research passed.
 */
describe('autonomy integration: existing paper execution and exit authority', () => {
  let instrumentId: string;
  let last: number;
  let sequence = 0;

  const decision = (): DecisionReport => {
    const candidateId = `autonomy-paper-${++sequence}`;
    return {
      id: `decision-${candidateId}`,
      candidateId,
      traceId: `trace-${candidateId}`,
      asset: 'ETHUSDT',
      instrumentId,
      market: 'crypto',
      venue: 'binance',
      strategy: { id: 'trend_pullback', version: '1.0.0' },
      regime: 'TREND_UP',
      entryRef: last,
      stopLoss: last * 0.97,
      takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
      consensus: { id: candidateId, state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      decision: 'PAPER_TRADE',
      opportunity: { score: 70, version: 'v', factors: [], missing: [] },
    } as unknown as DecisionReport;
  };

  beforeEach(() => {
    freshDb();
    market.reset();
    seedInstrument('BTCUSDT');
    const seeded = seedInstrument('ETHUSDT', { seed: 2 });
    instrumentId = seeded.inst.id;
    last = seeded.last;
    sequence = 0;
    acceptPolicy('owner', DEFAULT_POLICY);
    updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  it('routes an approved paper decision through canonical OMS, protection, exit and reconciliation', () => {
    const result = submitEntry(decision(), 'bot');
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(openPositions()).toHaveLength(1);
    expect(listOrders().some((o: any) => o.purpose === 'PROTECTIVE_STOP' && o.status === 'ACTIVE')).toBe(true);

    setBook(instrumentId, last * 0.96);
    monitorPositions();

    expect(openPositions()).toHaveLength(0);
    const reconciliation = reconcile();
    expect(reconciliation.ok).toBe(true);
    expect(reconciliation.positionsRealized).toBeLessThan(0);
    expect(listOrders().filter((o: any) => o.purpose === 'ENTRY' && o.status === 'FILLED')).toHaveLength(1);
  });

  it('does not fabricate an exit from stale market depth; recovers when a fresh book arrives', () => {
    expect(submitEntry(decision(), 'bot').ok).toBe(true);
    const position = openPositions()[0];
    market.deep.get(instrumentId)!.book!.ts = Date.now() - 10 * 60_000;
    const ticker = market.tickers.get(instrumentId)!;
    Object.assign(ticker, { last: last * 0.96, bid: last * 0.9599, ask: last * 0.9601, receivedAt: Date.now() });
    monitorPositions();
    expect(openPositions()).toHaveLength(1);
    expect(openPositions()[0].id).toBe(position.id);
    expect(reconcile().ok).toBe(true);

    setBook(instrumentId, last * 0.96);
    monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });

  it('does not submit a bot trade in approval mode', () => {
    updateControl('owner', { mode: 'APPROVAL' });
    const result = submitEntry(decision(), 'bot');
    expect(result.ok).toBe(false);
    expect(openPositions()).toHaveLength(0);
    expect(getControl().mode).toBe('APPROVAL');
    expect(reconcile().ok).toBe(true);
  });

  it('rejects a decision whose QCI consensus expired', () => {
    const report = decision();
    report.consensus.expiresAt = new Date(Date.now() - 60_000).toISOString();
    const result = submitEntry(report, 'bot');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/EXPIRED/);
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });
});
