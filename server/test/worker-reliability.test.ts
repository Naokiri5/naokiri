import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, executeExit } from '../src/exec/oms.js';
import { linkClosedTrades } from '../src/ditas/tradeOutcomes.js';
import { workerReliability } from '../src/workers/reliability.js';
import { WORKERS } from '../src/workers/registry.js';
import { run, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

const dataDriven = WORKERS.filter((w) => w.capability === 'DATA_DRIVEN');
const constant = WORKERS.find((w) => w.capability === 'CONSTANT_RULE')!;
/** A dependency group with at least three data-driven members, so its majority is well defined. */
const groupName = [...new Set(dataDriven.map((w) => w.dependencyGroup))].find((g) => dataDriven.filter((w) => w.dependencyGroup === g).length >= 3)!;
const group = dataDriven.filter((w) => w.dependencyGroup === groupName).slice(0, 3);
const loner = dataDriven.find((w) => w.dependencyGroup !== groupName)!;

function report(id: string, last: number, consensusId: string): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: consensusId, state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

const packet = (w: { id: string; dependencyGroup: string }, stance: string) => ({ worker_id: w.id, stance, dependency_group: w.dependencyGroup });

describe('worker reliability from verified outcomes', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  /** One paper round trip whose decision carries the given QCI packets (or none); `win` moves price +/-1% before exit. */
  function trade(win: boolean, packets: object[] | null) {
    setBook(id, last);
    const consensusId = `qci_${Math.random().toString(36).slice(2)}`;
    const decision = report(id, last, consensusId);
    run('INSERT INTO consensus_records(id,candidate_id,instrument,state,created_at,expires_at,record) VALUES (?,?,?,?,?,?,?)',
      consensusId, decision.candidateId, id, 'STRONG_CONSENSUS', Date.now(), Date.now() + 60_000, J(packets ? { consensus_id: consensusId, packets } : { consensus_id: consensusId, packetsCompactedAt: 1 }));
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      decision.id, decision.candidateId, id, 'crypto', 'LONG', decision.strategy.id, decision.decision, 70, 'ALLOW', consensusId, Date.now(), J(decision));
    const r = submitEntry(decision, 'bot');
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const p = openPositions()[0];
    setBook(id, last * (win ? 1.01 : 0.99));
    executeExit(p.id, p.qty, 'TEST');
  }

  it('accounts for exactly the 100 registered workers across the 11 evidence domains', () => {
    const r = workerReliability();
    expect(r.workers).toHaveLength(100);
    expect(new Set(r.workers.map((w) => w.id)).size).toBe(100);
    const byDomain = Object.fromEntries([...new Set(WORKERS.map((w) => w.domain))].map((d) => [d, WORKERS.filter((w) => w.domain === d).length]));
    expect(byDomain).toEqual({ trend: 12, momentum: 10, volatility: 8, flow: 10, liquidity: 10, structure: 10, regime: 8, news: 8, onchain: 6, risk: 10, execution: 8 });
    expect(r.summary).toMatchObject({ registered: 100, measured: 0, policyConfirmations: 3, providerBlocked: 11 });
    expect(r).toMatchObject({ automaticWeightChange: false, tradingAuthority: false });
  });

  it('scores stances against net outcomes, keeps constant rules out of predictive evidence, and counts each dependency group once per trade', () => {
    // Alternate wins and losses so the loss-streak breaker never trips. The "always support" worker is right on wins;
    // the "always oppose" worker is right on losses; the group votes 2:1 SUPPORT, so its majority is SUPPORT.
    for (let i = 0; i < 30; i++) {
      trade(i % 2 === 0, [packet(loner, 'OPPOSE'), packet(constant, 'SUPPORT'), packet(group[0], 'SUPPORT'), packet(group[1], 'SUPPORT'), packet(group[2], 'OPPOSE'), packet(dataDriven.find((w) => w !== loner && !group.includes(w))!, 'ABSTAIN')]);
    }
    trade(true, null); // decision whose packets were compacted: counted, never guessed
    linkClosedTrades(Date.now() + 1);
    const r = workerReliability();
    expect(r.sample).toMatchObject({ verifiedTradesWithEvidence: 30, verifiedTradesWithoutEvidence: 1 });
    expect(r.sample.baseWinRate!.rate).toBeCloseTo(0.5, 12);

    const opposer = r.workers.find((w) => w.id === loner.id)!;
    expect(opposer).toMatchObject({ status: 'MEASURED', votes: 30, supports: 0, opposes: 30, role: 'PREDICTIVE_EVIDENCE', winRateWhenSupporting: null });
    expect(opposer.stanceAccuracy!.rate).toBeCloseTo(0.5, 12);

    const supporter = r.workers.find((w) => w.id === group[0].id)!;
    expect(supporter.winRateWhenSupporting!.rate).toBeCloseTo(0.5, 12);

    // A constant rule is never measured as a predictor, however many votes it casts.
    expect(r.workers.find((w) => w.id === constant.id)).toMatchObject({ role: 'POLICY_CONFIRMATION', status: 'NEEDS_EVIDENCE', votes: 30, stanceAccuracy: null });

    // The three-member group contributes 30 votes (one per trade), not 90.
    const g = r.dependencyGroups.find((x) => x.dependencyGroup === groupName)!;
    expect(g).toMatchObject({ votes: 30, status: 'MEASURED' });
    expect(g.stanceAccuracy!.rate).toBeCloseTo(0.5, 12);
  });

  it('stays NEEDS_EVIDENCE below the minimum sample', () => {
    for (let i = 0; i < 4; i++) trade(i % 2 === 0, [packet(loner, 'SUPPORT')]);
    linkClosedTrades(Date.now() + 1);
    expect(workerReliability().workers.find((w) => w.id === loner.id)).toMatchObject({ status: 'NEEDS_EVIDENCE', votes: 4, stanceAccuracy: null });
  });
});
