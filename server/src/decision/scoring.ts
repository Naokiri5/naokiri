import type { ConsensusRecord } from '../qci/schemas.js';
import { clamp } from '../core/util.js';

/** Part 16.4 transparent, versioned opportunity score. NOT a probability of profit. */
export const SCORE_VERSION = 'opp-score-v1 (research default weights, NOT calibrated)';
export const SCORE_WEIGHTS = { trend: 0.15, momentum: 0.1, volume: 0.1, liquidity: 0.15, structure: 0.1, volatility: 0.1, news: 0.1, expectancy: 0.15, portfolio: 0.05 };
const MISSING_VALUE = 35; // missing inputs are penalized, never assumed favorable

export interface ScoreFactor { factor: keyof typeof SCORE_WEIGHTS; value: number; weight: number; missing: boolean; basis: string }
export interface OpportunityScore { score: number; version: string; factors: ScoreFactor[]; missing: string[] }

export function scoreOpportunity(c: ConsensusRecord, strat: { trades: number; expectancyR: number } | null, correlatedOpen: number): OpportunityScore {
  const dom = (d: string) => c.domains.find((x) => x.domain === d)?.score ?? null;
  const fromDomain = (d: string | null) => (d == null ? null : 50 + 50 * Number(d));
  const avg = (...xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const raw: Record<keyof typeof SCORE_WEIGHTS, [number | null, string]> = {
    trend: [fromDomain(dom('trend') as any), 'QCI trend domain (dependency-capped)'],
    momentum: [fromDomain(dom('momentum') as any), 'QCI momentum domain'],
    volume: [fromDomain(dom('flow') as any), 'QCI flow/volume domain'],
    liquidity: [avg(fromDomain(dom('liquidity') as any), fromDomain(dom('execution') as any)), 'QCI liquidity + execution domains'],
    structure: [fromDomain(dom('structure') as any), 'QCI structure domain'],
    volatility: [fromDomain(dom('volatility') as any), 'QCI volatility domain'],
    news: [fromDomain(dom('news') as any), 'QCI news domain (lexicon classifier)'],
    expectancy: [strat && strat.trades >= 20 ? clamp(50 + 100 * strat.expectancyR, 0, 100) : null, strat ? `out-of-sample expectancy ${strat.expectancyR.toFixed(3)}R over ${strat.trades} trades` : 'no out-of-sample backtest'],
    portfolio: [clamp(100 - 35 * correlatedOpen, 0, 100), `${correlatedOpen} correlated open positions`],
  };
  const factors: ScoreFactor[] = (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => {
    const [v, basis] = raw[k]; const missing = v == null || !Number.isFinite(v);
    return { factor: k, value: Math.round((missing ? MISSING_VALUE : v!) * 10) / 10, weight: SCORE_WEIGHTS[k], missing, basis };
  });
  let score = factors.reduce((s, f) => s + f.value * f.weight, 0);
  // data-quality / dissent penalties (Part 16.4 "penalize stale, incomplete, contradictory")
  score -= 15 * c.weighted_opposition;
  return { score: Math.round(clamp(score, 0, 100) * 10) / 10, version: SCORE_VERSION, factors, missing: factors.filter((f) => f.missing).map((f) => f.factor) };
}
