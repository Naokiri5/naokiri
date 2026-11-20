import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMOTION_ATLAS, MIA_INPUT_BASELINE, BEHAVIORAL_INPUTS, BMIND_DOMAINS, baselineCapabilities, constructById, constructCoverage,
  checkObservation, independentSources, type BehavioralObservation, type InputCapabilities,
} from '../src/bmind/index.js';

/**
 * MIA 5.0 M5-U03a: the B-MIND read-only foundation (JDR-001). These tests pin its safety promises:
 * unknown stays unknown, price alone never proves an emotion, nothing can say "buy", a foundation-level effect never
 * exceeds WAIT (and only EXPLAIN without a calibrated cohort), and nothing outside bmind/ uses it yet.
 */
const SOURCE_NAMES = ['Fear', 'Panic', 'Anxiety', 'Dread', 'Capitulation', 'Despair', 'Regret', 'Relief', 'Hope', 'Optimism', 'Greed',
  'Euphoria', 'FOMO', 'Overconfidence', 'Complacency', 'Conviction', 'Skepticism', 'Distrust', 'Disbelief', 'Confusion', 'Uncertainty',
  'Surprise', 'Curiosity', 'Anticipation', 'Herding', 'Contagion', 'Scarcity/Urgency', 'Anchoring', 'Loss Aversion', 'Confirmation Bias',
  'Impatience', 'Revenge/Frustration'];
const em = (n: number) => `EM-${String(n).padStart(2, '0')}`;
const NOW = 1_795_000_000_000;
const obs = (o: Partial<BehavioralObservation> = {}): BehavioralObservation => ({
  constructId: 'EM-01', state: 'WEAK', instrumentId: 'binance:BTCUSDT', strategyId: 'trend_pullback',
  eventTimeMs: NOW - 5_000, receivedTimeMs: NOW - 4_000, expiresAtMs: NOW + 60_000,
  originIds: ['binance:kline:BTCUSDT:1h:1794999600000'], dependencyGroups: ['binance-price'], modelVersion: 'bmind-0.1',
  features: { downsideVol: 0.4, sellPressure: null }, contraryEvidenceIds: [], effect: 'EXPLAIN', calibration: 'NOT_CALIBRATED', ...o,
});
const reasons = (o: Partial<BehavioralObservation>, caps?: InputCapabilities) => {
  const r = checkObservation(obs(o), NOW, caps);
  return r.ok ? [] : r.reasons;
};

describe('the emotion atlas preserves all 32 source constructs', () => {
  it('has EM-01…EM-32 in source order with the source names, families and planes', () => {
    expect(EMOTION_ATLAS.map((c) => c.id)).toEqual(SOURCE_NAMES.map((_, i) => em(i + 1)));
    expect(EMOTION_ATLAS.map((c) => c.name)).toEqual(SOURCE_NAMES);
    EMOTION_ATLAS.forEach((c, i) => {
      expect(c.family).toBe(i < 24 ? 'MARKET_EMOTION' : i < 30 ? 'COLLECTIVE_BIAS' : 'DISCIPLINE');
      expect(c.plane, c.id).toBe(i >= 29 ? 'MACHINE' : 'MARKET'); // EM-30 audits MIA's own evidence; EM-31/32 its actions
      expect(c.role.length, c.id).toBeGreaterThan(10);
      expect(c.caveat.length, c.id).toBeGreaterThan(10);
    });
    expect(constructById('EM-33')).toBeNull();
  });
  it('uses only known inputs and the six existing QCI domains, and no effect above WAIT', () => {
    for (const c of EMOTION_ATLAS) {
      expect(c.required.length, c.id).toBeGreaterThan(0);
      for (const i of [...c.required, ...c.optional]) expect(BEHAVIORAL_INPUTS, `${c.id} ${i}`).toContain(i);
      expect(c.required.filter((i) => c.optional.includes(i)), c.id).toEqual([]);
      expect(c.domains.length, c.id).toBeGreaterThan(0);
      for (const d of c.domains) expect(BMIND_DOMAINS, `${c.id} ${d}`).toContain(d);
      expect(['NONE', 'EXPLAIN', 'WAIT'], c.id).toContain(c.effectCeiling);
    }
    expect(EMOTION_ATLAS.filter((c) => c.effectCeiling === 'WAIT').map((c) => c.id)).toEqual(['EM-02', 'EM-13', 'EM-22', 'EM-31', 'EM-32']);
  });
  it('is frozen: callers cannot change it', () => {
    expect(Object.isFrozen(EMOTION_ATLAS)).toBe(true);
    expect(Object.isFrozen(EMOTION_ATLAS[0])).toBe(true);
    expect(() => { (EMOTION_ATLAS[0] as { effectCeiling: string }).effectCeiling = 'BLOCK'; }).toThrow();
  });
});

