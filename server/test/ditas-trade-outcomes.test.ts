import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, executeExit } from '../src/exec/oms.js';
import { recordOpportunity } from '../src/ditas/memory.js';
import { all, get, run, J, closeDb } from '../src/db/db.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';
import { DatabaseSync } from 'node:sqlite';
import { linkClosedTrades, strategyOutcomeSummary, tradeOutcomes, verifyTradeOutcomes, MIN_OUTCOME_SAMPLE } from '../src/ditas/tradeOutcomes.js';
import type { DecisionReport } from '../src/decision/engine.js';

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

/** Store the decision as the decision engine does, then open and fully close the paper position. */
function closedTrade(id: string, last: number, exits: number[] = [1], withDitasEvent = false) {
  const r = report(id, last);
  run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    r.id, r.candidateId, id, 'crypto', 'LONG', r.strategy.id, r.decision, 70, 'ALLOW', 'q', Date.now(), J(r));
  const event = withDitasEvent ? recordOpportunity({ kind: 'DECISION', instrumentId: id, strategyId: r.strategy.id, dedupeKey: `decision:${r.id}`, reason: 'test', report: r }) : null;
  const entry = submitEntry(r, 'bot');
  expect(entry, JSON.stringify(entry)).toMatchObject({ ok: true });
  const position = openPositions().find((p) => p.id === entry.positionId)!;
  for (const fraction of exits) executeExit(position.id, position.qty * fraction, 'TEST');
  return { decision: r, positionId: entry.positionId!, event };
}

