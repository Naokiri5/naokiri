/**
 * MIA Quantitative Trading Intelligence Academy — taxonomy, seed catalog and curated concept cards.
 *
 * Curated concept cards contain standard textbook definitions written for MIA. They carry NO source citation until a
 * real document is ingested and its passages are linked (kb_concept_sources); the UI shows "no supporting source yet".
 * Evidence classes keep definitions, empirical findings, author interpretations, heuristics, MIA's own experiments and
 * unverified hypotheses apart (Part 8).
 */
export type EvidenceClass = 'MATHEMATICAL_DEFINITION' | 'EMPIRICAL_FINDING' | 'AUTHOR_INTERPRETATION' | 'TRADING_HEURISTIC' | 'MIA_EXPERIMENT' | 'UNVERIFIED_HYPOTHESIS';
export const EVIDENCE_CLASSES: EvidenceClass[] = ['MATHEMATICAL_DEFINITION', 'EMPIRICAL_FINDING', 'AUTHOR_INTERPRETATION', 'TRADING_HEURISTIC', 'MIA_EXPERIMENT', 'UNVERIFIED_HYPOTHESIS'];

export interface Discipline {
  id: string; name: string; categories: string[]; miaComponents: string[]; exercises: string[]; hypotheses: string[]; evaluation: string[];
}
/** The twelve disciplines, in the order given in the owner's directive (Part 3). */
export const DISCIPLINES: Discipline[] = [
  { id: 'fundamentals', name: 'Financial market fundamentals', categories: ['Asset classes', 'Exchanges and venues', 'Order types', 'Market participants'],
    miaComponents: ['market/fabric.ts (venues, instruments)', 'safety/safety.ts'], exercises: ['Map every instrument MIA scans to its venue, quote currency and trading rules'],
    hypotheses: ['Venue rules (tick/lot size, min notional) are respected by every paper order'], evaluation: ['Zero paper orders violating venue rules'] },
  { id: 'technical', name: 'Technical analysis and price action', categories: ['Trend', 'Momentum', 'Volume', 'Support and resistance', 'Chart patterns'],
    miaComponents: ['features/indicators.ts', 'workers/indicators.ts (50 specialists)', 'chart/analysis.ts', 'lab/strategies.ts'],
    exercises: ['Backtest a documented trend rule out-of-sample with costs'], hypotheses: ['A trend filter improves out-of-sample expectancy versus no filter'],
    evaluation: ['Out-of-sample expectancy after costs', 'Stability across regimes'] },
  { id: 'probability', name: 'Mathematics and probability', categories: ['Probability distributions', 'Expectation and variance', 'Bayesian updating', 'Stochastic processes'],
    miaComponents: ['lab/backtest.ts (Monte Carlo)', 'ditas/calibration.ts'], exercises: ['Estimate the distribution of trade outcomes in R and its uncertainty'],
    hypotheses: ['Trade R-multiples are not normally distributed (fat tails)'], evaluation: ['Bootstrap confidence intervals', 'Tail statistics'] },
  { id: 'statistics', name: 'Statistics and econometrics', categories: ['Hypothesis testing', 'Time-series models', 'Autocorrelation', 'Stationarity', 'Multiple testing'],
    miaComponents: ['knowledge/research.ts (statistical tests)'], exercises: ['Test for volatility clustering with Ljung–Box on squared returns'],
    hypotheses: ['Absolute returns are autocorrelated at short lags'], evaluation: ['p-values with stated assumptions', 'Shuffled-null comparison'] },
  { id: 'macro', name: 'Fundamental and macroeconomic analysis', categories: ['Valuation', 'Macro indicators', 'Monetary policy', 'Event risk'],
    miaComponents: ['news/news.ts (macro classifier)', 'workers (news domain)'], exercises: ['Measure realized volatility around high-impact macro headlines'],
    hypotheses: ['Realized volatility rises in the hours after high-impact macro news'], evaluation: ['Event-study with matched control windows'] },
  { id: 'microstructure', name: 'Market microstructure', categories: ['Bid–ask spread', 'Order book depth', 'Market impact', 'Adverse selection', 'Price discovery'],
    miaComponents: ['market/quality.ts (book walk)', 'exec/oms.ts (paper fills)', 'workers (liquidity/execution domains)'],
    exercises: ['Compare paper fill prices with the book-walk estimate'], hypotheses: ['Slippage grows with order size relative to visible depth'], evaluation: ['Estimated vs realized slippage error'] },
  { id: 'portfolio_risk', name: 'Portfolio management and risk', categories: ['Position sizing', 'Diversification', 'Drawdown', 'Value at Risk', 'Correlation'],
    miaComponents: ['risk/gate.ts', 'risk/policy.ts', 'portfolio/correlation.ts', 'lab/backtest.ts (Monte Carlo)'],
    exercises: ['Simulate drawdown distribution at the policy risk-per-trade'], hypotheses: ['Correlated positions raise drawdown beyond the single-trade budget'], evaluation: ['Max drawdown, CVaR, Calmar'] },
  { id: 'algorithmic', name: 'Algorithmic trading', categories: ['Strategy design', 'Backtesting', 'Walk-forward validation', 'Execution algorithms'],
    miaComponents: ['lab/', 'knowledge/research.ts (walk-forward)', 'bot/bot.ts'], exercises: ['Run purged walk-forward validation on each built-in strategy'],
    hypotheses: ['A strategy profitable in-sample remains profitable out-of-sample'], evaluation: ['Walk-forward OOS metrics', 'Degradation IS→OOS'] },
  { id: 'ml', name: 'Machine learning and artificial intelligence', categories: ['Feature engineering', 'Cross-validation for finance', 'Labeling', 'Overfitting', 'Model governance'],
    miaComponents: ['qci/ (consensus)', 'ditas/ (decision memory, calibration)', 'joe/joe.ts'],
    exercises: ['Apply purged and embargoed validation to any learned model'], hypotheses: ['Unpurged CV overstates out-of-sample accuracy on overlapping labels'], evaluation: ['Calibration error', 'OOS vs CV gap'] },
  { id: 'behavioral', name: 'Trading psychology and behavioral finance', categories: ['Cognitive biases', 'Loss aversion', 'Discipline', 'Randomness'],
    miaComponents: ['risk/gate.ts (no martingale, loss-streak cooldown)', 'exec/oms.ts (autopsy)'], exercises: ['Audit the journal for rule deviations after loss streaks'],
    hypotheses: ['Automated rules remove discretionary loss-chasing'], evaluation: ['Zero risk-increasing actions after loss streaks'] },
  { id: 'execution', name: 'Advanced execution and quantitative strategies', categories: ['Optimal execution', 'Statistical arbitrage', 'Market making', 'Derivatives and volatility'],
    miaComponents: ['exec/oms.ts', 'ditas/twin.ts (Decision Twin)'], exercises: ['Compare market vs passive entry costs in the Decision Twin'],
    hypotheses: ['Passive entries reduce cost but miss a measurable share of winners'], evaluation: ['Implementation shortfall', 'Fill rate'] },
  { id: 'research', name: 'Quantitative research and scientific thinking', categories: ['Research design', 'Reproducibility', 'Biases in backtests', 'Falsification'],
    miaComponents: ['knowledge/research.ts (experiment registry)', 'docs/'], exercises: ['Pre-register a hypothesis, then test it once on untouched data'],
    hypotheses: ['Pre-registered tests replicate more often than exploratory ones'], evaluation: ['Replication status', 'Number of trials recorded'] },
];
export const disciplineIds = DISCIPLINES.map((d) => d.id);

