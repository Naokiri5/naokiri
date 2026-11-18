import type { EvidencePacket, ChallengeFinding } from './schemas.js';
import type { WorkerContext } from '../workers/types.js';

export type HorizonTrend = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
/** Strategies that buy WITH the trend; buying against both higher horizons contradicts their own thesis. */
const TREND_FOLLOWING = new Set(['trend_pullback', 'donchian_breakout']);
const HORIZONS = ['15m', '1h', '4h'] as const;

/**
 * MIA-THINK-037: explicit 15m / 1h / 4h trend alignment. A horizon is UP when price and EMA20 are both above EMA50, DOWN
 * when both are below, FLAT otherwise, UNKNOWN when its features are missing (never guessed). For a trend-following long,
 * 1h AND 4h both DOWN is a critical contradiction (the challenge vetoes); any other disagreement is listed as opposing
 * evidence without blocking. Range-reversion buys dips by design and is never vetoed by this check.
 */
export function horizonAlignment(ctx: WorkerContext): { trends: Record<(typeof HORIZONS)[number], HorizonTrend>; findings: string[]; critical: boolean } {
  const trend = (iv: (typeof HORIZONS)[number]): HorizonTrend => {
    const f = ctx.f[iv];
    if (!f || ![f.close, f.ema20, f.ema50].every((x) => typeof x === 'number' && Number.isFinite(x))) return 'UNKNOWN';
    if (f.close > f.ema50 && f.ema20 > f.ema50) return 'UP';
    if (f.close < f.ema50 && f.ema20 < f.ema50) return 'DOWN';
    return 'FLAT';
  };
  const trends = Object.fromEntries(HORIZONS.map((iv) => [iv, trend(iv)])) as Record<(typeof HORIZONS)[number], HorizonTrend>;
  const findings: string[] = []; let critical = false;
  if (ctx.candidate.signal.direction !== 'long') return { trends, findings, critical };
  const down = HORIZONS.filter((iv) => trends[iv] === 'DOWN');
  if (down.length) {
    const trendFollowing = TREND_FOLLOWING.has(ctx.candidate.strategyId);
    if (trendFollowing && trends['1h'] === 'DOWN' && trends['4h'] === 'DOWN') {
      critical = true;
      findings.push(`horizon conflict: long ${ctx.candidate.strategyId} against a 1h AND 4h downtrend (15m ${trends['15m']}, 1h DOWN, 4h DOWN)`);
    } else {
      findings.push(`horizon conflict: ${down.join(' and ')} trend DOWN against a long (15m ${trends['15m']}, 1h ${trends['1h']}, 4h ${trends['4h']})${trendFollowing ? '' : '; strategy is not trend-following, listed only'}`);
    }
  }
  return { trends, findings, critical };
}

/** Part 29.3 L2 independent challenge panel. Reviewers may disagree or abstain; agreement is not rewarded. */
export function challengePanel(ctx: WorkerContext, packets: EvidencePacket[]): ChallengeFinding[] {
  const sup = packets.filter((p) => p.stance === 'SUPPORT'); const opp = packets.filter((p) => p.stance === 'OPPOSE');
  const top = (ps: EvidencePacket[]) => ps.slice(0, 6).map((p) => `${p.worker_id} (${p.evidence_domain}): ${p.reason_codes[0] ?? ''}`);
  const out: ChallengeFinding[] = [];
  out.push({ reviewer: 'BULL', stance: sup.length ? 'SUPPORT' : 'ABSTAIN', critical: false, findings: sup.length ? [`${sup.length} supporting packets`, ...top(sup)] : ['no supporting evidence'] });
  out.push({ reviewer: 'BEAR', stance: opp.length ? 'OPPOSE' : 'ABSTAIN', critical: false, findings: opp.length ? [`${opp.length} opposing packets`, ...top(opp)] : ['no material opposing evidence found'] });

  // Contrarian: crowding / false breakout / exhaustion
  const f1 = ctx.f['1h']; const c: string[] = []; let critical = false;
  if (f1) {
    if (f1.rsi14 > 75 && f1.relVol20 > 3) c.push(`exhaustion risk: RSI ${f1.rsi14.toFixed(0)} on ${f1.relVol20.toFixed(1)}× volume`);
    if (ctx.ticker && ctx.ticker.changePct > 20) { c.push(`crowded move: +${ctx.ticker.changePct.toFixed(1)}% in 24h`); }
    if (ctx.candidate.strategyId === 'donchian_breakout' && f1.takerBuyRatio < 0.48) c.push('breakout without taker-buy dominance (false-breakout risk)');
    if (f1.zscore20 > 3) { c.push(`price ${f1.zscore20.toFixed(1)}σ above mean`); critical = true; }
  }
  const h = horizonAlignment(ctx); // MIA-THINK-037: timeframe conflict is opposing evidence; critical for trend longs vs 1h+4h
  c.push(...h.findings); if (h.critical) critical = true;
  out.push({ reviewer: 'CONTRARIAN', stance: c.length ? 'OPPOSE' : 'ABSTAIN', critical, findings: c.length ? c : ['no crowding, exhaustion, or trap pattern detected'] });

  // Data auditor
  const d: string[] = []; let dCrit = false;
  if (ctx.quality.status === 'FAIL') { d.push(...ctx.quality.issues); dCrit = true; }
  if (ctx.quality.independentSources < 2) d.push('price confirmed by a single venue only');
  const srcs = new Set(packets.flatMap((p) => p.source_ids));
  const binanceShare = packets.filter((p) => p.source_ids.some((s) => s.startsWith('binance'))).length / Math.max(1, packets.length);
  d.push(`${srcs.size} distinct source ids; ${(binanceShare * 100).toFixed(0)}% of packets depend on Binance data (correlated inputs — capped per dependency group)`);
  const stale = packets.filter((p) => (p.source_freshness_ms ?? 0) > 60_000).length;
  if (stale) { d.push(`${stale} packets built on data older than 60s`); dCrit = true; }
  out.push({ reviewer: 'DATA_AUDITOR', stance: dCrit ? 'OPPOSE' : 'SUPPORT', critical: dCrit, findings: d });

  // Execution reviewer
  const e: string[] = []; let eCrit = false; const s = ctx.candidate.signal;
  if (!ctx.impact) { e.push('no order book — cannot estimate execution cost'); eCrit = true; }
  else {
    const rt = 2 * ctx.feeRate + (ctx.impact.spreadBps + 2 * ctx.impact.impactBps) / 1e4;
    const cr = (rt * s.entryRef) / (s.entryRef - s.stop);
    e.push(`round trip ≈ ${(rt * 1e4).toFixed(1)} bps = ${cr.toFixed(3)}R (fees ${(ctx.feeRate * 2e4).toFixed(0)} bps, spread ${ctx.impact.spreadBps.toFixed(1)} bps, impact ${ctx.impact.impactBps.toFixed(1)} bps×2)`);
    if (!ctx.impact.filledFully || cr > 0.3) { e.push('execution cost too high relative to risk'); eCrit = true; }
  }
  out.push({ reviewer: 'EXECUTION', stance: eCrit ? 'OPPOSE' : 'SUPPORT', critical: eCrit, findings: e });
  return out;
}
