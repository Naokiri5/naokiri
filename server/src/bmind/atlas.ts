/**
 * MIA 5.0 B-MIND (M5-U03a): the 32-construct emotion atlas and what MIA can actually observe today.
 *
 * Each construct lists the inputs it needs. A construct whose required input is unavailable is UNKNOWN, not neutral.
 * The `role` and `caveat` texts come from the B-MIND 3.0 source atlas (EM-01…EM-32), shortened.
 * Pure data and pure functions: no I/O, no clock, no state.
 */
import {
  BEHAVIORAL_INPUTS, PRICE_DERIVED_INPUTS,
  type BehavioralInput, type ConstructDefinition, type ConstructFamily, type InputCapabilities, type InputCapability,
} from './contracts.js';

type Def = Omit<ConstructDefinition, 'id' | 'family' | 'plane'> & { plane?: ConstructDefinition['plane'] };
const familyOf = (n: number): ConstructFamily => (n <= 24 ? 'MARKET_EMOTION' : n <= 30 ? 'COLLECTIVE_BIAS' : 'DISCIPLINE');

const DEFS: Def[] = [
  { name: 'Fear', required: ['PRICE_VOLUME', 'TRADE_FLOW'], optional: ['NEWS'], domains: ['flow', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Check downside and liquidity at entry; trend strategies may follow, reversal strategies must wait for their own rules.', caveat: 'A falling market may continue falling.' },
  { name: 'Panic', required: ['PRICE_VOLUME', 'ORDER_BOOK'], optional: ['TRADE_FLOW'], domains: ['liquidity', 'risk'], effectCeiling: 'WAIT',
    role: 'Raise liquidity stress; restrict discretionary new entries under tested policies; protect exits.', caveat: 'Extreme price action alone cannot prove panic.' },
  { name: 'Anxiety', required: ['PRICE_VOLUME', 'ORDER_BOOK', 'NEWS'], optional: ['MACRO_EVENTS'], domains: ['liquidity', 'news'], effectCeiling: 'EXPLAIN',
    role: 'Flag an unstable environment, shorten evidence validity and demand fresher quotes.', caveat: 'Macro uncertainty cannot be inferred from one headline.' },
  { name: 'Dread', required: ['NEWS', 'OPTIONS_IV'], optional: ['PRICE_VOLUME'], domains: ['news', 'regime'], effectCeiling: 'EXPLAIN',
    role: 'Label sustained high risk rather than a single sell event; monitor hold-time effects.', caveat: 'Often indistinguishable from fear without licensed options data.' },
  { name: 'Capitulation', required: ['PRICE_VOLUME', 'TRADE_FLOW'], optional: [], domains: ['flow', 'regime'], effectCeiling: 'EXPLAIN',
    role: 'Mark possible exhaustion for a separate validated reversal system; never buy automatically.', caveat: 'Capitulation can repeat.' },
  { name: 'Despair', required: ['PRICE_VOLUME', 'NEWS'], optional: [], domains: ['regime', 'news'], effectCeiling: 'EXPLAIN',
    role: 'Track regime persistence; discourage premature bottom-catching.', caveat: 'No direct access to individual psychological states.' },
  { name: 'Regret', required: ['PRICE_VOLUME', 'SOCIAL'], optional: [], domains: ['regime'], effectCeiling: 'EXPLAIN',
    role: 'Research reversal FOMO; no automatic buy signal.', caveat: 'Do not infer regret from a green candle.' },
  { name: 'Relief', required: ['PRICE_VOLUME', 'ORDER_BOOK'], optional: [], domains: ['liquidity', 'regime'], effectCeiling: 'EXPLAIN',
    role: 'Determine whether risk conditions are improving; feed a recovery-state classifier.', caveat: 'A relief rally may reverse.' },
  { name: 'Hope', required: ['NEWS', 'TRADE_FLOW'], optional: ['SOCIAL'], domains: ['news', 'flow'], effectCeiling: 'EXPLAIN',
    role: 'Classify narrative lead versus confirmation; keep provisional status.', caveat: 'A positive story is not executable demand.' },
  { name: 'Optimism', required: ['PRICE_VOLUME', 'TRADE_FLOW', 'NEWS'], optional: ['SOCIAL'], domains: ['flow', 'news'], effectCeiling: 'EXPLAIN',
    role: 'Possible trend-quality evidence for eligible strategies only.', caveat: 'Positive sentiment can lag price.' },
  { name: 'Greed', required: ['PRICE_VOLUME', 'TRADE_FLOW'], optional: ['NEWS', 'SOCIAL'], domains: ['flow', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Alert on crowded execution, fee pressure and concentration; evaluate trend sustainability.', caveat: 'Greed can support momentum for longer than expected.' },
  { name: 'Euphoria', required: ['PRICE_VOLUME', 'SOCIAL'], optional: ['SEARCH_INTEREST'], domains: ['risk'], effectCeiling: 'EXPLAIN',
    role: 'Trigger late-entry quality checks; avoid automatic contrarian shorting.', caveat: 'Sentiment magnitude is not a sell signal.' },
  { name: 'FOMO', required: ['PRICE_VOLUME', 'SOCIAL'], optional: [], domains: ['risk'], effectCeiling: 'WAIT',
    role: 'Late-entry WAIT research overlay, or a smaller entry only if risk policy already allows it.', caveat: 'New strong trends can be valid.' },
  { name: 'Overconfidence', required: ['NEWS'], optional: ['SOCIAL'], domains: ['news', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Challenge consensus, penalize source dependence, require a dissent audit.', caveat: "Cannot read participants' minds." },
  { name: 'Complacency', required: ['ORDER_BOOK', 'NEWS'], optional: ['SOCIAL'], domains: ['liquidity'], effectCeiling: 'EXPLAIN',
    role: 'Detect divergence between a calm narrative and order-book stress.', caveat: 'Low volatility can remain stable.' },
  { name: 'Conviction', required: ['TRADE_FLOW', 'WALLET_HOLDERS'], optional: [], domains: ['flow', 'onchain'], effectCeiling: 'EXPLAIN',
    role: 'Research persistence and absorption; do not equate with guaranteed informed trading.', caveat: 'Large prints are not identified wallets.' },
  { name: 'Skepticism', required: ['PRICE_VOLUME', 'NEWS'], optional: ['SOCIAL'], domains: ['news'], effectCeiling: 'EXPLAIN',
    role: 'Request stronger source independence and track divergence.', caveat: 'Healthy skepticism may precede new demand.' },
  { name: 'Distrust', required: ['SOURCE_HEALTH', 'NEWS'], optional: [], domains: ['news', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Quarantine questionable news evidence; flag poisoning concerns.', caveat: 'Do not accuse named individuals without evidence.' },
  { name: 'Disbelief', required: ['PRICE_VOLUME', 'NEWS'], optional: ['SOCIAL'], domains: ['news', 'regime'], effectCeiling: 'EXPLAIN',
    role: 'Research wall-of-worry phenomena as a regime-specific observation.', caveat: 'Ambiguous and easy to overfit.' },
  { name: 'Confusion', required: ['NEWS', 'PRICE_VOLUME', 'SOURCE_HEALTH'], optional: [], domains: ['news', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Mark uncertain; abstain on subjective sentiment factors.', caveat: 'News disagreement may be editorial, not market confusion.' },
  { name: 'Uncertainty', required: ['SOURCE_HEALTH', 'MIA_ACTIVITY'], optional: [], domains: ['risk'], effectCeiling: 'EXPLAIN',
    role: 'Reduce reliance on behavioral features; demand explicit uncertainty flags.', caveat: 'Uncertainty is an evidence state, not simply fear.' },
  { name: 'Surprise', required: ['PRICE_VOLUME', 'ORDER_BOOK', 'NEWS'], optional: ['TRADE_FLOW'], domains: ['news', 'risk'], effectCeiling: 'WAIT',
    role: 'Suspend stale model extrapolation; open an event-risk investigation.', caveat: 'Requires timestamped event confirmation.' },
  { name: 'Curiosity', required: ['SEARCH_INTEREST', 'ORDER_BOOK'], optional: ['SOCIAL'], domains: ['news'], effectCeiling: 'EXPLAIN',
    role: 'Track discovery without promoting it to demand.', caveat: 'Marketing can manufacture attention.' },
  { name: 'Anticipation', required: ['MACRO_EVENTS'], optional: ['OPTIONS_IV'], domains: ['news', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Attach scheduled event-risk metadata; avoid guessing the announcement result.', caveat: 'Macro calendars differ from genuine option pricing.' },
  { name: 'Herding', required: ['SOCIAL'], optional: ['NEWS', 'WALLET_HOLDERS'], domains: ['news', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Origin dedup, source clustering, correlation cap and whale/retail separation.', caveat: 'Copied accounts are not independent participants.' },
  { name: 'Contagion', required: ['CROSS_ASSET', 'PRICE_VOLUME'], optional: ['SOCIAL'], domains: ['risk', 'regime'], effectCeiling: 'EXPLAIN',
    role: 'Cross-asset correlation stress and concentration alert.', caveat: 'Co-movement need not be psychological causation.' },
  { name: 'Scarcity/Urgency', required: ['SOCIAL', 'TRADE_FLOW'], optional: ['SUPPLY', 'WALLET_HOLDERS'], domains: ['onchain', 'risk'], effectCeiling: 'EXPLAIN',
    role: 'Flag artificial urgency and late-entry risk; verify circulating supply.', caveat: 'On-chain supply metrics may be spoofed or inaccessible.' },
  { name: 'Anchoring', required: ['PRICE_VOLUME'], optional: ['SOCIAL', 'NEWS'], domains: ['regime'], effectCeiling: 'EXPLAIN',
    role: 'Research support/resistance narrative divergence and break acceptance.', caveat: 'Round-number reactions have many non-emotional causes.' },
  { name: 'Loss Aversion', required: ['TRADE_FLOW', 'COST_BASIS'], optional: [], domains: ['flow'], effectCeiling: 'EXPLAIN',
    role: 'Test only where positions or cost basis can be inferred legitimately.', caveat: 'Not observable from anonymous order books alone.' },
  { name: 'Confirmation Bias', plane: 'MACHINE', required: ['MIA_ACTIVITY'], optional: ['NEWS'], domains: ['risk'], effectCeiling: 'EXPLAIN',
    role: 'Force a bear case, contradictory evidence and an origin-independence audit of MIA\'s own evidence.', caveat: 'A system bias more than an emotion.' },
  { name: 'Impatience', plane: 'MACHINE', required: ['MIA_ACTIVITY'], optional: [], domains: ['risk'], effectCeiling: 'WAIT',
    role: 'Discipline hold when MIA re-proposes a rejected entry or chases an expired signal; require a fresh candidate and cool-off.', caveat: 'MIA has no human frustration; this is behavior control.' },
  { name: 'Revenge/Frustration', plane: 'MACHINE', required: ['MIA_ACTIVITY'], optional: [], domains: ['risk'], effectCeiling: 'WAIT',
    role: 'Spot rapid re-entry or position growth after losses; the existing loss-streak limits and duplicate-order checks enforce it.', caveat: "Do not infer the owner's emotions; measure order patterns only." },
];

/** The 32 constructs, in source order (EM-01…EM-32). Frozen: callers cannot change the atlas. */
export const EMOTION_ATLAS: readonly ConstructDefinition[] = Object.freeze(DEFS.map((d, i) => Object.freeze({
  ...d, id: `EM-${String(i + 1).padStart(2, '0')}` as const, family: familyOf(i + 1), plane: d.plane ?? 'MARKET',
})));
const BY_ID = new Map(EMOTION_ATLAS.map((c) => [c.id as string, c]));
export const constructById = (id: string): ConstructDefinition | null => BY_ID.get(id) ?? null;

/**
 * What MIA can read today (2026-11, unified branch), with the evidence for each. A static, reviewed baseline: when a
 * source is added, change it here in the same PR, with a test.
 */
export const MIA_INPUT_BASELINE: Readonly<Record<BehavioralInput, { capability: InputCapability; evidence: string }>> = Object.freeze({
  PRICE_VOLUME: { capability: 'AVAILABLE', evidence: 'CEX candles and indicators (WorkerContext.f, features/indicators.ts)' },
  ORDER_BOOK: { capability: 'AVAILABLE', evidence: 'Spread, depth and imbalance (WorkerContext.impact); Binance depth stream. Crypto CEX only' },
  TRADE_FLOW: { capability: 'DEGRADED', evidence: 'Aggregated large CEX prints only (whales/prints.ts); no full taker tape, no wallets' },
  NEWS: { capability: 'DEGRADED', evidence: 'Headline counts and sentiment from RSS (news/news.ts); credibility not verified' },
  MACRO_EVENTS: { capability: 'DEGRADED', evidence: 'High-impact macro headline count (WorkerContext.news.highImpactMacro); no scheduled event calendar' },
  CROSS_ASSET: { capability: 'AVAILABLE', evidence: 'BTC 1h/4h context and correlation (WorkerContext.btc1h/btc4h/corrToBtc, portfolio/correlation.ts)' },
  SOURCE_HEALTH: { capability: 'AVAILABLE', evidence: 'Data quality and provider status (market/quality.ts, provider registry)' },
  MIA_ACTIVITY: { capability: 'AVAILABLE', evidence: "MIA's own decisions, approvals, orders, positions and worker votes (database)" },
  SOCIAL: { capability: 'UNAVAILABLE', evidence: 'X API is PENDING_CREDENTIALS (providers/pending.ts); no licensed social feed' },
  SEARCH_INTEREST: { capability: 'UNAVAILABLE', evidence: 'No search-trend source' },
  OPTIONS_IV: { capability: 'UNAVAILABLE', evidence: 'No licensed options or implied-volatility data' },
  WALLET_HOLDERS: { capability: 'UNAVAILABLE', evidence: 'No holder distribution or wallet clustering (EVM RPC pending; Solana holders not built)' },
  DEX_ACTIVITY: { capability: 'DEGRADED', evidence: 'DEX Screener buy/sell counts; these are not unique wallets' },
  SUPPLY: { capability: 'UNAVAILABLE', evidence: 'Circulating supply is not read into evidence' },
  COST_BASIS: { capability: 'UNAVAILABLE', evidence: 'Participant cost basis is not observable' },
});
export const baselineCapabilities = (): InputCapabilities =>
  Object.fromEntries(BEHAVIORAL_INPUTS.map((k) => [k, MIA_INPUT_BASELINE[k].capability]));

export type CoverageState = 'OBSERVABLE' | 'WEAK' | 'UNKNOWN';
export interface ConstructCoverage {
  id: ConstructDefinition['id']; name: string; state: CoverageState;
  /** Required inputs that are unavailable (or not listed in the capability map, which counts as unavailable). */
  missing: BehavioralInput[];
  /** Required inputs that are only partial or unverified. */
  degraded: BehavioralInput[];
  /** True when every required input is price-derived: such a construct is at most WEAK. */
  priceOnly: boolean;
}

/** Whether each construct can be observed with the given inputs. Fails closed: an input not listed is unavailable. */
export function constructCoverage(caps: InputCapabilities = baselineCapabilities()): ConstructCoverage[] {
  return EMOTION_ATLAS.map((c) => {
    const cap = (i: BehavioralInput): InputCapability => caps[i] ?? 'UNAVAILABLE';
    const missing = c.required.filter((i) => cap(i) === 'UNAVAILABLE');
    const degraded = c.required.filter((i) => cap(i) === 'DEGRADED');
    const priceOnly = c.required.every((i) => PRICE_DERIVED_INPUTS.includes(i));
    const state: CoverageState = missing.length ? 'UNKNOWN' : degraded.length || priceOnly ? 'WEAK' : 'OBSERVABLE';
    return { id: c.id, name: c.name, state, missing, degraded, priceOnly };
  });
}
