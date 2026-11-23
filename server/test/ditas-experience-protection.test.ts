import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, get, J, run } from '../src/db/db.js';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { paperExperience, experienceGuard } from '../src/ditas/passports.js';
import { verifyPaperClosure, executionQuality } from '../src/ditas/execution.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { memoryEvents, recordClosedPaperOutcome, recordOpportunity, verifyMemory } from '../src/ditas/memory.js';
import { executeExit, submitEntry, autopsy } from '../src/exec/oms.js';
import type { DecisionReport } from '../src/decision/engine.js';

const STRATEGY = 'trend_pullback';

/** Database-only historical fixtures are never presented as independently sourced live performance. */
function closedFixture(id: string, opts: { version?: string; account?: string; r?: number; filled?: boolean } = {}) {
  const account = opts.account ?? PAPER_ACCOUNT, version = opts.version ?? '1.0.0';
  const decisionId = `dec-${id}`, instrumentId = 'crypto:binance:ETHUSDT';
  const at = Date.now() - 10 * 86_400_000 + Number(id.replace(/\D/g, '') || 0) * 1000;
  run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
    decisionId, id, instrumentId, 'crypto', 'LONG', STRATEGY, 'PAPER_TRADE', at - 1, J({ strategy: { id: STRATEGY, version } }));
  run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,
    targets,status,opened_at,closed_at,exit_price,exit_reason,realized_pnl,fees,planned_risk,decision_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, account, instrumentId, 'crypto', 'LONG', STRATEGY, 0, 100, 90, 90,
    '{}', 'CLOSED', at - 3600_000, at, 90, 'STOP', (opts.r ?? -1) * 10, 0, 10, decisionId);
  if (opts.filled === false) return;
  const order = (type: 'ENTRY' | 'EXIT_STOP', side: 'BUY' | 'SELL') => {
    const oid = `ord-${type}-${id}`;
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,
      position_id,decision_id,filled_qty,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      oid, `client-${type}-${id}`, account, 'binance-paper', instrumentId, side, 'MARKET', 1,
      'FILLED', type, id, decisionId, 1, at - 3600_000, at);
    run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)',
      `fill-${type}-${id}`, oid, 1, type === 'ENTRY' ? 100 : 90, 0, 'TAKER', at);
  };
  order('ENTRY', 'BUY'); order('EXIT_STOP', 'SELL');
}

function proposal(id: string, entry: number): { instrumentId: string; entryPrice: number; stopPrice: number; strategyId: string;
  side: 'buy'; idempotencyKey: string; traceId: string } {
  return { instrumentId: id, strategyId: STRATEGY, entryPrice: entry, stopPrice: entry * 0.97,
    side: 'buy', idempotencyKey: 'experience-guard-new-entry', traceId: 'experience-fixture' };
}