describe('coverage: what MIA can observe with the data it has', () => {
  const byState = (caps?: InputCapabilities) => {
    const out: Record<string, string[]> = { OBSERVABLE: [], WEAK: [], UNKNOWN: [] };
    for (const c of constructCoverage(caps)) out[c.state].push(c.id);
    return out;
  };
  it('today: constructs that need social, options, holder, search or cost-basis data are UNKNOWN, not guessed', () => {
    const s = byState();
    expect(s.UNKNOWN).toEqual(['EM-04', 'EM-07', 'EM-12', 'EM-13', 'EM-16', 'EM-23', 'EM-25', 'EM-27', 'EM-29']);
    expect(s.OBSERVABLE).toEqual(['EM-02', 'EM-08', 'EM-21', 'EM-30', 'EM-31', 'EM-32']);
    expect(s.WEAK).toHaveLength(17);
    expect(constructCoverage().find((c) => c.id === 'EM-13')).toMatchObject({ state: 'UNKNOWN', missing: ['SOCIAL'] });
    expect(constructCoverage().find((c) => c.id === 'EM-01')).toMatchObject({ state: 'WEAK', degraded: ['TRADE_FLOW'] });
  });
  it('fails closed: an input that is not listed counts as unavailable', () => {
    const all = constructCoverage({});
    expect(all.every((c) => c.state === 'UNKNOWN')).toBe(true);
    expect(all.find((c) => c.id === 'EM-02')!.missing).toEqual(['PRICE_VOLUME', 'ORDER_BOOK']);
  });
  it('emotions are never inferred from price alone: price-derived inputs give at most WEAK', () => {
    const everything = Object.fromEntries(BEHAVIORAL_INPUTS.map((i) => [i, 'AVAILABLE'])) as InputCapabilities;
    const full = constructCoverage(everything);
    expect(full.filter((c) => c.state !== 'OBSERVABLE').map((c) => [c.id, c.priceOnly])).toEqual([['EM-26', true], ['EM-28', true]]);
    const priceOnly = constructCoverage({ PRICE_VOLUME: 'AVAILABLE', CROSS_ASSET: 'AVAILABLE' });
    expect(priceOnly.filter((c) => c.state === 'OBSERVABLE')).toEqual([]);
  });
  it('a licensed social feed would change only the constructs that need it; a partial one only to WEAK', () => {
    const base = baselineCapabilities();
    const withSocial = byState({ ...base, SOCIAL: 'AVAILABLE' });
    expect(withSocial.OBSERVABLE).toEqual(expect.arrayContaining(['EM-07', 'EM-12', 'EM-13']));
    expect(withSocial.UNKNOWN).toEqual(['EM-04', 'EM-16', 'EM-23', 'EM-29']);
    expect(byState({ ...base, SOCIAL: 'DEGRADED' }).WEAK).toEqual(expect.arrayContaining(['EM-07', 'EM-12', 'EM-13', 'EM-25']));
  });
  it('the baseline states its evidence and keeps sources MIA does not have as UNAVAILABLE', () => {
    for (const i of BEHAVIORAL_INPUTS) expect(MIA_INPUT_BASELINE[i].evidence.length, i).toBeGreaterThan(10);
    for (const i of ['SOCIAL', 'SEARCH_INTEREST', 'OPTIONS_IV', 'WALLET_HOLDERS', 'COST_BASIS'] as const) expect(MIA_INPUT_BASELINE[i].capability, i).toBe('UNAVAILABLE');
    expect(MIA_INPUT_BASELINE.DEX_ACTIVITY.capability).toBe('DEGRADED'); // DEX Screener counts are not unique wallets
  });
});