describe('closed-trade learning linker', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  it('links a settled trade to its decision, DITAS snapshot, orders and ledger-verified settlement', () => {
    const { decision, positionId, event } = closedTrade(id, last, [1], true);
    expect(linkClosedTrades(Date.now() + 1)).toEqual({ linked: 1, verified: 1, mismatched: 0, failed: [] });
    const [outcome] = tradeOutcomes();
    const position = get<any>('SELECT * FROM positions WHERE id=?', positionId);
    const ledgerNet = get<{ n: number }>(`SELECT SUM(amount) n FROM ledger_entries WHERE ref IN (SELECT id FROM orders WHERE position_id=?)`, positionId)!.n;
    expect(outcome).toMatchObject({ positionId, decisionId: decision.id, strategy: 'trend_pullback', strategyVersion: '1.0.0', instrument: id,
      decisionEventId: event!.id, settlement: 'VERIFIED' });
    expect(outcome.payload.snapshotId).toBe(event!.snapshotId);
    expect(outcome.netPnl).toBeCloseTo(position.realized_pnl, 9);
    expect(outcome.netPnl).toBeCloseTo(ledgerNet, 9);
    expect(outcome.netR).toBeCloseTo(position.realized_pnl / position.planned_risk, 9);
    expect(outcome.payload.decision).toMatchObject({ id: decision.id, score: 70, regime: 'TREND_UP', entryRef: last, consensus: { state: 'STRONG_CONSENSUS' } });
    expect(outcome.payload.execution).toMatchObject({ exitReason: 'TEST', entryOrderIds: [expect.any(String)], exitOrderIds: [expect.any(String)] });
    expect(outcome.payload.execution.entryQty).toBeCloseTo(outcome.payload.execution.exitQty, 12);
    expect(outcome.payload.execution.fees).toBeCloseTo(position.fees, 9);
    expect(outcome.payload.attribution.costs).toBeCloseTo(position.fees, 9);
    expect(outcome.payload).toMatchObject({ evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY', tradingAuthority: false });
  });

  it('verifies a trade closed by several partial exits', () => {
    closedTrade(id, last, [0.5, 1]);
    linkClosedTrades(Date.now() + 1);
    const [outcome] = tradeOutcomes();
    expect(outcome.settlement).toBe('VERIFIED');
    expect(outcome.payload.execution.exitOrderIds).toHaveLength(2);
  });

  it('is idempotent and its records are immutable', () => {
    closedTrade(id, last);
    linkClosedTrades(Date.now() + 1);
    expect(linkClosedTrades(Date.now() + 1)).toEqual({ linked: 0, verified: 0, mismatched: 0, failed: [] });
    expect(() => run("UPDATE ditas_trade_outcomes SET net_pnl=1")).toThrow(/immutable/);
    expect(() => run('DELETE FROM ditas_trade_outcomes')).toThrow(/immutable/);
    expect(verifyTradeOutcomes()).toEqual({ ok: true, checked: 1, tampered: [] });
  });

  it('does not link open positions or positions closed after the link time', () => {
    const r = report(id, last);
    expect(submitEntry(r, 'bot').ok).toBe(true);
    expect(linkClosedTrades(Date.now() + 1).linked).toBe(0);
    const position = openPositions()[0];
    executeExit(position.id, position.qty, 'TEST');
    const closedAt = get<{ closed_at: number }>('SELECT closed_at FROM positions WHERE id=?', position.id)!.closed_at;
    expect(linkClosedTrades(closedAt - 1).linked).toBe(0);
    expect(linkClosedTrades(closedAt).linked).toBe(1);
  });

  it('records a settlement that disagrees with the ledger as MISMATCH and keeps it out of summaries', () => {
    const { positionId } = closedTrade(id, last);
    const exitOrder = get<{ id: string }>("SELECT id FROM orders WHERE position_id=? AND purpose LIKE 'EXIT_%'", positionId)!.id;
    ledger(PAPER_ACCOUNT, 'SELL', 25, exitOrder, 'unexplained credit', Date.now());
    expect(linkClosedTrades(Date.now() + 1)).toEqual({ linked: 1, verified: 0, mismatched: 1, failed: [] });
    const [outcome] = tradeOutcomes();
    expect(outcome.settlement).toBe('MISMATCH');
    expect(outcome.payload.settlement.issues).toEqual(expect.arrayContaining(['LEDGER_SELL_MISMATCH', 'RECORDED_PNL_MISMATCH']));
    expect(strategyOutcomeSummary()).toMatchObject({ strategies: [], mismatchedSettlements: 1 });
  });

  it('detects a record altered after linking', () => {
    const { positionId } = closedTrade(id, last);
    linkClosedTrades(Date.now() + 1);
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run('UPDATE ditas_trade_outcomes SET net_pnl=net_pnl+100 WHERE position_id=?', positionId);
    expect(verifyTradeOutcomes()).toEqual({ ok: false, checked: 1, tampered: [positionId] });
  });

  it('writes nothing without the engine lease', () => {
    closedTrade(id, last);
    expect(() => linkClosedTrades(Date.now() + 1, { fence: { name: 'engine', holder: 'not-the-leader', acquired_at: 1 } as any })).toThrow();
    expect(all('SELECT position_id FROM ditas_trade_outcomes')).toHaveLength(0);
  });

  it('summarises verified outcomes per strategy version as review evidence below the minimum sample', () => {
    closedTrade(id, last);
    linkClosedTrades(Date.now() + 1);
    const summary = strategyOutcomeSummary();
    expect(summary).toMatchObject({ minimumSample: MIN_OUTCOME_SAMPLE, automaticPromotion: false, tradingAuthority: false, mismatchedSettlements: 0 });
    expect(summary.strategies).toEqual([expect.objectContaining({ strategy: 'trend_pullback', strategyVersion: '1.0.0', verifiedTrades: 1, status: 'INSUFFICIENT_SAMPLE' })]);
  });

  it('adds the outcome table to a v9 database without changing existing positions', () => {
    closeDb();
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 9);
    raw.prepare(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk)
      VALUES ('keep','paper-bot','crypto:binance:ETHUSDT','crypto','LONG','trend_pullback',0,100,97,97,'{}','CLOSED',1,2,-1.5,0.2,3)`).run();
    migrate(raw);
    expect((raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
    expect(raw.prepare("SELECT realized_pnl FROM positions WHERE id='keep'").get()).toEqual({ realized_pnl: -1.5 });
    expect(raw.prepare('SELECT COUNT(*) n FROM ditas_trade_outcomes').get()).toEqual({ n: 0 });
    raw.close();
  });

  it('rejects invalid link parameters', () => {
    expect(() => linkClosedTrades(0)).toThrow('INVALID_LINK_TIME');
    expect(() => linkClosedTrades(Date.now(), { batch: 0 })).toThrow('INVALID_LINK_BATCH');
    expect(() => tradeOutcomes(0)).toThrow();
  });
});
