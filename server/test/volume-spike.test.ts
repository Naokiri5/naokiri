import { describe, expect, it } from 'vitest';
import { FP_SCALE, TradeBarBuilder, type TradeEvent } from '../src/market/tradeBars.js';
import { assessVolumeSpike, VOLUME_SPIKE_POLICY_V1, type VolumeSpikeInput } from '../src/market/volumeSpike.js';

const FP = FP_SCALE;
const T0 = 1_800_000_000_000; // aligned to 1s, 5s and 15s
const WINDOWS = [1_000, 5_000, 15_000] as const;
const BASELINE_SECONDS = 1_200; // 80 bars of 15s history
const MINUTE = 60_000;

/** Deterministic pseudo-random sequence (no Math.random). */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32;
}

type SpikeTrader = (second: number, index: number) => Pick<TradeEvent, 'participant' | 'aggressor'>;
interface Scenario {
  spikeSeconds?: number;
  spikeTradesPerSecond?: number;
  spikeTrader?: SpikeTrader;
  /** Restrict the spike to this many leading seconds of the final 15s bar (persistence tests). */
  baselineSeconds?: number;
}

/** Organic baseline from rotating wallets, then a final 15s window holding the spike under test. */
function scenario({ spikeSeconds = 15, spikeTradesPerSecond = 20, spikeTrader, baselineSeconds = BASELINE_SECONDS }: Scenario = {}) {
  const b = new TradeBarBuilder({
    instrumentId: 'SOLANA_JUPITER:MEME.SOL', baseIntervalMs: 1_000, intervalsMs: [...WINDOWS], allowedLatenessMs: 1_000,
    maxFutureSkewMs: 1_000, maxFinalBars: 200, maxTradesPerBaseBar: 1_000, maxParticipantsPerBar: 1_000,
    retractionWindowMs: 10_000, maxSeenIds: 100_000,
  });
  const random = lcg(42);
  let id = 0;
  const push = (at: number, qty: bigint, who: Pick<TradeEvent, 'participant' | 'aggressor'>) =>
    b.ingest({ instrumentId: b.config.instrumentId, eventId: `tx${++id}:0`, eventTimeMs: at, priceFp: FP,
      baseQtyFp: qty, finality: 'final', ...who }, at);
  // Bursty, heavy-tailed organic flow: 0–6 trades per second, sizes 1–9 units skewed small.
  for (let s = 0; s < baselineSeconds; s++) {
    const count = Math.floor(random() * 7);
    for (let k = 0; k < count; k++) {
      const qty = FP * BigInt(1 + Math.floor(random() ** 3 * 9));
      push(T0 + s * 1_000 + k * 100, qty, { participant: `organic${(s * 7 + k) % 40}`, aggressor: random() < 0.55 ? 'buy' : 'sell' });
    }
  }
  const start = T0 + baselineSeconds * 1_000;
  const trader: SpikeTrader = spikeTrader ?? ((_s, i) => ({ participant: `buyer${i}`, aggressor: 'buy' }));
  for (let s = 0; s < 15; s++) {
    const spiking = s >= 15 - spikeSeconds;
    const count = spiking ? spikeTradesPerSecond : 3;
    for (let i = 0; i < count; i++) {
      const who = spiking ? trader(s, i) : { participant: `organic${i}`, aggressor: 'buy' as const };
      push(start + s * 1_000 + i * 10, spiking ? 5n * FP : FP + FP / 2n, who);
    }
  }
  const nowMs = start + 15_000 + 1_000;
  b.advance(nowMs); // the final 1s, 5s and 15s bars all finalize together
  const input = (over: Partial<VolumeSpikeInput> = {}): VolumeSpikeInput => ({
    windows: WINDOWS.map((intervalMs) => ({ intervalMs, bars: b.finalBars(intervalMs) })), nowMs, launchAgeMs: 6 * 60 * MINUTE, ...over,
  });
  return { builder: b, input };
}