function report(id: string, entry: number): DecisionReport {
  const candidateId = 'fixture-entry-paper-outcome';
  return { id: 'fixture-dec-paper-outcome', candidateId, traceId: 'fixture-trace',
    asset: 'ETHUSDT', instrumentId: id, market: 'crypto', venue: 'binance',
    strategy: { id: STRATEGY, version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: entry, stopLoss: entry * 0.97,
    takeProfit: [{ price: entry * 1.045, fraction: 0.5, r: 1.5 }, { price: entry * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1,
      expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any,
  } as DecisionReport;
}

describe('DITAS paper learning + no-trade guard (single canonical OMS)', () => {
  let instrumentId = '', entry = 0;
  beforeEach(() => {
    vi.stubEnv('MIA_PAPER_EXPERIENCE_GUARD', 'SHADOW');
    freshDb(); market.reset(); seedInstrument('BTCUSDT');
    const seeded = seedInstrument('ETHUSDT', { seed: 2 });
    instrumentId = seeded.inst.id; entry = seeded.last;
    acceptPolicy('owner', DEFAULT_POLICY);
    updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  afterEach(() => {
    vi.unstubAllEnvs(); closeDb(); market.reset();
  });

  it('keeps the existing risk decision unchanged in SHADOW with insufficient trade samples', () => {
    for (let i = 0; i < 8; i++) closedFixture(`loss${i}`);
    expect(paperExperience(STRATEGY).verified).toMatchObject({ samples: 8, status: 'INSUFFICIENT_SAMPLE' });
    const risk = evaluateRisk(proposal(instrumentId, entry));
    expect(risk.evaluated.paperExperienceMode).toBe('SHADOW');
    expect(risk.evaluated.paperExperienceSamples).toBe(8);
    expect(risk.reasonCodes.join(' ')).not.toContain('PAPER_EXPERIENCE_NO_TRADE');
  });

  it('uses only current-version and account-scoped paper fills; never promotes a strategy', () => {
    for (let i = 0; i < 30; i++) closedFixture(`legacy${i}`, { filled: false });
    for (let i = 0; i < 4; i++) closedFixture(`current${i}`, { r: 2 });
    closedFixture('oldversion', { version: '0.9.0', r: -100 });
    closedFixture('foreign', { account: 'other-paper-account', r: -100 });
    const health = paperExperience(STRATEGY);
    expect(health).toMatchObject({ account: PAPER_ACCOUNT, observedClosedPositions: 35, excludedOtherVersion: 1,
      excludedUnverifiedFills: 30, verified: { samples: 4, status: 'INSUFFICIENT_SAMPLE', expectancyR: 2 } });
    expect(experienceGuard(STRATEGY).veto).toBe(false);
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', STRATEGY)?.status).toBe('PAPER');
  });

  it('allows a negative-history veto only after >=30 filled, current-version outcomes and explicit opt-in', () => {
    for (let i = 0; i < 30; i++) closedFixture(`verified${i}`, { r: -1 });
    const shadow = experienceGuard(STRATEGY);
    expect(shadow).toMatchObject({ mode: 'SHADOW', status: 'DEGRADED_REVIEW', samples: 30, veto: false });
    expect(evaluateRisk(proposal(instrumentId, entry)).reasonCodes.join(' ')).not.toContain('PAPER_EXPERIENCE_NO_TRADE');
    vi.stubEnv('MIA_PAPER_EXPERIENCE_GUARD', 'ENFORCED');
    const enforced = experienceGuard(STRATEGY);
    expect(enforced).toMatchObject({ mode: 'ENFORCED', veto: true, upper95R: -1 });
    const denied = evaluateRisk(proposal(instrumentId, entry));
    expect(denied.decision).toBe('DENY');
    expect(denied.reasonCodes.join(' ')).toContain('PAPER_EXPERIENCE_NO_TRADE');
    expect(denied.sizing?.riskBudget).toBeLessThanOrEqual(50);
    vi.stubEnv('MIA_PAPER_EXPERIENCE_GUARD', 'unknown');
    expect(experienceGuard(STRATEGY).mode).toBe('SHADOW');
  });

  it('refuses to learn a nominally CLOSED paper trade when total exits are smaller than its entry', () => {
    closedFixture('mismatch-quantities');
    // One valid entry and exit fill still exist; the quantities no longer reconcile.
    run('UPDATE fills SET qty=? WHERE id=?', 0.75, 'fill-EXIT_STOP-mismatch-quantities');
    const evidence = verifyPaperClosure('mismatch-quantities');
    expect(evidence).toMatchObject({ status: 'NEEDS_REVIEW', verified: false });
    expect(evidence.reasonCodes).toContain('ENTRY_EXIT_QTY_MISMATCH');
    expect(executionQuality().closures.find(p => p.positionId === 'mismatch-quantities')?.verified).toBe(false);
    const p = paperExperience(STRATEGY);
    expect(p).toMatchObject({ verified: { samples: 0 }, excludedUnverifiedFills: 1 });
    expect(recordClosedPaperOutcome('mismatch-quantities')).toBeNull();
    autopsy('mismatch-quantities');
    expect(get<{ title: string }>(
      "SELECT title FROM notifications WHERE title LIKE 'Paper closure not verified:%' LIMIT 1",
    )?.title).toMatch(/Paper closure not verified/);
    expect(get<{ title: string }>(
      "SELECT title FROM notifications WHERE title LIKE 'Paper position closed:%' LIMIT 1",
    )).toBeUndefined();
    expect(memoryEvents().filter(e => e.kind === 'TRADE_OUTCOME')).toHaveLength(0);
  });

  it('refuses false closure when a recorded order fill quantity disagrees with its fills', () => {
    closedFixture('order-fill-disagreement');
    run('UPDATE orders SET filled_qty=? WHERE id=?', 0.5, 'ord-ENTRY-order-fill-disagreement');
    expect(verifyPaperClosure('order-fill-disagreement').reasonCodes).toContain('ORDER_FILL_QTY_MISMATCH');
    expect(paperExperience(STRATEGY).verified.samples).toBe(0);
    expect(recordClosedPaperOutcome('order-fill-disagreement')).toBeNull();
  });

  it('records a real closed paper OMS trade once, linked to its original immutable decision snapshot', () => {
    const d = report(instrumentId, entry);
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
      d.id, d.candidateId, instrumentId, 'crypto', 'LONG', STRATEGY, 'PAPER_TRADE', Date.now(), J(d));
    const decisionEvent = recordOpportunity({ kind: 'DECISION', instrumentId, strategyId: STRATEGY,
      interval: '1h', dedupeKey: `decision:${d.id}`, reason: 'fixture approved decision', report: d });
    expect(submitEntry(d, 'bot').ok).toBe(true);
    const p = openPositions(PAPER_ACCOUNT)[0];
    expect(p).toBeDefined();
    expect(verifyPaperClosure(p.id)).toMatchObject({ status: 'OPEN', verified: false });
    const result = executeExit(p.id, p.qty, 'MANUAL_CLOSE');
    expect(result?.closed).toBe(true);
    expect(verifyPaperClosure(p.id)).toMatchObject({ verified: true, status: 'VERIFIED_CLOSED' });
    const outcomes = memoryEvents().filter(e => e.kind === 'TRADE_OUTCOME');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ decisionId: d.id, parentEventId: decisionEvent.id, snapshotId: decisionEvent.snapshotId });
    expect(outcomes[0].payload).toMatchObject({ origin: 'PAPER_OMS_FILLED_ENTRY_AND_EXIT', positionId: p.id });
    expect(outcomes[0].payload.resultR).toEqual(expect.any(Number));
    expect(verifyMemory().ok).toBe(true);
    expect(recordClosedPaperOutcome(p.id)?.id).toBe(outcomes[0].id);
    autopsy(p.id); // repeat must not double-count an outcome
    expect(memoryEvents().filter(e => e.kind === 'TRADE_OUTCOME')).toHaveLength(1);
  });
});