describe('observation checks', () => {
  it('accepts an honest observation; ten reposts of one source are one independent source', () => {
    expect(checkObservation(obs(), NOW)).toEqual({ ok: true, state: 'WEAK', independentSources: 1 });
    expect(independentSources({ dependencyGroups: ['x-post-1', 'x-post-1', 'x-post-1', 'binance-price', ' '] })).toBe(2);
  });
  it('turns STALE at expiry instead of staying current', () => {
    const r = checkObservation(obs({ expiresAtMs: NOW }), NOW);
    expect(r).toMatchObject({ ok: true, state: 'STALE' });
  });
  it('cannot claim more than the inputs allow', () => {
    expect(reasons({ state: 'OBSERVED' })).toEqual(['STATE_ABOVE_COVERAGE']); // EM-01 is WEAK today (trade flow is partial)
    expect(reasons({ constructId: 'EM-13', state: 'WEAK' })).toEqual(['STATE_ABOVE_COVERAGE']); // FOMO needs social data
    expect(reasons({ constructId: 'EM-13', state: 'UNKNOWN', features: { mentionSurge: null } })).toEqual([]);
    expect(reasons({ constructId: 'EM-13', state: 'OBSERVED' }, { ...baselineCapabilities(), SOCIAL: 'AVAILABLE' })).toEqual([]);
  });
  it('UNKNOWN carries no numbers a reader could mistake for a measurement', () => {
    expect(reasons({ state: 'UNKNOWN', features: { downsideVol: 0.4 } })).toEqual(['UNKNOWN_WITH_VALUES']);
    expect(reasons({ state: 'UNKNOWN', features: { downsideVol: null }, originIds: [], dependencyGroups: [] })).toEqual([]);
  });
  it('rejects bad timestamps: future events, receipt in the future, expiry before the event, non-integers', () => {
    expect(reasons({ eventTimeMs: NOW - 1_000, receivedTimeMs: NOW - 2_000 })).toEqual(['EVENT_AFTER_RECEIPT']);
    expect(reasons({ receivedTimeMs: NOW + 1, eventTimeMs: NOW - 5_000 })).toEqual(['RECEIVED_IN_FUTURE']);
    expect(reasons({ expiresAtMs: NOW - 5_000 })).toEqual(['EXPIRES_BEFORE_EVENT']);
    expect(reasons({ eventTimeMs: Number.NaN })).toEqual(['INVALID_TIME']);
  });
  it('evidence needs an origin and a dependency group; features must be finite or null', () => {
    expect(reasons({ originIds: [' '] })).toEqual(['NO_ORIGIN']);
    expect(reasons({ dependencyGroups: ['', ' '] })).toEqual(['NO_DEPENDENCY_GROUP']);
    expect(reasons({ features: { downsideVol: Number.POSITIVE_INFINITY } })).toEqual(['NON_FINITE_FEATURE']);
  });
  it('an effect never exceeds the construct ceiling, and nothing beyond EXPLAIN without a calibrated cohort', () => {
    expect(reasons({ effect: 'WAIT' })).toEqual(['EFFECT_ABOVE_CEILING', 'EFFECT_NOT_VALIDATED']); // Fear: EXPLAIN only
    expect(reasons({ constructId: 'EM-02', effect: 'WAIT' })).toEqual(['EFFECT_NOT_VALIDATED']);
    expect(reasons({ constructId: 'EM-02', effect: 'WAIT', calibration: { cohortId: 'cohort-2026-q4', horizonMs: 3_600_000, brier: 0.21 } })).toEqual([]);
    for (const c of EMOTION_ATLAS) expect(reasons({ constructId: c.id, effect: 'BLOCK', state: 'UNKNOWN', features: {} }), c.id).toContain('EFFECT_ABOVE_CEILING');
  });
  it('rejects an invalid calibration, an unknown construct and missing identity', () => {
    expect(reasons({ calibration: { cohortId: ' ', horizonMs: 1, brier: 0.2 } })).toEqual(['INVALID_CALIBRATION']);
    expect(reasons({ calibration: { cohortId: 'c', horizonMs: 1, brier: 1.5 } })).toEqual(['INVALID_CALIBRATION']);
    expect(reasons({ constructId: 'EM-33' })).toEqual(['UNKNOWN_CONSTRUCT']);
    expect(reasons({ instrumentId: ' ', modelVersion: '' })).toEqual(['MISSING_IDENTITY', 'NO_MODEL_VERSION']);
  });
});

describe('boundaries: read-only, not wired, no clock or network', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
  const bmindFiles = files(join(SRC, 'bmind'));
  it('bmind/ has no runtime import from outside bmind/ (type-only imports are erased)', () => {
    for (const f of bmindFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/g)) {
        if (m[2]) continue;
        expect(m[3], `${relative(SRC, f)} imports ${m[3]}`).toMatch(/^\.\/[\w-]+\.js$/);
      }
    }
  });
  it('nothing outside bmind/ imports it yet: B-MIND has no effect on decisions (wiring needs a reviewed PR, M5-U05/U06)', () => {
    const users = files(SRC).filter((f) => !f.includes(`${join(SRC, 'bmind')}`) && /from\s+['"][^'"]*bmind\//.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => relative(SRC, f))).toEqual([]);
  });
  it('bmind/ never reads the wall clock, randomness, the environment or the network', () => {
    for (const f of bmindFiles) expect(readFileSync(f, 'utf8'), relative(SRC, f)).not.toMatch(/Date\.now|new Date\(|Math\.random|process\.env|fetch\(|WebSocket|submitEntry/);
  });
});
