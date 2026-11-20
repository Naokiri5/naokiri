/**
 * THINK Profit Laboratory (MIA-THINK-041..045, 050): transparent, HYPOTHETICAL outcome arithmetic for a spot-long plan.
 *
 * Pure functions, no I/O, no authority. They never size a position (the risk gate does that) and never produce a
 * probability: win probabilities must come from a calibrated, out-of-sample cohort (ditas/calibration.ts). Without one,
 * expectancy is reported as NO_VALID_FORECAST rather than guessed. Results are in R (multiples of the planned risk per
 * unit) and, when the risk gate produced a quantity, in USD.
 *
 *   grossPnL = qty * (exit - entry)
 *   netPnL   = grossPnL - fees(entry) - fees(exit) - spread/slippage costs   (costs not double-counted in prices)
 *   E[R]     = P(win) * avgWinR - (1 - P(win)) * avgLossR - costR
 */

export interface PlanInput {
  entry: number; stop: number;
  targets: { price: number; fraction: number }[];
  /** Quantity from the risk gate, if it sized the trade; otherwise results are per unit of quantity and in R only. */
  qty: number | null;
  feeRate: number;          // per side, e.g. 0.001 = 10 bps
  spreadBps: number | null; // full quoted spread
  /** Price impact for the intended size, measured from the MID price (so it already includes half the spread). */
  slippageBps: number | null;
  /** Conservative stop fill assumed by the risk gate (stop minus its fill buffer). Defaults to the stop price. */
  stopFill?: number | null;
}
export type ScenarioId = 'TARGETS_FILLED' | 'STOP_FILLED' | 'STOP_GAP_2X' | 'LIQUIDITY_PULL' | 'FLAT_EXIT';
export interface Scenario {
  id: ScenarioId; description: string; exitPrice: number;
  grossPerUnit: number; costsPerUnit: number; netPerUnit: number; netR: number; netUsd: number | null;
}
export interface ScenarioReport {
  kind: 'HYPOTHETICAL'; valid: boolean; invalidReason: string | null;
  riskPerUnit: number; costAssumptions: { feeRatePerSide: number; spreadBps: number; slippageBps: number; note: string };
  scenarios: Scenario[]; breakEvenExit: number | null; maxPlannedLossUsd: number | null; worstStressUsd: number | null;
  caveats: string[];
}

const fin = (x: number | null | undefined, d: number) => (x != null && Number.isFinite(x) && x >= 0 ? x : d);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Hypothetical outcome table for one plan. Missing cost inputs fall back to CONSERVATIVE defaults, flagged in caveats. */
export function scenarioTable(p: PlanInput): ScenarioReport {
  const caveats: string[] = [
    'Hypothetical arithmetic for listed exit prices, not a forecast of which one happens.',
    'A stop is a trigger, not a guaranteed fill: gaps, halts or a frozen token can lose more than planned.',
  ];
  const invalid = (why: string): ScenarioReport => ({ kind: 'HYPOTHETICAL', valid: false, invalidReason: why, riskPerUnit: 0,
    costAssumptions: { feeRatePerSide: p.feeRate, spreadBps: 0, slippageBps: 0, note: '' }, scenarios: [], breakEvenExit: null, maxPlannedLossUsd: null, worstStressUsd: null, caveats });
  if (![p.entry, p.stop].every((x) => Number.isFinite(x) && x > 0)) return invalid('entry and stop must be positive prices');
  if (p.stop >= p.entry) return invalid('stop must be below entry for a spot long');
  if (!Number.isFinite(p.feeRate) || p.feeRate < 0 || p.feeRate > 0.01) return invalid('feeRate must be within 0..1%');
  const spreadBps = fin(p.spreadBps, 20); const slippageBps = fin(p.slippageBps, 20);
  if (p.spreadBps == null || p.slippageBps == null) caveats.push('Spread or slippage was unknown; a conservative 20 bps default was used.');
  const qty = p.qty != null && Number.isFinite(p.qty) && p.qty > 0 ? p.qty : null;
  if (qty === null) caveats.push('No risk-gate quantity: USD figures omitted; results are per unit and in R.');

  const riskPerUnit = p.entry - p.stop;
  // Execution friction per side, as a price amount. `entry` is a mid/reference price and impact is measured from the mid,
  // so impact already contains half the spread: charge max(half spread, impact) per fill, never both (no double count).
  // Stress scenarios multiply that friction.
  const perSideBps = Math.max(spreadBps / 2, slippageBps);
  const friction = (price: number, mult = 1) => price * ((perSideBps * mult) / 1e4);
  const fee = (price: number) => price * p.feeRate;
  const rawNet = new Map<ScenarioId, number>(); // unrounded net per unit, for ranking (CodeRabbit #45)
  const make = (id: ScenarioId, description: string, exitPrice: number, slipMult = 1): Scenario => {
    const grossPerUnit = exitPrice - p.entry;
    const costsPerUnit = fee(p.entry) + fee(exitPrice) + friction(p.entry) + friction(exitPrice, slipMult);
    const netPerUnit = grossPerUnit - costsPerUnit;
    rawNet.set(id, netPerUnit);
    return { id, description, exitPrice: r4(exitPrice), grossPerUnit: r4(grossPerUnit), costsPerUnit: r4(costsPerUnit), netPerUnit: r4(netPerUnit),
      netR: r4(netPerUnit / riskPerUnit), netUsd: qty === null ? null : r2(netPerUnit * qty) };
  };

  const valid = p.targets.filter((t) => Number.isFinite(t.price) && t.price > p.entry && t.fraction > 0);
  const totalFraction = valid.reduce((s, t) => s + t.fraction, 0);
  const scenarios: Scenario[] = [];
  if (valid.length && totalFraction > 0) {
    const exit = valid.reduce((s, t) => s + t.price * (t.fraction / totalFraction), 0); // fraction-weighted average exit
    scenarios.push(make('TARGETS_FILLED', `all ${valid.length} target(s) filled (fraction-weighted exit)`, exit));
  } else caveats.push('No valid profit target above entry: upside scenario omitted.');
  scenarios.push(make('FLAT_EXIT', 'exit at the entry price (costs only)', p.entry));
  const stopFill = p.stopFill != null && Number.isFinite(p.stopFill) && p.stopFill > 0 && p.stopFill <= p.stop ? p.stopFill : p.stop;
  scenarios.push(make('STOP_FILLED', stopFill < p.stop ? 'stop triggered, filled at the risk gate\'s conservative stop fill' : 'stop filled at the stop price', stopFill));
  scenarios.push(make('STOP_GAP_2X', 'price gaps through the stop to twice the planned stop distance', Math.max(p.entry - 2 * riskPerUnit, p.entry * 0.01), 2));
  scenarios.push(make('LIQUIDITY_PULL', 'stop distance x3 with triple slippage (book pulled, exit forced)', Math.max(p.entry - 3 * riskPerUnit, p.entry * 0.01), 3));

  // Break-even exit: net = 0  ->  x*(1 - feeRate - f) = entry*(1 + feeRate + f), f = per-side friction fraction.
  const f = perSideBps / 1e4;
  const breakEvenExit = (p.entry * (1 + p.feeRate + f)) / (1 - p.feeRate - f);
  const stop = scenarios.find((s) => s.id === 'STOP_FILLED')!; const worst = scenarios.reduce((a, b) => (rawNet.get(b.id)! < rawNet.get(a.id)! ? b : a));
  return { kind: 'HYPOTHETICAL', valid: true, invalidReason: null, riskPerUnit: r4(riskPerUnit),
    costAssumptions: { feeRatePerSide: p.feeRate, spreadBps, slippageBps, note: 'Fees on both sides; per fill the larger of half the spread or the measured impact (impact is measured from the mid, so it already includes half the spread); stress scenarios multiply that friction.' },
    scenarios, breakEvenExit: r4(breakEvenExit),
    maxPlannedLossUsd: stop.netUsd === null ? null : r2(-stop.netUsd), worstStressUsd: worst.netUsd === null ? null : r2(-worst.netUsd), caveats };
}

