import type { TradeBar } from './tradeBars.js';

/**
 * FAST volume-authenticity assessment (BrainOS V2 roadmap P1.3).
 *
 * A volume spike is a candidate trigger for research, never a buy command. This function is pure and deterministic.
 * It reads only final trade-built bars and returns evidence with `tradingAuthority: false`. Thresholds are a
 * versioned research policy for DITAS attribution, not calibrated production truth. Calibrate them per pool and market
 * from replay before relying on them.
 */
export const VOLUME_SPIKE_POLICY_V1 = Object.freeze({
  version: 'volume-spike.v1',
  /** Fewer usable baseline bars than this in a window means that window cannot judge a spike. */
  minBaselineBars: 20,
  /** Baselines shorter than this are usable but lower confidence. */
  recommendedBaselineBars: 60,
  /** Robust z-score (median and MAD) of quote volume a window must reach. */
  zThreshold: 4,
  /** Windows (for example 1s, 5s and 15s) that must spike together to count as persistent. */
  minPersistentWindows: 2,
  minTradesInBar: 5,
  minParticipants: 5,
  maxTopParticipantShare: 0.5,
  maxTwoSidedShare: 0.35,
  maxLiquidityDropPct: 20,
  /** Latest-bar quote volume above this multiple of executable depth suggests impact-driven, illiquid prints. */
  maxVolumeToDepth: 3,
  /** Launches younger than this have short history; their assessment is low confidence. */
  youngLaunchMs: 30 * 60_000,
  /** Scale floor (quote units) that keeps a flat baseline from producing an infinite z-score. */
  minScaleQuote: 1,
  /** A window's latest bar must have ended within its interval plus this allowance of `nowMs`, or it is stale. */
  maxBarAgeMs: 5_000,
});
export type VolumeSpikePolicy = typeof VOLUME_SPIKE_POLICY_V1;

export type VolumeSpikeVerdict = 'AUTHENTIC_SPIKE' | 'SUSPECT_SPIKE' | 'NO_SPIKE' | 'INSUFFICIENT_EVIDENCE';
export type VolumeSpikeFlag =
  | 'PARTICIPANTS_UNKNOWN' | 'PARTICIPANTS_TRUNCATED' | 'FEW_PARTICIPANTS' | 'CONCENTRATED_FLOW' | 'TWO_SIDED_CHURN'
  | 'LIQUIDITY_DETERIORATING' | 'VOLUME_EXCEEDS_DEPTH' | 'PROVISIONAL_TRADES' | 'NOT_PERSISTENT' | 'FLAT_BASELINE';

export interface VolumeSpikeInput {
  /** Final bars per window, oldest first (for example from `TradeBarBuilder.finalBars`). */
  /** Distinct intervals; each window's bars must all be of that interval. */
  windows: ReadonlyArray<{ intervalMs: number; bars: readonly TradeBar[] }>;
  /** Assessment clock. Windows whose latest bar is stale are unusable. */
  nowMs: number;
  launchAgeMs: number | null;
  /** Pool or book liquidity in quote units, now versus a trailing baseline, when available. */
  liquidity?: { nowQuote: number; baselineQuote: number };
  /** Executable depth near the touch in quote units, when available. */
  depthQuote?: number;
}

export interface WindowAssessment {
  intervalMs: number;
  status: 'USABLE' | 'INSUFFICIENT' | 'UNUSABLE';
  baselineBars: number;
  latestQuote: number | null;
  baselineMedianQuote: number | null;
  robustZ: number | null;
  /** Quote volume per second in the latest bar. */
  velocity: number | null;
  /** Latest velocity minus the baseline median velocity. */
  acceleration: number | null;
  /** (buy − sell) / (buy + sell) quote volume in the latest bar. */
  imbalance: number | null;
  spike: boolean;
}

export interface VolumeSpikeAssessment {
  policyVersion: string;
  verdict: VolumeSpikeVerdict;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  flags: VolumeSpikeFlag[];
  persistentWindows: number;
  windows: WindowAssessment[];
  role: 'CANDIDATE_TRIGGER_ONLY';
  tradingAuthority: false;
}

