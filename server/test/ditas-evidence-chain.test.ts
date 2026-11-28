import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, executeExit } from '../src/exec/oms.js';
import { recordOpportunity } from '../src/ditas/memory.js';
import { linkClosedTrades, type TradeOutcomePayload } from '../src/ditas/tradeOutcomes.js';
import { reconstructTradeChain } from '../src/ditas/evidenceChain.js';
import { reflectOnTrade, ENTRY_ERROR_R } from '../src/ditas/reflect.js';
import { strategyConfigVersion } from '../src/ops/tradingMandate.js';
import { acquireOrRenewLease, type LeaseFence } from '../src/ops/lease.js';
import { run, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: `trace_${cid}`, asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

/** A RUNNING spot paper session authorized by the owner, as the durable session layer stores it. */
function runningSession(fence: LeaseFence, startedAt: number) {
  run(`INSERT INTO brainos_sessions (session_id, version, state, environment, mind, lease_holder, lease_acquired_at, lease_epoch,
    fence_epoch, suspend_reason, started_at, updated_at, market_scope, capital_ceiling, risk_policy_version, authorized_by,
    authorized_at, expires_at, strategy_config_version)
    VALUES ('brainos-autopilot', 1, 'RUNNING', 'PAPER', 'SPOT_PAPER', ?, ?, ?, 1, 'NONE', ?, ?, 'BINANCE_SPOT', 10000, ?, 'owner:test', ?, ?, ?)`,
    fence.holder, fence.acquired_at, fence.epoch, startedAt, startedAt, currentPolicy()!.version, startedAt, startedAt + 86_400_000, strategyConfigVersion());
}

describe('trade evidence chain', () => {
  let id = ''; let last = 0; let fence: LeaseFence;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    fence = acquireOrRenewLease('engine', 'worker', 60_000)!;
  });

  /** Decision stored and frozen in DITAS, entry under the session, exit, then the background linker. */
  function fullTrade(options: { session?: boolean; close?: boolean; link?: boolean } = {}) {
    // The session must start after the owner's last control change, or the OMS refuses (SESSION_OWNER_CONTROL_CHANGED).
    if (options.session !== false) runningSession(fence, Date.now());
    const decision = report(id, last);
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      decision.id, decision.candidateId, id, 'crypto', 'LONG', decision.strategy.id, decision.decision, 70, 'ALLOW', 'q', Date.now(), J(decision));
    recordOpportunity({ kind: 'DECISION', instrumentId: id, strategyId: decision.strategy.id, dedupeKey: `decision:${decision.id}`, reason: 'test', report: decision });
    const entry = submitEntry(decision, 'bot', undefined, options.session === false ? undefined : fence);
    expect(entry, JSON.stringify(entry)).toMatchObject({ ok: true });
    if (options.close !== false) {
      const p = openPositions()[0];
      setBook(id, last * 1.01);
      executeExit(p.id, p.qty, 'TEST');
      if (options.link !== false) linkClosedTrades(Date.now() + 1);
    }
    return { decision, positionId: entry.positionId! };
  }

  it('reconstructs session -> trace -> decision -> order -> fill -> position -> settled outcome', () => {
    const { decision, positionId } = fullTrade();
    const chain = reconstructTradeChain(positionId)!;
    expect(chain.gaps).toEqual([]);
    expect(chain.complete).toBe(true);
    expect(chain.session).toMatchObject({ sessionId: 'brainos-autopilot', sessionVersion: 1 });
    expect(chain.traceId).toBe(decision.traceId);
    expect(chain.decision).toMatchObject({ id: decision.id, strategy: 'trend_pullback', regime: 'TREND_UP', riskDecision: 'ALLOW' });
    expect(chain.snapshot?.snapshotId).toMatch(/^snap_/);
    // The protective stop placed with the entry is part of the chain and is cancelled by the closing exit.
    expect(chain.orders.map((o) => [o.purpose, o.status])).toEqual([['ENTRY', 'FILLED'], ['PROTECTIVE_STOP', 'CANCELLED'], ['EXIT_TEST', 'FILLED']]);
    expect(chain.fills).toHaveLength(2);
    expect(chain.fills.every((f) => chain.orders.some((o) => o.id === f.orderId))).toBe(true);
    const ledgerNet = chain.ledger.reduce((s, l) => s + l.amount, 0);
    expect(chain.settledOutcome).toMatchObject({ settlement: 'VERIFIED', hashVerified: true });
    expect(chain.settledOutcome!.netPnl).toBeCloseTo(ledgerNet, 9);
    expect(chain.position!.realizedPnl).toBeCloseTo(ledgerNet, 9);
    expect(chain.reflection).toMatchObject({ outcome: 'WIN', evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY' });
  });

  it('names every missing link instead of inferring it', () => {
    const open = fullTrade({ close: false });
    expect(reconstructTradeChain(open.positionId)).toMatchObject({ complete: false, gaps: ['POSITION_NOT_CLOSED'], settledOutcome: null, reflection: null });
    executeExit(openPositions()[0].id, openPositions()[0].qty, 'TEST');
    expect(reconstructTradeChain(open.positionId)!.gaps).toEqual(['SETTLED_OUTCOME_NOT_LINKED']);
  });

  it('reports an entry made outside a running session', () => {
    const { positionId } = fullTrade({ session: false });
    expect(reconstructTradeChain(positionId)!.gaps).toEqual(['AUTHORIZING_SESSION_NOT_RECORDED']);
  });

  it('refuses to treat an altered outcome record as settled evidence', () => {
    const { positionId } = fullTrade();
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run('UPDATE ditas_trade_outcomes SET net_pnl=net_pnl+5 WHERE position_id=?', positionId);
    expect(reconstructTradeChain(positionId)).toMatchObject({ complete: false, gaps: ['OUTCOME_RECORD_ALTERED'], reflection: null });
  });

  it('returns null for an unknown position', () => {
    expect(reconstructTradeChain('pos_missing')).toBeNull();
  });
});