describe('FAST volume-authenticity assessment', () => {
  it('confirms a persistent, broad-based spike as a candidate trigger without trading authority', () => {
    const result = assessVolumeSpike(scenario().input());
    expect(result).toMatchObject({
      policyVersion: VOLUME_SPIKE_POLICY_V1.version, verdict: 'AUTHENTIC_SPIKE', confidence: 'HIGH', flags: [],
      persistentWindows: 3, role: 'CANDIDATE_TRIGGER_ONLY', tradingAuthority: false,
    });
    for (const w of result.windows) {
      expect(w.status).toBe('USABLE');
      expect(w.robustZ!).toBeGreaterThan(VOLUME_SPIKE_POLICY_V1.zThreshold);
      expect(w.acceleration!).toBeGreaterThan(0);
      expect(w.imbalance).toBe(1);
    }
  });

  it('reports no spike for ordinary organic flow', () => {
    const result = assessVolumeSpike(scenario({ spikeSeconds: 0 }).input());
    expect(result).toMatchObject({ verdict: 'NO_SPIKE', persistentWindows: 0, tradingAuthority: false });
  });

  it('flags a spike driven by a single wallet as suspect', () => {
    const result = assessVolumeSpike(scenario({ spikeTrader: () => ({ participant: 'whale1', aggressor: 'buy' }) }).input());
    expect(result.verdict).toBe('SUSPECT_SPIKE');
    expect(result.flags).toEqual(expect.arrayContaining(['CONCENTRATED_FLOW', 'FEW_PARTICIPANTS']));
  });

  it('flags circular two-sided churn (wash-trading indicator) as suspect', () => {
    // Ten wallets alternate sides second by second, so each both buys and sells within the window.
    const wash: SpikeTrader = (s, i) => ({ participant: `ring${i % 10}`, aggressor: (s + i) % 2 ? 'sell' : 'buy' });
    const result = assessVolumeSpike(scenario({ spikeTrader: wash }).input());
    expect(result.verdict).toBe('SUSPECT_SPIKE');
    expect(result.flags).toContain('TWO_SIDED_CHURN');
  });

  it('cannot confirm authenticity when trades lack participant identity', () => {
    const anonymous: SpikeTrader = () => ({ participant: undefined, aggressor: 'buy' });
    const result = assessVolumeSpike(scenario({ spikeTrader: anonymous }).input());
    expect(result.verdict).toBe('SUSPECT_SPIKE');
    expect(result.flags).toContain('PARTICIPANTS_UNKNOWN');
  });

  it('treats a single-window burst as not persistent', () => {
    // Only the last second spikes: the 1s window fires, but 5s and 15s aggregates stay within their baselines.
    const result = assessVolumeSpike(scenario({ spikeSeconds: 1, spikeTradesPerSecond: 12 }).input());
    expect(result.windows[0].spike).toBe(true);
    expect(result.persistentWindows).toBeLessThan(VOLUME_SPIKE_POLICY_V1.minPersistentWindows);
    expect(result).toMatchObject({ verdict: 'NO_SPIKE' });
    expect(result.flags).toContain('NOT_PERSISTENT');
  });

  it('flags deteriorating liquidity and volume beyond executable depth', () => {
    const { input } = scenario();
    const result = assessVolumeSpike(input({ liquidity: { nowQuote: 60, baselineQuote: 100 }, depthQuote: 10 }));
    expect(result.verdict).toBe('SUSPECT_SPIKE');
    expect(result.flags).toEqual(expect.arrayContaining(['LIQUIDITY_DETERIORATING', 'VOLUME_EXCEEDS_DEPTH']));
  });

  it('returns insufficient evidence for short history, and low confidence for a young launch', () => {
    const short = scenario({ baselineSeconds: 30 });
    expect(assessVolumeSpike(short.input()).verdict).toBe('INSUFFICIENT_EVIDENCE');
    const young = assessVolumeSpike(scenario().input({ launchAgeMs: 5 * MINUTE }));
    expect(young).toMatchObject({ verdict: 'AUTHENTIC_SPIKE', confidence: 'LOW' });
  });

  it('refuses to judge from invalidated or gapped latest bars', () => {
    const { builder, input } = scenario();
    const last = builder.finalBars(1_000).at(-1)!;
    builder.markFeedGap(last.startMs, last.endMs);
    const result = assessVolumeSpike(input());
    expect(result.windows.every((w) => w.status === 'UNUSABLE')).toBe(true);
    expect(result.verdict).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('rejects duplicate windows instead of counting one window twice as persistence', () => {
    const { input } = scenario();
    const base = input();
    expect(() => assessVolumeSpike({ ...base, windows: [base.windows[1], base.windows[1]] })).toThrow('DUPLICATE_VOLUME_WINDOW');
    // Bars of the wrong interval make the window unusable.
    const mislabeled = assessVolumeSpike({ ...base, windows: [{ intervalMs: 5_000, bars: base.windows[0].bars }, base.windows[2]] });
    expect(mislabeled.windows[0].status).toBe('UNUSABLE');
  });

  it('treats stale rings as unusable', () => {
    const { input } = scenario();
    const stale = input();
    expect(assessVolumeSpike({ ...stale, nowMs: stale.nowMs + 60_000 }).verdict).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('never confirms a spike against a flat, empty baseline', () => {
    const b = new TradeBarBuilder({
      instrumentId: 'SOLANA_JUPITER:QUIET.SOL', baseIntervalMs: 1_000, intervalsMs: [...WINDOWS], allowedLatenessMs: 1_000,
      maxFutureSkewMs: 1_000, maxFinalBars: 200, maxTradesPerBaseBar: 1_000, maxParticipantsPerBar: 1_000,
      retractionWindowMs: 10_000, maxSeenIds: 100_000,
    });
    let id = 0;
    const push = (at: number, who: string) => b.ingest({ instrumentId: b.config.instrumentId, eventId: `q${++id}:0`, eventTimeMs: at,
      priceFp: FP, baseQtyFp: FP, aggressor: 'buy', participant: who, finality: 'final' }, at);
    push(T0, 'seed'); // one trade opens the history; then 20 minutes of silence
    const start = T0 + 1_200_000;
    for (let s = 0; s < 15; s++) for (let i = 0; i < 6; i++) push(start + s * 1_000 + i * 10, `w${i}`);
    b.advance(start + 16_000);
    const result = assessVolumeSpike({ windows: WINDOWS.map((intervalMs) => ({ intervalMs, bars: b.finalBars(intervalMs) })),
      nowMs: start + 16_000, launchAgeMs: null });
    expect(result.verdict).not.toBe('AUTHENTIC_SPIKE');
    expect(result.flags).toContain('FLAT_BASELINE');
  });

  it('is deterministic for identical inputs', () => {
    expect(assessVolumeSpike(scenario().input())).toEqual(assessVolumeSpike(scenario().input()));
  });
});