const quote = (fp: bigint) => Number(fp) / 1e9;
function median(sorted: readonly number[]) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const usable = (bar: TradeBar) => bar.status === 'FINAL' && !bar.quality.invalidated && !bar.quality.feedGap;

function assessWindow(intervalMs: number, bars: readonly TradeBar[], nowMs: number, policy: VolumeSpikePolicy): WindowAssessment & { latest: TradeBar | null; flat: boolean } {
  const latest = bars.at(-1) ?? null;
  const none = { intervalMs, baselineBars: 0, latestQuote: null, baselineMedianQuote: null, robustZ: null, velocity: null,
    acceleration: null, imbalance: null, spike: false, latest, flat: false };
  if (!latest || !usable(latest) || !Number.isSafeInteger(intervalMs) || intervalMs <= 0 || latest.intervalMs !== intervalMs ||
      !Number.isFinite(nowMs) || latest.endMs > nowMs || nowMs - latest.endMs > intervalMs + policy.maxBarAgeMs) return { ...none, status: 'UNUSABLE' };
  // A gap, wrong interval, discontinuity or invalidated bar in the baseline makes earlier history untrustworthy;
  // use only the clean, contiguous suffix that ends at the latest bar.
  const history = bars.slice(Math.max(0, bars.length - 1 - policy.recommendedBaselineBars), -1);
  let cleanFrom = 0;
  history.forEach((bar, i) => {
    const next = history[i + 1] ?? latest;
    if (!usable(bar) || bar.intervalMs !== intervalMs || bar.endMs !== next.startMs) cleanFrom = i + 1;
  });
  const baseline = history.slice(cleanFrom).map((bar) => quote(bar.quoteVolumeFp));
  if (baseline.length < policy.minBaselineBars) return { ...none, baselineBars: baseline.length, status: 'INSUFFICIENT' };
  const sorted = [...baseline].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(sorted.map((x) => Math.abs(x - med)).sort((a, b) => a - b));
  const scale = Math.max(1.4826 * mad, policy.minScaleQuote);
  const latestQuote = quote(latest.quoteVolumeFp);
  const seconds = intervalMs / 1000;
  const robustZ = (latestQuote - med) / scale;
  const velocity = latestQuote / seconds;
  const acceleration = velocity - med / seconds;
  const sided = quote(latest.buyQuoteFp) + quote(latest.sellQuoteFp);
  const imbalance = sided > 0 ? (quote(latest.buyQuoteFp) - quote(latest.sellQuoteFp)) / sided : null;
  return {
    intervalMs, status: 'USABLE', baselineBars: baseline.length, latestQuote, baselineMedianQuote: med, robustZ, velocity,
    acceleration, imbalance, latest, flat: mad === 0,
    spike: robustZ >= policy.zThreshold && acceleration > 0 && latest.trades >= policy.minTradesInBar,
  };
}

