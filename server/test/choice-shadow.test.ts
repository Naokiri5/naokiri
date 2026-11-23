import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { evaluateShadowChoices as compare, freezeChoiceEvidence, MAX_SHADOW_CANDIDATES, type ChoiceRoundInput } from '../src/choice/arbitration.js';
import type { DecisionReport } from '../src/decision/engine.js';
import { recordShadowChoice, recentChoiceShadows, verifyMemory } from '../src/ditas/memory.js';
import { all, closeDb, openDb, run } from '../src/db/db.js';
import { freshDb } from './helpers.js';

const T = Date.UTC(2026, 10, 23, 5, 0, 0);
const snapshotId = `snap_${'b'.repeat(64)}`;
const evaluateShadowChoices = (reports: DecisionReport[], round: ChoiceRoundInput) => compare(reports.map((report) => freezeChoiceEvidence(report, snapshotId)), round);
const input = (patch: Partial<ChoiceRoundInput> = {}): ChoiceRoundInput => ({
  roundId: 'choice-test-1', startedAt: T, completedAt: T + 250,
  mode: 'PAPER', totalReportsObserved: 2, ...patch,
});
function accepted(id: string, score: number, costR = 0.1, patch: Partial<DecisionReport> = {}): DecisionReport {
  return {
    id: 'dec_' + id, candidateId: 'cand_' + id, instrumentId: 'crypto:binance:' + id,
    createdAt: new Date(T).toISOString(), traceId: 'trace_test',
    strategy: { id: 'trend_pullback', version: '1.0.0' }, decision: 'PAPER_TRADE',
    opportunity: { score, version: 'NOT_CALIBRATED', factors: [], missing: [] },
    expectedCosts: { costR, feesUsd: 1, spreadBps: 2, slippageBps: 3, funding: 'N/A (spot)' },
    dataFreshness: { status: 'OK', quoteAgeMs: 100, candleAgeMs: 100, bookAgeMs: 100 },
    risk: { decision: 'ALLOW', evaluated: { costR }, sizing: null, reasonCodes: [], policyVersion: 1, ts: new Date(T).toISOString(), traceId: 'test' },
    consensus: { id: 'consensus_' + id, state: 'STRONG_CONSENSUS', support: 0.75, opposition: 0, expiresAt: new Date(T + 60_000).toISOString() },
    ...patch,
  } as unknown as DecisionReport;
}

describe('Choice Management shadow arbitration', () => {
  it('compares eligible observations without changing sequential baseline order', () => {
    const a = accepted('BTCUSDT', 65), b = accepted('ETHUSDT', 92), source = [a, b];
    const round = evaluateShadowChoices(source, input());
    expect(round.firstEligibleDecisionId).toBe(a.id);
    expect(round.selectedDecisionId).toBe(b.id);
    expect(round.changedFromFirstEligible).toBe(true);
    expect(round.rolloutMode).toBe('SHADOW_ONLY');
    expect(round.selectionMetric).toMatch(/UNCALIBRATED/);
    expect(source.map((r) => r.id)).toEqual([a.id, b.id]);
  });
  it('breaks equal scores by like-unit cost and stable asset identity', () => {
    const a = accepted('BTCUSDT', 85, 0.3), b = accepted('ETHUSDT', 85, 0.15);
    expect(evaluateShadowChoices([a, b], input()).selectedDecisionId).toBe(b.id);
    expect(evaluateShadowChoices([b, a], input()).selectedDecisionId).toBe(b.id);
  });
  it('excludes risk-denied, expired, missing-cost and invalid-score decisions', () => {
    const base = accepted('BTCUSDT', 95);
    const denied = accepted('BTCUSDT', 95, 0.1, { risk: { ...base.risk!, decision: 'DENY' } });
    const expiry = accepted('ETHUSDT', 92, 0.1, { consensus: { ...accepted('ETHUSDT', 92).consensus, expiresAt: new Date(T).toISOString() } });
    expect(evaluateShadowChoices([denied, expiry], input()).noTradeReason).toBe('NO_RISK_AUTHORIZED_PAPER_CANDIDATES');
    const valid = accepted('BTCUSDT', 75);
    const invalid = accepted('ETHUSDT', Number.NaN);
    expect(evaluateShadowChoices([valid, invalid], input()).selectedDecisionId).toBe(valid.id);
    const missing = [accepted('BTCUSDT', 95, Number.NaN), accepted('ETHUSDT', 92, Number.NaN)];
    expect(evaluateShadowChoices(missing, input()).selectedDecisionId).toBeNull();
  });
  it('fails closed on mode changes, live modes and an incomplete captured set', () => {
    const reports = [accepted('BTCUSDT', 95), accepted('ETHUSDT', 92)];
    expect(evaluateShadowChoices(reports, input({ modeChanged: true })).noTradeReason).toBe('MODE_CHANGED_DURING_SCAN');
    expect(evaluateShadowChoices(reports, input({ mode: 'BOUNDED_LIVE' })).selectedDecisionId).toBeNull();
    const incomplete = evaluateShadowChoices(reports, input({ totalReportsObserved: MAX_SHADOW_CANDIDATES + 1 }));
    expect(incomplete.incomplete).toBe(true);
    expect(incomplete.selectedDecisionId).toBeNull();
    expect(incomplete.noTradeReason).toBe('CANDIDATE_SET_TRUNCATED');
  });
  it('records a no-trade observation when no candidate exists', () => {
    const r = evaluateShadowChoices([], input({ totalReportsObserved: 0 }));
    expect(r.selectedDecisionId).toBeNull();
    expect(r.noTradeReason).toBe('NO_CANDIDATES');
    expect(r.result).toBe('NO_TRADE');
  });
  it('freezes ranking inputs and requires a decision-time snapshot', () => {
    const observed = accepted('BTCUSDT', 75);
    const frozen = freezeChoiceEvidence(observed, snapshotId);
    observed.opportunity.score = 0;
    const single = input({ totalReportsObserved: 1 });
    expect(compare([frozen], single).candidates[0]).toMatchObject({ opportunityScore: 75, snapshotId, policyVersion: 1 });
    expect(compare([freezeChoiceEvidence(observed)], single).result).toBe('NO_TRADE');
    expect(compare([frozen], { ...single, policyChanged: true }).noTradeReason).toBe('POLICY_CHANGED_DURING_SCAN');
  });
});

