import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupOwner } from '../src/api/auth.js';
import { config } from '../src/config.js';
import { verifyAuditChain } from '../src/core/audit.js';
import { updateControl } from '../src/core/mode.js';
import { all, closeDb, get } from '../src/db/db.js';
import { decide } from '../src/decision/engine.js';
import { paperChoiceOutcomes } from '../src/ditas/execution.js';
import { memoryEvents } from '../src/ditas/memory.js';
import { paperFillEvents } from '../src/exec/fillEvents.js';
import { monitorPositions, submitEntry } from '../src/exec/oms.js';
import { buildContext } from '../src/market/scanner.js';
import { market } from '../src/market/store.js';
import { finishDurableClose, openPaperSpotSession, requestPaperSpotClose } from '../src/ops/durableSession.js';
import { acquireOrRenewLease } from '../src/ops/lease.js';
import type { EngineView } from '../src/ops/readiness.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { cashBalance, ledger, openPositions, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import type { Candidate } from '../src/workers/types.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';

async function eligibleDecision(instrument: ReturnType<typeof seedInstrument>) {
  const { inst, last } = instrument;
  const candidate: Candidate = {
    id: `paper-flow-${inst.symbol}`, traceId: `paper-flow-trace-${inst.symbol}`, eventId: `paper-flow-event-${inst.symbol}`,
    instrumentId: inst.id, symbol: inst.symbol, base: inst.base, market: 'crypto', venue: 'binance',
    strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h', regime: 'TREND_UP', createdAt: Date.now(),
    signal: {
      direction: 'long', entryRef: last, stop: last * 0.95, targets: [{ r: 2, fraction: 1 }],
      maxHoldBars: 48, trailAfterR: 1, trigger: 'fixture entry', invalidation: 'stop hit', reasons: ['fixture signal'],
    },
  };
  const context = buildContext(candidate);
  const observed = await runConsensus(context);
  const report = decide(candidate, context, {
    ...observed,
    state: 'STRONG_CONSENSUS',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    weighted_opposition: 0,
    domains: observed.domains.map(domain => ({ ...domain, score: 1, support: 1, oppose: 0, abstain: 0 })),
  }, { trades: 100, expectancyR: 0.2 }, 0);
  expect(report).toMatchObject({ decision: 'PAPER_TRADE', risk: { decision: 'ALLOW' } });
  return report;
}

afterEach(() => {
  vi.useRealTimers();
  closeDb();
  market.reset();
});