/**
 * Initial catalog: the 20 priority titles exactly as listed by the owner. The remaining ~80 curriculum titles are
 * added through catalog import (the shared curriculum link was not reachable from the build environment).
 * A catalog entry is a LISTING ONLY — it does not contain the book.
 */
export const PRIORITY_CATALOG: { title: string; authors: string; discipline: string }[] = [
  { title: 'Trading and Exchanges', authors: 'Larry Harris', discipline: 'microstructure' },
  { title: 'Technical Analysis of the Financial Markets', authors: 'John J. Murphy', discipline: 'technical' },
  { title: 'The Art and Science of Technical Analysis', authors: 'Adam Grimes', discipline: 'technical' },
  { title: 'Quantitative Trading', authors: 'Ernest P. Chan', discipline: 'algorithmic' },
  { title: 'Algorithmic Trading', authors: 'Ernest P. Chan', discipline: 'algorithmic' },
  { title: 'Inside the Black Box', authors: 'Rishi K. Narang', discipline: 'algorithmic' },
  { title: 'Introduction to Probability', authors: 'Joseph K. Blitzstein and Jessica Hwang', discipline: 'probability' },
  { title: 'All of Statistics', authors: 'Larry Wasserman', discipline: 'statistics' },
  { title: 'Introductory Econometrics for Finance', authors: 'Chris Brooks', discipline: 'statistics' },
  { title: 'Analysis of Financial Time Series', authors: 'Ruey S. Tsay', discipline: 'statistics' },
  { title: 'Options, Futures, and Other Derivatives', authors: 'John C. Hull', discipline: 'execution' },
  { title: 'Option Volatility and Pricing', authors: 'Sheldon Natenberg', discipline: 'execution' },
  { title: 'Active Portfolio Management', authors: 'Richard Grinold and Ronald Kahn', discipline: 'portfolio_risk' },
  { title: 'Quantitative Risk Management', authors: 'McNeil, Frey and Embrechts', discipline: 'portfolio_risk' },
  { title: 'Market Microstructure Theory', authors: "Maureen O'Hara", discipline: 'microstructure' },
  { title: 'Empirical Market Microstructure', authors: 'Joel Hasbrouck', discipline: 'microstructure' },
  { title: 'Advances in Financial Machine Learning', authors: 'Marcos López de Prado', discipline: 'ml' },
  { title: 'Machine Learning for Asset Managers', authors: 'Marcos López de Prado', discipline: 'ml' },
  { title: 'Trading in the Zone', authors: 'Mark Douglas', discipline: 'behavioral' },
  { title: 'Fooled by Randomness', authors: 'Nassim Nicholas Taleb', discipline: 'behavioral' },
];