/** Assesses whether recent volume acceleration is persistent and plausibly organic. Never authorizes a trade. */
export function assessVolumeSpike(input: VolumeSpikeInput, policy: VolumeSpikePolicy = VOLUME_SPIKE_POLICY_V1): VolumeSpikeAssessment {
  if (new Set(input.windows.map((w) => w.intervalMs)).size !== input.windows.length) throw new Error('DUPLICATE_VOLUME_WINDOW');
  const assessed = input.windows.map((w) => assessWindow(w.intervalMs, w.bars, input.nowMs, policy));
  // A launch timestamp after the assessment clock is future-dated evidence: it can never support a verdict.
  const launchFromFuture = input.launchAgeMs !== null && Number.isFinite(input.launchAgeMs) && input.launchAgeMs < 0;
  const windows: WindowAssessment[] = assessed.map(({ latest: _latest, flat: _flat, ...rest }) => rest);
  const base = { policyVersion: policy.version, windows, role: 'CANDIDATE_TRIGGER_ONLY' as const, tradingAuthority: false as const };
  const usableWindows = assessed.filter((w) => w.status === 'USABLE');
  // Persistence cannot be judged from fewer usable windows than it requires.
  if (launchFromFuture || usableWindows.length < Math.max(1, policy.minPersistentWindows)) {
    return { ...base, verdict: 'INSUFFICIENT_EVIDENCE', confidence: 'LOW', flags: [], persistentWindows: 0 };
  }
  const spiking = usableWindows.filter((w) => w.spike);
  const flags = new Set<VolumeSpikeFlag>();
  if (spiking.length === 0) return { ...base, verdict: 'NO_SPIKE', confidence: 'MEDIUM', flags: [], persistentWindows: 0 };

  // Authenticity is judged on the longest spiking window's latest bar, which aggregates the most participants.
  const evidence = spiking.reduce((a, b) => (b.intervalMs > a.intervalMs ? b : a)).latest!;
  const total = quote(evidence.quoteVolumeFp);
  if (!evidence.quality.participantsKnown) flags.add('PARTICIPANTS_UNKNOWN');
  if (evidence.quality.participantsTruncated) flags.add('PARTICIPANTS_TRUNCATED');
  if (evidence.quality.provisionalTrades > 0) flags.add('PROVISIONAL_TRADES');
  if (evidence.quality.participantsKnown && evidence.participants < policy.minParticipants) flags.add('FEW_PARTICIPANTS');
  if (total > 0 && quote(evidence.topParticipantQuoteFp) / total > policy.maxTopParticipantShare) flags.add('CONCENTRATED_FLOW');
  if (total > 0 && quote(evidence.twoSidedQuoteFp) / total > policy.maxTwoSidedShare) flags.add('TWO_SIDED_CHURN');
  const liq = input.liquidity;
  if (liq && Number.isFinite(liq.nowQuote) && Number.isFinite(liq.baselineQuote) && liq.baselineQuote > 0 &&
      (liq.baselineQuote - liq.nowQuote) / liq.baselineQuote * 100 > policy.maxLiquidityDropPct) flags.add('LIQUIDITY_DETERIORATING');
  if (input.depthQuote !== undefined && Number.isFinite(input.depthQuote) && input.depthQuote >= 0 &&
      quote(usableWindows.reduce((a, b) => (b.intervalMs < a.intervalMs ? b : a)).latest!.quoteVolumeFp) > policy.maxVolumeToDepth * input.depthQuote)
    flags.add('VOLUME_EXCEEDS_DEPTH');
  if (spiking.some((w) => w.flat)) flags.add('FLAT_BASELINE');

  // Windows "spike together" only when their latest bars overlap the most recent spiking bar; two fresh but disjoint
  // bursts are not persistence.
  const anchor = spiking.reduce((a, b) => (b.latest!.endMs > a.latest!.endMs ? b : a)).latest!;
  const together = spiking.filter((w) => w.latest!.startMs < anchor.endMs && w.latest!.endMs > anchor.startMs);
  const persistent = together.length >= policy.minPersistentWindows;
  if (!persistent) flags.add('NOT_PERSISTENT');
  // A flat (often all-empty) baseline makes any small burst look extreme, so it can never confirm authenticity.
  const disqualifying = [...flags].filter((f) => f !== 'NOT_PERSISTENT');
  const verdict: VolumeSpikeVerdict = !persistent ? 'NO_SPIKE' : disqualifying.length ? 'SUSPECT_SPIKE' : 'AUTHENTIC_SPIKE';
  const young = input.launchAgeMs !== null && (!Number.isFinite(input.launchAgeMs) || input.launchAgeMs < policy.youngLaunchMs);
  const shortHistory = spiking.some((w) => w.baselineBars < policy.recommendedBaselineBars);
  const confidence = young || shortHistory || flags.has('FLAT_BASELINE') ? 'LOW'
    : together.length === usableWindows.length && usableWindows.length === assessed.length ? 'HIGH' : 'MEDIUM';
  return { ...base, verdict, confidence, flags: [...flags].sort(), persistentWindows: together.length };
}