export interface ProbabilityEstimate { point: number; lower: number; upper: number; source: string; sample: number }
export interface ExpectancyReport {
  status: 'NO_VALID_FORECAST' | 'ESTIMATED';
  reason: string; expectedR: number | null; expectedRLower: number | null; expectedRUpper: number | null;
  verdict: 'NO_VALID_FORECAST' | 'NEGATIVE' | 'UNCERTAIN_EDGE' | 'POSITIVE_LOWER_BOUND';
}

/**
 * Expected value in R. A probability is accepted only with an interval, a named calibration source and a sample size;
 * a heuristic score must never be passed here. A lower bound at or below zero is UNCERTAIN_EDGE (MIA-THINK-050).
 */
export function expectancy(pWin: ProbabilityEstimate | null, avgWinR: number, avgLossR: number, costR: number, minSample = 100): ExpectancyReport {
  const none = (reason: string): ExpectancyReport => ({ status: 'NO_VALID_FORECAST', reason, expectedR: null, expectedRLower: null, expectedRUpper: null, verdict: 'NO_VALID_FORECAST' });
  if (!pWin) return none('no calibrated win probability for this strategy and regime (scores are not probabilities)');
  const ok = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
  if (!ok(pWin.point) || !ok(pWin.lower) || !ok(pWin.upper) || pWin.lower > pWin.point || pWin.point > pWin.upper) return none('probability estimate is malformed');
  if (!pWin.source) return none('probability has no named calibration source');
  if (!(Number.isFinite(pWin.sample) && pWin.sample >= minSample)) return none(`calibration sample ${pWin.sample} is below the ${minSample} minimum`);
  if (![avgWinR, avgLossR, costR].every((x) => Number.isFinite(x) && x >= 0)) return none('average win/loss/cost must be non-negative R values');
  const e = (p: number) => p * avgWinR - (1 - p) * avgLossR - costR;
  const lo = e(pWin.lower), mid = e(pWin.point), hi = e(pWin.upper);
  return { status: 'ESTIMATED', reason: `from ${pWin.source} (n=${pWin.sample})`, expectedR: r4(mid), expectedRLower: r4(lo), expectedRUpper: r4(hi),
    verdict: hi <= 0 ? 'NEGATIVE' : lo <= 0 ? 'UNCERTAIN_EDGE' : 'POSITIVE_LOWER_BOUND' };
}