export interface ConceptCard {
  name: string; discipline: string; evidenceClass: EvidenceClass;
  explanation: string; formula?: string; inputs: string[]; assumptions: string[]; appliesWhen: string[]; failsWhen: string[];
  applications: string[]; risks: string[]; related: string[]; keywords: string[];
  /** Research experiment kind (knowledge/research.ts) that can test this concept on real data, if any. */
  experiment?: 'volatility_clustering' | 'return_autocorrelation' | 'strategy_walkforward';
  miaComponents: string[];
}
export const CONCEPT_CARDS: ConceptCard[] = [
  { name: 'Volatility clustering', discipline: 'statistics', evidenceClass: 'EMPIRICAL_FINDING',
    explanation: 'Large price changes tend to be followed by large changes and small by small, so volatility comes in persistent regimes even when returns themselves are nearly uncorrelated.',
    formula: 'Corr(|r_t|, |r_{t-k}|) > 0 for small k, while Corr(r_t, r_{t-k}) ≈ 0; modeled by GARCH(1,1): σ²_t = ω + α·r²_{t-1} + β·σ²_{t-1}',
    inputs: ['log returns r_t at a fixed interval'], assumptions: ['returns are measured on a regular clock', 'sample long enough for autocorrelation estimates'],
    appliesWhen: ['liquid markets with continuous trading', 'intraday to daily horizons'], failsWhen: ['very sparse or illiquid data', 'structural breaks dominate the sample'],
    applications: ['volatility-scaled position sizing', 'regime detection', 'stop distance in ATR units'], risks: ['clusters do not predict direction', 'GARCH misses jumps'],
    related: ['Average true range (ATR)', 'Stationarity', 'Mean reversion'], keywords: ['volatility clustering', 'garch', 'heteroskedasticity', 'arch effect', 'squared returns'],
    experiment: 'volatility_clustering', miaComponents: ['regime/regime.ts', 'workers (volatility domain)', 'risk/gate.ts (ATR stops)'] },
  { name: 'Mean reversion', discipline: 'statistics', evidenceClass: 'UNVERIFIED_HYPOTHESIS',
    explanation: 'The hypothesis that a price or spread tends to return toward a mean after deviating, detectable as negative autocorrelation of returns or a stationary spread.',
    formula: 'Corr(r_t, r_{t-1}) < 0; or Ornstein–Uhlenbeck dX_t = θ(μ − X_t)dt + σ dW_t with half-life ln(2)/θ',
    inputs: ['returns or a spread series'], assumptions: ['the mean is stable over the trading horizon'], appliesWhen: ['range-bound regimes', 'cointegrated pairs'],
    failsWhen: ['trending regimes', 'structural breaks'], applications: ['range reversion strategy', 'pairs trading'], risks: ['catching falling knives in trends'],
    related: ['Momentum', 'Stationarity'], keywords: ['mean reversion', 'ornstein', 'half-life', 'reverting'], experiment: 'return_autocorrelation', miaComponents: ['lab/strategies.ts (range_reversion)'] },
  { name: 'Momentum', discipline: 'technical', evidenceClass: 'EMPIRICAL_FINDING',
    explanation: 'Assets that have risen tend to continue rising over some horizons (time-series momentum); detectable as positive autocorrelation of multi-period returns.',
    formula: 'Corr(r_{t-k..t}, r_{t..t+h}) > 0 for the tested lookback k and holding period h',
    inputs: ['returns over lookback and holding windows'], assumptions: ['transaction costs are lower than the expected drift'], appliesWhen: ['trending regimes'],
    failsWhen: ['momentum crashes at regime reversals', 'range-bound markets'], applications: ['trend pullback and breakout strategies'], risks: ['crowding', 'sharp reversals'],
    related: ['Mean reversion', 'Walk-forward validation'], keywords: ['momentum', 'trend following', 'time-series momentum'], experiment: 'return_autocorrelation',
    miaComponents: ['lab/strategies.ts (trend_pullback, donchian_breakout)', 'workers (momentum domain)'] },
  { name: 'Walk-forward validation', discipline: 'algorithmic', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'Evaluate a strategy by repeatedly fitting (or fixing) it on a past window and testing it on the following unseen window, rolling forward through time, so every reported result is out-of-sample.',
    inputs: ['time-ordered data', 'train and test window lengths'], assumptions: ['the future resembles the recent past enough for the rule to transfer'],
    appliesWhen: ['any time-series strategy evaluation'], failsWhen: ['too few trades per window', 'parameters re-tuned on test windows'],
    applications: ['strategy promotion decisions in the Strategy Lab'], risks: ['repeated walk-forward runs still overfit if many variants are tried'],
    related: ['Purged cross-validation and embargo', 'Backtest overfitting', 'Look-ahead bias'], keywords: ['walk-forward', 'walk forward', 'out-of-sample', 'rolling window'],
    experiment: 'strategy_walkforward', miaComponents: ['lab/backtest.ts', 'knowledge/research.ts'] },
  { name: 'Purged cross-validation and embargo', discipline: 'ml', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'When labels span time (e.g. a trade held for several bars), training samples whose label window overlaps the test window must be removed (purged), and a gap after the test window (embargo) prevents leakage through serial correlation.',
    inputs: ['label start and end times', 'embargo length'], assumptions: ['label horizons are known'], appliesWhen: ['overlapping financial labels'], failsWhen: ['label horizon unknown'],
    applications: ['walk-forward splits in knowledge/research.ts'], risks: ['too long an embargo wastes data'], related: ['Walk-forward validation', 'Look-ahead bias'],
    keywords: ['purged', 'purging', 'embargo', 'cross-validation', 'leakage'], miaComponents: ['knowledge/research.ts'] },
  { name: 'Look-ahead bias', discipline: 'research', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'Using information in a backtest that would not have been available at the decision time, which inflates results.',
    inputs: ['timestamps of every input'], assumptions: [], appliesWhen: ['every backtest'], failsWhen: [], applications: ['next-bar entries, closed-candle-only features in MIA'],
    risks: ['subtle leaks through revised data or end-of-bar values'], related: ['Survivorship bias', 'Walk-forward validation'], keywords: ['look-ahead', 'lookahead', 'future information', 'peeking'],
    miaComponents: ['lab/backtest.ts (next-bar entry)', 'market/fabric.ts (closed candles)'] },
  { name: 'Survivorship bias', discipline: 'research', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'Testing only on instruments that still exist today excludes those that failed or were delisted, biasing results upward.',
    inputs: ['point-in-time universe membership'], assumptions: [], appliesWhen: ['universe selection'], failsWhen: [], applications: ['MIA documents that its universe is today\'s liquid listings'],
    risks: ['overstated returns'], related: ['Look-ahead bias'], keywords: ['survivorship', 'delisted', 'survivor'], miaComponents: ['market/fabric.ts (selectUniverse)'] },
  { name: 'Backtest overfitting', discipline: 'research', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'Selecting the best of many tried variants on the same data produces results that do not persist; the more trials, the higher the expected best result under pure noise.',
    inputs: ['number of trials', 'per-trial results'], assumptions: [], appliesWhen: ['parameter searches', 'strategy selection'], failsWhen: [],
    applications: ['record every trial in research_experiments'], risks: ['false discoveries'], related: ['Walk-forward validation', 'Sharpe ratio'], keywords: ['overfitting', 'data snooping', 'multiple testing', 'selection bias'],
    miaComponents: ['knowledge/research.ts (trial counts)'] },
  { name: 'Sharpe ratio', discipline: 'portfolio_risk', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'Mean excess return divided by the standard deviation of returns, usually annualised; penalises upside and downside volatility equally.',
    formula: 'SR = (E[r] − r_f) / σ(r) · √(periods per year)', inputs: ['periodic returns', 'risk-free rate'], assumptions: ['returns roughly i.i.d. with finite variance'],
    appliesWhen: ['comparing strategies with similar return distributions'], failsWhen: ['fat-tailed or skewed returns', 'autocorrelated returns'],
    applications: ['strategy comparison metrics'], risks: ['short samples give very noisy estimates'], related: ['Sortino ratio', 'Maximum drawdown'], keywords: ['sharpe', 'risk-adjusted return'],
    miaComponents: ['knowledge/research.ts (metrics)'] },
  { name: 'Sortino ratio', discipline: 'portfolio_risk', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'Like the Sharpe ratio but divides by downside deviation only, so upside volatility is not penalised.',
    formula: 'Sortino = (E[r] − T) / √(E[min(0, r − T)²])', inputs: ['periodic returns', 'target T'], assumptions: ['enough negative observations'], appliesWhen: ['skewed return distributions'],
    failsWhen: ['few losing periods'], applications: ['strategy comparison metrics'], risks: ['unstable with few losses'], related: ['Sharpe ratio'], keywords: ['sortino', 'downside deviation'], miaComponents: ['knowledge/research.ts (metrics)'] },
  { name: 'Maximum drawdown', discipline: 'portfolio_risk', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'The largest peak-to-trough decline of an equity curve.', formula: 'MDD = max_t (max_{s≤t} E_s − E_t) / max_{s≤t} E_s',
    inputs: ['equity curve'], assumptions: [], appliesWhen: ['all strategies'], failsWhen: [], applications: ['risk policy drawdown breakers', 'Calmar ratio'],
    risks: ['historical maximum understates future drawdowns'], related: ['Sharpe ratio', 'Kelly criterion'], keywords: ['drawdown', 'peak-to-trough'], miaComponents: ['risk/gate.ts (drawdown breaker)'] },
  { name: 'Kelly criterion', discipline: 'probability', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'The bet fraction that maximises expected log growth given known win probability and payoff; full Kelly is very volatile and highly sensitive to estimation error.',
    formula: 'f* = p − (1 − p)/b, for win probability p and win/loss payoff ratio b', inputs: ['p', 'b'], assumptions: ['p and b known exactly', 'independent repeated bets'],
    appliesWhen: ['well-estimated edges'], failsWhen: ['estimated edges (overbetting risk)', 'correlated bets'], applications: ['upper bound check on MIA\'s fixed fractional risk'],
    risks: ['ruinous drawdowns when p is overestimated'], related: ['Maximum drawdown'], keywords: ['kelly', 'optimal f', 'log growth'], miaComponents: ['risk/policy.ts (fixed fractional risk, not Kelly)'] },
  { name: 'Bid–ask spread', discipline: 'microstructure', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'The difference between the best ask and best bid; a round trip with market orders pays roughly the full spread.',
    formula: 'spread_bps = (ask − bid) / mid · 10,000', inputs: ['best bid', 'best ask'], assumptions: [], appliesWhen: ['order-driven markets'], failsWhen: ['stale quotes'],
    applications: ['execution cost estimates', 'asset safety filter'], risks: ['spread widens in stress'], related: ['Adverse selection', 'Market impact'], keywords: ['bid-ask', 'bid ask spread', 'spread'],
    miaComponents: ['market/quality.ts', 'safety/safety.ts'] },
  { name: 'Adverse selection', discipline: 'microstructure', evidenceClass: 'AUTHOR_INTERPRETATION',
    explanation: 'Liquidity providers lose to better-informed traders; part of the spread compensates for this risk, and passive fills are more likely when price is about to move against the filled side.',
    inputs: ['fill events', 'subsequent price moves'], assumptions: ['some traders are better informed'], appliesWhen: ['passive/limit order execution'], failsWhen: [],
    applications: ['evaluating passive entries in the Decision Twin'], risks: ['passive fills skewed toward losers'], related: ['Bid–ask spread', 'Market impact'],
    keywords: ['adverse selection', 'informed trader', 'toxic flow', 'winner\'s curse'], miaComponents: ['ditas/twin.ts', 'exec/oms.ts'] },
  { name: 'Market impact', discipline: 'microstructure', evidenceClass: 'EMPIRICAL_FINDING',
    explanation: 'Executing an order moves the price against the trader, roughly increasing with order size relative to available liquidity (often modeled as proportional to the square root of participation).',
    formula: 'impact ≈ σ · √(Q / V) (square-root law, empirical)', inputs: ['order size Q', 'volume V', 'volatility σ'], assumptions: ['normal market conditions'],
    appliesWhen: ['orders that are a meaningful fraction of volume or depth'], failsWhen: ['very small orders (spread dominates)'], applications: ['book-walk slippage estimate in MIA'],
    risks: ['visible depth understates hidden liquidity or overstates it in stress'], related: ['Bid–ask spread', 'Adverse selection'], keywords: ['market impact', 'price impact', 'square root law', 'slippage'],
    miaComponents: ['market/quality.ts (walkBook)'] },
  { name: 'Average true range (ATR)', discipline: 'technical', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'A volatility measure: the moving average (Wilder smoothing) of the true range, the largest of high−low, |high−prev close| and |low−prev close|.',
    formula: 'TR_t = max(H_t − L_t, |H_t − C_{t−1}|, |L_t − C_{t−1}|); ATR_t = (ATR_{t−1}·(n−1) + TR_t)/n', inputs: ['OHLC candles'], assumptions: [],
    appliesWhen: ['volatility-scaled stops and sizing'], failsWhen: ['gaps larger than recent ranges'], applications: ['stop distances in MIA strategies'], risks: ['lags sudden volatility changes'],
    related: ['Volatility clustering'], keywords: ['average true range', 'atr', 'true range'], miaComponents: ['features/indicators.ts (atr14)'] },
  { name: 'Stationarity', discipline: 'statistics', evidenceClass: 'MATHEMATICAL_DEFINITION',
    explanation: 'A series is (weakly) stationary if its mean, variance and autocovariances do not change over time; prices usually are not, returns approximately are.',
    inputs: ['time series'], assumptions: [], appliesWhen: ['before applying most time-series models'], failsWhen: ['regime changes'], applications: ['model on returns, not raw prices'],
    risks: ['spurious regression on non-stationary series'], related: ['Mean reversion', 'Volatility clustering'], keywords: ['stationary', 'stationarity', 'unit root', 'dickey-fuller'], miaComponents: ['knowledge/research.ts'] },
  { name: 'Efficient market hypothesis', discipline: 'behavioral', evidenceClass: 'AUTHOR_INTERPRETATION',
    explanation: 'The proposition that prices fully reflect available information so that risk-adjusted excess returns cannot be earned consistently. Its strength and validity are contested; behavioral finance documents anomalies.',
    inputs: [], assumptions: ['rational, well-informed participants and low trading frictions'], appliesWhen: [], failsWhen: [], applications: ['skepticism toward any backtested edge'],
    risks: ['treated as settled in either direction'], related: ['Loss aversion', 'Backtest overfitting'], keywords: ['efficient market', 'market efficiency', 'random walk'], miaComponents: [] },
  { name: 'Loss aversion', discipline: 'behavioral', evidenceClass: 'EMPIRICAL_FINDING',
    explanation: 'People weigh losses more heavily than equal gains (prospect theory), which can lead traders to hold losers and cut winners.',
    inputs: [], assumptions: [], appliesWhen: ['discretionary decisions'], failsWhen: [], applications: ['MIA forbids widening stops and martingale sizing'],
    risks: ['disposition effect'], related: ['Efficient market hypothesis'], keywords: ['loss aversion', 'prospect theory', 'disposition effect'], miaComponents: ['risk/gate.ts', 'lab/exits.ts (stops only tighten)'] },
];

/** Strategy → concepts that justify or challenge it (used to attach knowledge to decision reports). */
export const STRATEGY_CONCEPTS: Record<string, string[]> = {
  trend_pullback: ['Momentum', 'Average true range (ATR)', 'Walk-forward validation'],
  donchian_breakout: ['Momentum', 'Volatility clustering', 'Walk-forward validation'],
  range_reversion: ['Mean reversion', 'Stationarity', 'Walk-forward validation'],
};
/** Worker evidence domain → concepts a worker in that domain can consult (read-only; never alters its vote). */
export const DOMAIN_CONCEPTS: Record<string, string[]> = {
  trend: ['Momentum'], momentum: ['Momentum', 'Mean reversion'], volatility: ['Volatility clustering', 'Average true range (ATR)'],
  flow: ['Market impact'], liquidity: ['Bid–ask spread', 'Market impact'], execution: ['Bid–ask spread', 'Adverse selection', 'Market impact'],
  structure: ['Mean reversion'], regime: ['Volatility clustering', 'Stationarity'], risk: ['Maximum drawdown', 'Kelly criterion'], news: ['Efficient market hypothesis'], onchain: [],
};
