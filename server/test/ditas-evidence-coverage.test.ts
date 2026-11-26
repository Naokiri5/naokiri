import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, executeExit } from '../src/exec/oms.js';
import { recordOpportunity } from '../src/ditas/memory.js';
import { linkClosedTrades } from '../src/ditas/tradeOutcomes.js';
import { evidenceCoverage, classifyDecisionEvidence } from '../src/ditas/evidenceCoverage.js';
import { strategyConfigVersion } from '../src/ops/tradingMandate.js';
import { acquireOrRenewLease, type LeaseFence } from '../src/ops/lease.js';
import { run, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

function report(id: string, last: number, consensusId: string): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: `trace_${cid}`, asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: consensusId, state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

describe('EVIDENCE Omega coverage', () => {
  let id = ''; let last = 0; let fence: LeaseFence;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    fence = acquireOrRenewLease('engine', 'worker', 60_000)!;
    // One timestamp: a mandate binds only the exact session start it was authorized with (SESSION_MANDATE_NOT_BOUND).
    const startedAt = Date.now();
    run(`INSERT INTO brainos_sessions (session_id, version, state, environment, mind, lease_holder, lease_acquired_at,
      fence_epoch, suspend_reason, started_at, updated_at, market_scope, capital_ceiling, risk_policy_version, authorized_by,
      authorized_at, expires_at, strategy_config_version)
      VALUES ('brainos-autopilot', 1, 'RUNNING', 'PAPER', 'SPOT_PAPER', ?, ?, 1, 'NONE', ?, ?, 'BINANCE_SPOT', 10000, ?, 'owner:test', ?, ?, ?)`,
      fence.holder, fence.acquired_at, startedAt, startedAt, currentPolicy()!.version, startedAt, startedAt + 86_400_000, strategyConfigVersion());
  });

  /** Store a decision as the engine does; optionally freeze it in DITAS, give it QCI packets, and trade it. */
  function decision(o: { ditas?: boolean; consensus?: 'packets' | 'compacted' | 'none'; trade?: boolean; link?: boolean } = {}) {
    setBook(id, last);
    const consensusId = `qci_${Math.random().toString(36).slice(2)}`;
    const d = report(id, last, consensusId);
    if ((o.consensus ?? 'packets') !== 'none') run('INSERT INTO consensus_records(id,candidate_id,instrument,state,created_at,expires_at,record) VALUES (?,?,?,?,?,?,?)',
      consensusId, d.candidateId, id, 'STRONG_CONSENSUS', Date.now(), Date.now() + 60_000, J(o.consensus === 'compacted' ? { packetsCompactedAt: 1 } : { packets: [{ worker_id: 'W-TRD-01', stance: 'SUPPORT', dependency_group: 'g' }] }));
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      d.id, d.candidateId, id, 'crypto', 'LONG', d.strategy.id, d.decision, 70, 'ALLOW', consensusId, Date.now(), J(d));
    if (o.ditas !== false) recordOpportunity({ kind: 'DECISION', instrumentId: id, strategyId: d.strategy.id, dedupeKey: `decision:${d.id}`, reason: 'test', report: d });
    if (o.trade) {
      const entry = submitEntry(d, 'bot', undefined, fence);
      expect(entry, `entry refused: ${JSON.stringify(entry)}`).toMatchObject({ ok: true });
      const p = openPositions()[0];
      setBook(id, last * 1.01);
      executeExit(p.id, p.qty, 'TEST');
      if (o.link !== false) linkClosedTrades(Date.now() + 1);
    }
    return d;
  }

  it('reports empty samples without inventing coverage', () => {
    expect(evidenceCoverage()).toMatchObject({ decisions: { sample: 0, fullyEvidenced: 0 }, closedTrades: { sample: 0, completeChains: 0, gaps: [] }, tradingAuthority: false });
  });

  it('counts a fully evidenced decision and a reconciled, complete trade chain', () => {
    decision({ trade: true });
    const c = evidenceCoverage();
    expect(c.closedTrades.gaps, `chain gaps: ${JSON.stringify(c.closedTrades.gaps)}`).toEqual([]);
    expect(c.decisions, `decision evidence: ${JSON.stringify(c.decisions)}`).toMatchObject({ sample: 1, fullyEvidenced: 1, byKind: { MARKET_SNAPSHOT: { OBSERVED: 1 }, QCI_FINDINGS: { OBSERVED: 1 }, RISK_DECISION: { VALIDATED: 1 }, DECISION_RECORD: { VALIDATED: 1 } } });
    expect(c.closedTrades).toMatchObject({ sample: 1, completeChains: 1, settlement: { RECONCILED: 1, REJECTED: 0, UNAVAILABLE: 0 }, gaps: [] });
  });

  it('classifies missing and compacted evidence explicitly', () => {
    decision({ ditas: false, consensus: 'none' });
    decision({ consensus: 'compacted' });
    const c = evidenceCoverage();
    expect(c.decisions.fullyEvidenced).toBe(0);
    expect(c.decisions.byKind.MARKET_SNAPSHOT).toEqual({ UNAVAILABLE: 1, OBSERVED: 1 });
    expect(c.decisions.byKind.QCI_FINDINGS).toEqual({ UNAVAILABLE: 1, STALE: 1 });
  });

  it('counts unlinked and altered trades as gaps, never as reconciled', () => {
    decision({ trade: true, link: false });
    expect(evidenceCoverage().closedTrades).toMatchObject({ completeChains: 0, settlement: { RECONCILED: 0, UNAVAILABLE: 1 }, gaps: [{ gap: 'SETTLED_OUTCOME_NOT_LINKED', count: 1 }] });
    linkClosedTrades(Date.now() + 1);
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run('UPDATE ditas_trade_outcomes SET net_pnl=net_pnl+1');
    expect(evidenceCoverage().closedTrades).toMatchObject({ completeChains: 0, settlement: { RECONCILED: 0, REJECTED: 1 }, gaps: [{ gap: 'OUTCOME_RECORD_ALTERED', count: 1 }] });
  });

  it('rejects a decision record that has no strategy or trace identity', () => {
    expect(classifyDecisionEvidence({ id: 'd', created_at: 1, risk_decision: null, report: '{"broken":true}', snapshot_id: null, ditas_event: null, record: null }))
      .toEqual({ MARKET_SNAPSHOT: 'UNAVAILABLE', QCI_FINDINGS: 'UNAVAILABLE', RISK_DECISION: 'UNAVAILABLE', DECISION_RECORD: 'REJECTED' });
  });

  it('validates its sample limits', () => {
    expect(() => evidenceCoverage({ decisions: 0 })).toThrow(/decisions must be/);
    expect(() => evidenceCoverage({ trades: 5000 })).toThrow(/trades must be/);
  });
});
