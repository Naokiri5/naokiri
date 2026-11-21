import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assessMarketEmotion, type EmotionInput } from '../src/decision/emotion-evidence.js';

const base = (): EmotionInput => ({
  routing: {
    preference: 'AUTO', marketDataValid: true, mandatoryCoverageComplete: true,
    hardVetoPresent: false, consensusExpired: false,
    conflictingEvidence: false, unusualRegime: false,
    executionUncertain: false, portfolioExposureElevated: false,
    deepReviewBudgetAvailable: true,
  },
  regime: 'TREND_UP', quality: 'OK', qciState: 'STRONG_CONSENSUS',
  priceChange24hPct: 2,
  news: null,
  consecutiveLosses: null,
  protectionIncidentOpen: null,
});

describe('MIA observed market emotion — extends existing THINK evidence', () => {
  it('reports calm but never issues a positive trade or risk authority', () => {
    const a = assessMarketEmotion(base());
    expect(a).toMatchObject({
      state: 'CALM', action: 'OBSERVE', canAuthorizeTrade: false,
      canIncreaseRisk: false, wouldAbstain: false,
      dataClassification: 'OBSERVED_HEURISTIC_NOT_CALIBRATED',
    });
    expect(a.missingEvidence).toContain('NO_VERIFIED_SOCIAL_SENTIMENT_OR_NEWS_COUNTS');
  });
  it('flags hype from price movement AND actual supplied news counts, not price alone', () => {
    const x = assessMarketEmotion({
      ...base(), priceChange24hPct: 25,
      news: { relevant: 5, positive: 4, negative: 0, highImpactMacro: 0 },
    });
    expect(x).toMatchObject({ state: 'HYPE_FOMO', action: 'ABSTAIN', wouldAbstain: true });
    expect(assessMarketEmotion({ ...base(), priceChange24hPct: 25 }).state).toBe('CALM');
  });
  it('prioritizes high volatility + downside shock over ordinary regime explanations', () => {
    const x = assessMarketEmotion({
      ...base(), regime: 'HIGH_VOLATILITY', priceChange24hPct: -15,
    });
    expect(x).toMatchObject({ state: 'PANIC_SHOCK', action: 'ABSTAIN' });
  });
  it('uses verified loss streak and protective incident evidence for recovery', () => {
    expect(assessMarketEmotion({ ...base(), consecutiveLosses: 3 }))
      .toMatchObject({ state: 'RECOVERY', wouldAbstain: true });
    expect(assessMarketEmotion({ ...base(), protectionIncidentOpen: true }))
      .toMatchObject({ state: 'RECOVERY', wouldAbstain: true });
  });
  it('never invents recovery status when the account history was not supplied', () => {
    expect(assessMarketEmotion({ ...base(), consecutiveLosses: null, protectionIncidentOpen: null })
      .state).not.toBe('RECOVERY');
  });
  it('fails closed for missing mandatory evidence, invalid quality and any canonical veto', () => {
    for (const patch of [
      { routing: { ...base().routing, marketDataValid: false } },
      { routing: { ...base().routing, mandatoryCoverageComplete: false } },
      { routing: { ...base().routing, consensusExpired: true } },
      { routing: { ...base().routing, hardVetoPresent: true } },
      { quality: 'FAIL' as const },
      { qciState: 'NO_QUORUM' as const },
      { qciState: 'VETOED' as const },
    ]) {
      const x = assessMarketEmotion({ ...base(), ...patch });
      expect(x).toMatchObject({ state: 'UNCERTAINTY', action: 'ABSTAIN',
        canAuthorizeTrade: false, canIncreaseRisk: false });
    }
  });
  it('requests deeper review for conflicting evidence, stale warnings or uncertain execution', () => {
    const examples: EmotionInput[] = [
      { ...base(), routing: { ...base().routing, conflictingEvidence: true } },
      { ...base(), routing: { ...base().routing, executionUncertain: true } },
      { ...base(), quality: 'WARN' },
      { ...base(), regime: 'UNKNOWN' },
    ];
    for (const data of examples) {
      expect(assessMarketEmotion(data)).toMatchObject({
        state: 'UNCERTAINTY', action: 'REQUEST_DEEP_REVIEW', wouldAbstain: true,
      });
    }
  });
  it('rejects malformed external news counts and price data', () => {
    for (const input of [
      { ...base(), priceChange24hPct: Number.NaN },
      { ...base(), priceChange24hPct: Number.POSITIVE_INFINITY },
      { ...base(), news: { relevant: -1, positive: 4, negative: 0, highImpactMacro: 0 } },
      { ...base(), consecutiveLosses: Number.NaN },
      { ...base(), consecutiveLosses: -10 },
    ]) {
      expect(assessMarketEmotion(input)).toMatchObject({
        state: 'UNCERTAINTY', action: 'ABSTAIN', canAuthorizeTrade: false,
      });
    }
  });
  it('remains a pure observation module with no parallel OMS, signer, wallet or network import', () => {
    const src = readFileSync(new URL('../src/decision/emotion-evidence.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(imports.filter(path => /exec\/|wallet\/|risk\/|providers\/|oms|fetch/.test(path)))
      .toEqual([]);
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