describe('REFLECT error attribution', () => {
  const payload = (over: { attribution?: Partial<TradeOutcomePayload['attribution']>; execution?: Partial<TradeOutcomePayload['execution']>; regime?: string; entryRef?: number | null } = {}): TradeOutcomePayload => ({
    schema: 'ditas.tradeOutcome.v1', snapshotId: null,
    decision: { id: 'd', score: 70, regime: over.regime ?? 'TREND_UP', consensus: null, entryRef: over.entryRef === undefined ? 100 : over.entryRef, stopLoss: 97 },
    execution: { entryOrderIds: ['o1'], exitOrderIds: ['o2'], entryQty: 1, exitQty: 1, entryAvgPrice: 100, exitAvgPrice: 97, entryNotional: 100, exitProceeds: 97, fees: 0.2, entrySlippageBps: 0, exitReason: 'STOP', holdMs: 1, ...over.execution },
    settlement: { status: 'VERIFIED', issues: [], ledgerNet: -3.2, recordedPnl: -3.2 },
    attribution: { grossPnl: -3, costs: 0.2, netR: -1, maxFavorableR: 0.4, maxAdverseR: -1, movedFavourably: true, costsRemovedEdge: false, reachedOneRBeforeStop: false, lossBeyondPlannedRisk: false, ...over.attribution },
    evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY', tradingAuthority: false,
  });
  const base = { strategy: 'trend_pullback', netPnl: -3.2, netR: -1, firstTargetR: 1.5 };
  const categories = (r: ReturnType<typeof reflectOnTrade>) => r.errors.map((e) => e.category);

  it('attributes a forecast error when the first target was never reached', () => {
    expect(categories(reflectOnTrade({ ...base, payload: payload() }))).toEqual(['FORECAST']);
  });
  it('attributes a strategy error when the decision regime is outside the validated regimes', () => {
    expect(categories(reflectOnTrade({ ...base, payload: payload({ regime: 'RANGE' }) }))).toContain('STRATEGY');
  });
  it('attributes an entry error when entry cost exceeds the threshold in R', () => {
    const costly = payload({ execution: { entryAvgPrice: 100 + 3.2 * (ENTRY_ERROR_R + 0.05) } });
    expect(categories(reflectOnTrade({ ...base, payload: costly }))).toContain('ENTRY');
  });
  it('attributes an exit error when a favourable move was given back', () => {
    // 1.2R also missed the 1.5R first target, so the forecast error is reported alongside the exit error.
    const r = reflectOnTrade({ ...base, payload: payload({ attribution: { maxFavorableR: 1.2, reachedOneRBeforeStop: true } }) });
    expect(categories(r)).toEqual(['FORECAST', 'EXIT']);
  });
  it('attributes an execution error when costs removed the edge or the loss exceeded plan', () => {
    expect(categories(reflectOnTrade({ ...base, netPnl: -0.1, netR: -0.03, payload: payload({ attribution: { grossPnl: 0.1, costsRemovedEdge: true, maxFavorableR: 2 } }) }))).toContain('EXECUTION');
    expect(categories(reflectOnTrade({ ...base, netR: -1.4, payload: payload({ attribution: { lossBeyondPlannedRisk: true } }) }))).toContain('EXECUTION');
  });
  it('reports a clean loss as unattributed and missing evidence as unassessed', () => {
    const clean = reflectOnTrade({ ...base, payload: payload({ attribution: { maxFavorableR: 1.6 } }) });
    expect(clean).toMatchObject({ outcome: 'LOSS_OR_FLAT' });
    expect(categories(clean)).toEqual(['EXIT']);
    const unknown = reflectOnTrade({ ...base, firstTargetR: null, payload: payload({ entryRef: null }) });
    expect(unknown.unassessed.map((u) => u.category)).toEqual(['FORECAST', 'ENTRY']);
    expect(unknown.unattributedLoss).toBe(true);
  });
  it('never attributes errors to a win except execution facts', () => {
    expect(reflectOnTrade({ ...base, netPnl: 5, netR: 1.5, payload: payload({ attribution: { maxFavorableR: 2, grossPnl: 5.2 } }) })).toMatchObject({ outcome: 'WIN', errors: [] });
  });
});