describe('DITAS shadow persistence and accounting isolation', () => {
  beforeEach(() => freshDb(false));
  afterEach(() => closeDb());
  it('writes an idempotent immutable DITAS event but no order, fill, position or ledger', () => {
    const round = evaluateShadowChoices([accepted('BTCUSDT', 70), accepted('ETHUSDT', 80)], input());
    const first = recordShadowChoice(round), again = recordShadowChoice(round);
    expect(first.id).toBe(again.id);
    expect(first.kind).toBe('CHOICE_SHADOW');
    expect(verifyMemory().ok).toBe(true);
    expect(recentChoiceShadows()).toMatchObject([{ roundId: round.roundId, selectedDecisionId: 'dec_ETHUSDT' }]);
    expect(() => run('UPDATE ditas_events SET kind=? WHERE id=?', 'TAMPERED', first.id)).toThrow(/immutable/);
    for (const table of ['orders', 'fills', 'positions', 'ledger_entries']) expect(all('SELECT * FROM ' + table)).toHaveLength(0);
  });
  it('survives DB close/reopen, retaining a valid audit hash chain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-choice-'));
    const file = join(dir, 'mia.db');
    try {
      closeDb(); openDb(file);
      recordShadowChoice(evaluateShadowChoices([accepted('BTCUSDT', 80)], input({ totalReportsObserved: 1 })));
      closeDb(); openDb(file);
      expect(recentChoiceShadows(1)[0].selectedDecisionId).toBe('dec_BTCUSDT');
      expect(verifyMemory().ok).toBe(true);
    } finally {
      closeDb(); rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Authenticated choice shadow API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => { freshDb(false); app = await buildApp(); });
  afterEach(async () => { await app.close(); closeDb(); });
  it('is protected, read-only, bounded, and reports incomplete release certification', async () => {
    expect((await app.inject({ url: '/api/choice/shadow' })).statusCode).toBe(401);
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'choice integration test owner' } });
    expect(setup.statusCode).toBe(200);
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    recordShadowChoice(evaluateShadowChoices([], input({ totalReportsObserved: 0 })));
    const r = await app.inject({ url: '/api/choice/shadow?limit=2', headers: { cookie } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      rolloutMode: 'SHADOW_ONLY', releaseReadiness: 'NOT_CERTIFIED', tradingAuthority: false,
      rounds: [{ noTradeReason: 'NO_CANDIDATES' }],
    });
    expect((await app.inject({ url: '/api/choice/shadow?limit=999', headers: { cookie } })).statusCode).toBe(400);
  });
});
