import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { decide } from '../src/decision/engine.js';
import { get, closeDb } from '../src/db/db.js';
import { routeThinking, thinkSettings } from '../src/decision/think-router.js';
import { analyzeThinking } from '../src/decision/think-adapter.js';
import type { Candidate } from '../src/workers/types.js';
import type { ConsensusRecord } from '../src/qci/schemas.js';

function candidate(instrumentId: string, entry: number): Candidate {
  return {
    id: 'think_cand_' + Math.random().toString(36).slice(2, 10),
    eventId: 'think-event', traceId: 'think-trace',
    instrumentId, symbol: instrumentId.split(':')[2], base: instrumentId.split(':')[2].replace('USDT', ''),
    market: 'crypto', venue: 'binance',
    strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
    signal: {
      direction: 'long', entryRef: entry, stop: entry * 0.97,
      targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }],
      maxHoldBars: 48, trailAfterR: 1, trigger: 'fixture', invalidation: 'fixture', reasons: ['fixture'],
    },
    regime: 'TREND_UP', createdAt: Date.now(),
  };
}

const safeEvidence = () => ({
  preference: 'AUTO' as const, marketDataValid: true, mandatoryCoverageComplete: true,
  hardVetoPresent: false, consensusExpired: false,
  conflictingEvidence: false, unusualRegime: false, executionUncertain: false,
  portfolioExposureElevated: false, deepReviewBudgetAvailable: true,
});

const origMode = process.env.MIA_THINK_MODE, origPreference = process.env.MIA_THINK_PREFERENCE;
afterEach(() => {
  if (origMode === undefined) delete process.env.MIA_THINK_MODE;
  else process.env.MIA_THINK_MODE = origMode;
  if (origPreference === undefined) delete process.env.MIA_THINK_PREFERENCE;
  else process.env.MIA_THINK_PREFERENCE = origPreference;
  closeDb();
});

describe('adaptive THINK router — PDF specification adapted to MIA', () => {
  it('uses the FAST path for complete, non-contradictory evidence', () => {
    expect(routeThinking(safeEvidence())).toMatchObject({ route: 'FAST', canAuthorizeTrade: false });
  });
  it('uses DEEP only for a justified escalation or owner preference', () => {
    expect(routeThinking({ ...safeEvidence(), conflictingEvidence: true }).route).toBe('DEEP');
    expect(routeThinking({ ...safeEvidence(), preference: 'DEEP' }).route).toBe('DEEP');
  });
  it('fails closed on missing data, expired consensus or any existing veto', () => {
    for (const change of [
      { marketDataValid: false },
      { mandatoryCoverageComplete: false },
      { hardVetoPresent: true },
      { consensusExpired: true },
    ]) {
      const p = routeThinking({ ...safeEvidence(), ...change });
      expect(p.route).toBe('NO_TRADE');
      expect(p.canAuthorizeTrade).toBe(false);
    }
  });
  it('cannot silently switch from requested DEEP to FAST under resource pressure', () => {
    const p = routeThinking({ ...safeEvidence(), preference: 'DEEP', deepReviewBudgetAvailable: false });
    expect(p).toMatchObject({ route: 'NO_TRADE', reasons: ['DEEP_REVIEW_UNAVAILABLE'] });
  });
  it('requires explicit valid preferences and defaults to shadow', () => {
    expect(thinkSettings({})).toEqual({ enforcement: 'SHADOW', preference: 'AUTO' });
    expect(() => thinkSettings({ MIA_THINK_MODE: 'LIVE' })).toThrow();
    expect(() => thinkSettings({ MIA_THINK_PREFERENCE: 'NO_TRADE' })).toThrow();
  });
});

describe('adaptive THINK integration — real canonical modules', () => {
  beforeEach(() => {
    freshDb(); market.reset();
    seedInstrument('BTCUSDT');
  });

  it('stores a read-only thinking explanation without modifying the original decision authority', async () => {
    process.env.MIA_THINK_MODE = 'SHADOW';
    process.env.MIA_THINK_PREFERENCE = 'AUTO';
    const { inst, last } = seedInstrument('JUNKUSDT', { quoteVolume: 100_000 });
    const cand = candidate(inst.id, last), ctx = buildContext(cand);
    const qci = await runConsensus(ctx);
    const result = decide(cand, ctx, qci, null, 0);
    expect(result.thinking).toMatchObject({
      version: 'mia-think-observer-v1', authority: 'EXPLANATION_ONLY',
      canAuthorizeTrade: false, enforcement: 'SHADOW', dataTransport: 'CANONICAL_MIA_MARKET_FABRIC',
    });
    expect(result.thinking!.emotion).toMatchObject({
      version: 'mia-market-emotion-overlay-v1',
      canAuthorizeTrade: false, canIncreaseRisk: false,
      dataClassification: 'OBSERVED_HEURISTIC_NOT_CALIBRATED',
    });
    expect(result.decision).not.toBe('PAPER_TRADE');
    const row = get<{ report: string }>('SELECT report FROM decisions WHERE id=?', result.id);
    expect(JSON.parse(row!.report).thinking).toMatchObject({ route: result.thinking!.route });
  });

  it('reuses existing horizon analysis and Profit Lab for DEEP hypothetical scenarios', () => {
    const { inst, last } = seedInstrument('SOLUSDT');
    const ctx = buildContext(candidate(inst.id, last));
    const qci = {
      state: 'STRONG_CONSENSUS',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      domains: [{ domain: 'trend', required: true, support: 1, oppose: 0 }],
      challenge: [],
    } as unknown as ConsensusRecord;
    const a = analyzeThinking({ ctx, qci, correlatedOpen: 0, preference: 'DEEP', enforcement: 'SHADOW' });
    expect(a).toMatchObject({ route: 'DEEP', canAuthorizeTrade: false, deep: { calibration: 'NO_VALID_FORECAST' } });
    expect(a.emotion.canAuthorizeTrade).toBe(false);
    expect(a.emotion.canIncreaseRisk).toBe(false);
    expect(a.deep!.hypotheticalScenarios).toMatchObject({ kind: 'HYPOTHETICAL', valid: true });
    expect(a.deep!.hypotheticalScenarios.scenarios.length).toBeGreaterThan(2);
    expect(a.deep!.hypotheticalScenarios.scenarios.every(s => s.netUsd === null)).toBe(true);
  });

  it('ENFORCED mode never turns an existing veto into permission', async () => {
    process.env.MIA_THINK_MODE = 'ENFORCED';
    process.env.MIA_THINK_PREFERENCE = 'FAST';
    const { inst, last } = seedInstrument('JUNKUSDT', { quoteVolume: 100_000 });
    const cand = candidate(inst.id, last), ctx = buildContext(cand);
    const qci = await runConsensus(ctx);
    const report = decide(cand, ctx, qci, null, 0);
    expect(report.decision).toBe('REJECTED');
    expect(report.thinking!.canAuthorizeTrade).toBe(false);
    expect(report.finalDecision).toBe('REJECT');
  });

  it('staticaly prohibits OMS, wallet and portfolio imports in new thinking modules', () => {
    const src = ['think-router.ts', 'think-adapter.ts']
      .map(f => readFileSync(new URL('../src/decision/' + f, import.meta.url), 'utf8')).join('\n');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(imports.filter(s => /exec\/|wallet\/|portfolio\/|providers\/|oms/.test(s))).toEqual([]);
  });
});
