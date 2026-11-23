import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/db.js';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { buildContext } from '../src/market/scanner.js';
import { decide } from '../src/decision/engine.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { setSetting } from '../src/core/settings.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import type { Candidate } from '../src/workers/types.js';

/**
 * Real canonical decision + risk services, seeded with deterministic market fixtures.
 * This is NOT a simulated live venue, a signer, or proof of live account parity.
 * Approval is PAPER-only; LIVE remains uncertified on this branch.
 */
describe('Canonical decision and risk mode parity (Phase B)', () => {
  let instrumentId: string;
  let price: number;

  beforeEach(() => {
    freshDb();
    market.reset();
    seedInstrument('BTCUSDT');
    const asset = seedInstrument('ETHUSDT');
    instrumentId = asset.inst.id;
    price = asset.last;
    acceptPolicy('owner', DEFAULT_POLICY);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    updateControl('owner', { mode: 'PAPER' });
  });

  afterEach(() => { closeDb(); market.reset(); });

  const proposal = (id: string, last: number) => ({
    instrumentId: id, strategyId: 'trend_pullback', side: 'buy' as const,
    entryPrice: last, stopPrice: last * 0.95,
    idempotencyKey: 'parity-mode-fixture', traceId: 'parity-trace',
  });

  const candidate = (id: string, last: number): Candidate => ({
    id: 'phase-b-parity-candidate', eventId: 'phase-b-parity-event', traceId: 'phase-b-parity-trace',
    instrumentId: id, symbol: 'ETHUSDT', base: 'ETH', market: 'crypto', venue: 'binance',
    strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
    regime: 'TREND_UP', createdAt: Date.now(),
    signal: {
      direction: 'long', entryRef: last, stop: last * 0.95,
      targets: [{ r: 2, fraction: 1 }], maxHoldBars: 48, trailAfterR: 1,
      trigger: 'deterministic test fixture', invalidation: 'stop hit', reasons: ['fixture signal'],
    },
  });

  it('uses identical canonical pre-execution sizing and safety checks for PAPER and paper APPROVAL', () => {
    const input = proposal(instrumentId, price);
    const now = Date.now();
    const paper = evaluateRisk(input, now);
    expect(paper.decision).toBe('ALLOW');
    expect(paper.sizing?.plannedMaxLoss).toBeGreaterThan(0);
    updateControl('owner', { mode: 'APPROVAL' });
    const approval = evaluateRisk(input, now);

    // Shared rules; distinct control modes do not alter sizing or reason codes.
    expect(approval.decision).toBe(paper.decision);
    expect(approval.policyVersion).toBe(paper.policyVersion);
    expect(approval.reasonCodes).toEqual(paper.reasonCodes);
    expect(approval.sizing).toEqual(paper.sizing);
    expect(approval.evaluated.mode).toBe('APPROVAL');
    expect(paper.evaluated.mode).toBe('PAPER');

    updateControl('owner', { emergency: true });
    expect(evaluateRisk(input, now).reasonCodes).toContain('EMERGENCY_STOP_ACTIVE');
    updateControl('owner', { mode: 'PAPER' });
    expect(evaluateRisk(input, now).reasonCodes).toContain('EMERGENCY_STOP_ACTIVE');
  });

  it('never emits a PAPER_TRADE or executable report for a persisted uncertified LIVE mode', async () => {
    const cand = candidate(instrumentId, price);
    const ctx = buildContext(cand);
    expect(ctx.quality.status).not.toBe('FAIL');
    expect(ctx.safety.eligibleForAutomation).toBe(true);

    // Run the actual worker/QCI coordinator; force favorable consensus in a
    // test fixture so the mode-permission branch is definitely exercised.
    const observed = await runConsensus(ctx);
    const favorable = {
      ...observed,
      state: 'STRONG_CONSENSUS' as const,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      weighted_opposition: 0,
      domains: observed.domains.map(d => ({ ...d, score: 1, support: 1, oppose: 0, abstain: 0 })),
    };
    const stats = { trades: 100, expectancyR: 0.2 };
    const paper = decide(cand, ctx, favorable, stats, 0);
    expect(paper.opportunity.score).toBeGreaterThan(DEFAULT_POLICY.minOpportunityScore);
    expect(paper.risk?.decision).toBe('ALLOW');
    expect(paper.decision).toBe('PAPER_TRADE');

    // Reproduce a legacy stored mode without owner API authorization. Do NOT
    // use updateControl() here: this tests a defensive read boundary and must
    // continue to work once PR #117 makes direct LIVE writes impossible.
    setSetting('control', { ...getControl(), mode: 'BOUNDED_LIVE', updatedAt: Date.now() });
    const live = decide({ ...cand, id: 'phase-b-parity-live-fixture' }, ctx, favorable, stats, 0);

    expect(live.opportunity.score).toBe(paper.opportunity.score);
    expect(live.indicators).toEqual(paper.indicators);
    expect(live.decision).toBe('REJECTED');
    expect(live.finalDecision).toBe('REJECT');
    expect(live.positionSize).toBeNull();
    expect(live.risk).toBeNull();
    expect(live.steps.find(s => s.name === 'Execution permission (Part 9)')).toMatchObject({ result: 'FAIL' });
    expect(live.decision).not.toBe('APPROVED_FOR_BOUNDED_EXECUTION');
  });
});
