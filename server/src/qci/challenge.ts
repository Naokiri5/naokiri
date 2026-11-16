import type { EvidencePacket, ChallengeFinding } from './schemas.js';
import type { WorkerContext } from '../workers/types.js';

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