describe('BrainOS spot paper evidence flow', () => {
  it('reconciles a fenced decision through its entry and protective exit while a close drains', async () => {
    const start = Date.UTC(2026, 10, 24, 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start - 1_000);
    freshDb();
    market.reset();
    seedInstrument('BTCUSDT');
    const asset = seedInstrument('ETHUSDT');
    const nextAsset = seedInstrument('SOLUSDT');
    const initialCash = 10_000;
    setupOwner('paper flow fixture passphrase');
    acceptPolicy('owner', DEFAULT_POLICY);
    updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', initialCash);
    const fence = acquireOrRenewLease('engine', 'paper-flow-fixture', 60_000)!;
    const engine: EngineView = {
      running: true, role: 'LEADER', startedAt: start - 1_000,
      lastTickerAt: start, lastScanAt: start, lastMonitorAt: start, monitorFailing: false,
    };

    vi.setSystemTime(start);
    const offline = config.offline;
    let session: ReturnType<typeof openPaperSpotSession>;
    try {
      // Exercise the production opener without calling network services or changing the test sign-in mode.
      config.offline = false;
      session = openPaperSpotSession(engine, fence, start);
      expect(session).toMatchObject({ state: 'RUNNING', environment: 'PAPER', mind: 'SPOT_PAPER' });
    } finally {
      config.offline = offline;
    }

    vi.setSystemTime(start + 1_000);
    const decision = await eligibleDecision(asset);
    const nextDecision = await eligibleDecision(nextAsset);
    expect(get('SELECT decision, candidate_id FROM decisions WHERE id=?', decision.id))
      .toEqual({ decision: 'PAPER_TRADE', candidate_id: decision.candidateId });
    const snapshotId = memoryEvents().find(event => event.decisionId === decision.id)?.snapshotId;
    expect(snapshotId).toMatch(/^snap_[a-f0-9]{64}$/);

    const entry = submitEntry(decision, 'bot', undefined, fence);
    expect(entry).toMatchObject({ ok: true, orderId: expect.any(String), positionId: expect.any(String) });
    const position = openPositions()[0];
    expect(position).toMatchObject({ id: entry.positionId, decision_id: decision.id, stop_price: decision.stopLoss });
    expect(get('SELECT status, stop_price FROM orders WHERE position_id=? AND purpose=?', position.id, 'PROTECTIVE_STOP'))
      .toEqual({ status: 'ACTIVE', stop_price: decision.stopLoss });

    vi.setSystemTime(start + 2_000);
    expect(requestPaperSpotClose()).toMatchObject({ state: 'CLOSING_DRAINING_ENTRIES' });
    expect(submitEntry(nextDecision, 'bot', undefined, fence)).toMatchObject({ ok: false, reason: 'SESSION_NOT_RUNNING' });
    expect(get('SELECT id FROM orders WHERE decision_id=?', nextDecision.id)).toBeUndefined();
    expect(() => finishDurableClose(undefined, fence)).toThrow('SESSION_DRAIN_RECONCILIATION_INCOMPLETE');

    vi.setSystemTime(start + 3_000);
    setBook(asset.inst.id, asset.last * 0.94);
    monitorPositions(undefined, fence);
    expect(openPositions()).toHaveLength(0);
    expect(finishDurableClose(undefined, fence)).toMatchObject({ state: 'CLOSED', closed_at: start + 3_000 });
    expect(get('SELECT status FROM orders WHERE position_id=? AND purpose=?', position.id, 'PROTECTIVE_STOP'))
      .toEqual({ status: 'CANCELLED' });

    const fills = all<{ id: string; order_id: string; qty: number; price: number; fee: number; purpose: string }>(
      'SELECT f.*, o.purpose FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.position_id=? ORDER BY f.ts', position.id,
    );
    expect(fills).toMatchObject([{ order_id: entry.orderId, purpose: 'ENTRY' }, { purpose: 'EXIT_STOP' }]);
    const [buy, sell] = fills;
    expect(sell.qty).toBe(buy.qty);
    const netPnl = sell.price * sell.qty - buy.price * buy.qty - buy.fee - sell.fee;
    expect(reconcile()).toMatchObject({ ok: true, closedPositions: 1 });
    expect(cashBalance()).toBeCloseTo(initialCash + netPnl, 8);
    const outcomes = paperChoiceOutcomes([decision.id, nextDecision.id]);
    expect(outcomes).toMatchObject([{ decisionId: decision.id, positionId: position.id, status: 'CLOSED' }]);
    expect(outcomes[0].netPnl).toBeCloseTo(netPnl, 8);

    const sharedEvidence = {
      eventType: 'fill.recorded.v1', traceId: decision.traceId, correlationId: position.id,
      snapshotId, accountId: PAPER_ACCOUNT, environment: 'PAPER',
    };
    const buyEvent = paperFillEvents(0, 1);
    const sellEvent = paperFillEvents(buyEvent.nextAfter, 1);
    expect(buyEvent.events).toMatchObject([{ ...sharedEvidence, eventId: buy.id, causationId: buy.order_id,
      payload: { side: 'BUY', decisionId: decision.id, orderId: buy.order_id, closed: false,
        sessionEvidence: { sessionId: session.session_id, sessionVersion: session.version, fencingEpoch: session.fence_epoch } } }]);
    expect(sellEvent.events).toMatchObject([{ ...sharedEvidence, eventId: sell.id, causationId: sell.order_id,
      payload: { side: 'SELL', decisionId: decision.id, orderId: sell.order_id, closed: true } }]);
    expect(paperFillEvents(sellEvent.nextAfter, 1).events).toHaveLength(0);
    expect(verifyAuditChain().ok).toBe(true);
  });
});
