/** Genuine, settled binary forecasts only. Evidence scores and worker votes are not probabilities. */
export interface CalibrationRow { probability: number; outcome: 0 | 1 }
export interface CalibrationOptions {
  minSamples?: number; minBinSamples?: number; bins?: number; epsilon?: number;
}
export interface ReliabilityBin {
  lower: number; upper: number; count: number;
  prediction: number | null; observed: number | null;
  wilson95: [number, number] | null;
  status: 'EMPTY' | 'INSUFFICIENT' | 'EVALUATED';
}
export interface CalibrationReport {
  sample: number; status: 'UNCALIBRATED' | 'EVALUATED';
  brierScore: number | null; logLoss: number | null; ece: number | null;
  bins: ReliabilityBin[]; minSamples: number; minBinSamples: number;
  uncertainty: string[]; note: string;
}

const integerOption = (value: number, name: string, max: number) => {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer between 1 and ${max}`);
  return value;
};

/** 95% Wilson score interval for the observed binary event frequency, not model confidence. */
function wilson(successes: number, count: number): [number, number] {
  const z = 1.959963984540054, z2 = z * z, p = successes / count;
  const denominator = 1 + z2 / count;
  const center = (p + z2 / (2 * count)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * count)) / count) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/**
 * Evaluate a homogeneous, chronologically settled forecast cohort. Caller must enforce cohort,
 * provenance and observation timing. This pure function neither fits nor promotes a model.
 */
export function calibrationReport(rows: readonly CalibrationRow[], options: CalibrationOptions = {}): CalibrationReport {
  const minSamples = integerOption(options.minSamples ?? 100, 'minSamples', 10_000_000);
  const minBinSamples = integerOption(options.minBinSamples ?? 20, 'minBinSamples', 10_000_000);
  const binCount = integerOption(options.bins ?? 10, 'bins', 100);
  const epsilon = options.epsilon ?? 1e-15;
  if (!Number.isFinite(epsilon) || epsilon < Number.EPSILON || epsilon >= 0.5) throw new Error('epsilon must be finite, at least machine epsilon and below 0.5');
  const totals = Array.from({ length: binCount }, () => ({ count: 0, probability: 0, successes: 0 }));
  let squaredError = 0, crossEntropy = 0;
  for (const row of rows) {
    if (!row || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1 || (row.outcome !== 0 && row.outcome !== 1)) throw new Error('calibration rows require a finite probability in [0,1] and binary outcome');
    const p = row.probability, y = row.outcome;
    squaredError += (p - y) ** 2;
    const clipped = Math.max(epsilon, Math.min(1 - epsilon, p));
    crossEntropy -= y ? Math.log(clipped) : Math.log1p(-clipped);
    const bin = totals[Math.min(binCount - 1, Math.floor(p * binCount))];
    bin.count++; bin.probability += p; bin.successes += y;
  }
  const bins: ReliabilityBin[] = totals.map((bin, i) => ({
    lower: i / binCount, upper: (i + 1) / binCount, count: bin.count,
    prediction: bin.count ? bin.probability / bin.count : null,
    observed: bin.count ? bin.successes / bin.count : null,
    wilson95: bin.count ? wilson(bin.successes, bin.count) : null,
    status: !bin.count ? 'EMPTY' : bin.count < minBinSamples ? 'INSUFFICIENT' : 'EVALUATED',
  }));
  const sample = rows.length, uncertainty: string[] = [];
  if (sample < minSamples) uncertainty.push(`Only ${sample} settled forecasts; minimum ${minSamples} required for cohort evaluation.`);
  const sparse = bins.filter(bin => bin.status === 'INSUFFICIENT').length;
  if (sparse) uncertainty.push(`${sparse} populated reliability bins have fewer than ${minBinSamples} observations.`);
  uncertainty.push('Wilson intervals assume independent binary observations; overlapping trades and regime changes can reduce effective sample size.');
  return {
    sample, status: sample < minSamples ? 'UNCALIBRATED' : 'EVALUATED',
    brierScore: sample ? squaredError / sample : null,
    logLoss: sample ? crossEntropy / sample : null,
    ece: sample ? bins.reduce((sum, bin) => sum + (bin.count ? Math.abs(bin.prediction! - bin.observed!) * bin.count / sample : 0), 0) : null,
    bins, minSamples, minBinSamples, uncertainty,
    note: 'EVALUATED means metrics were computed on a sample-qualified cohort, not proof of calibration or future profit. Forecast provenance and target definitions must be checked separately; evidence scores are never converted to probabilities.',
  };
}

/**
 * BrainOS 6.1: genuine settled three-way forecast evaluation.
 * Unlike chart-pattern confidence these values MUST be probabilities from a
 * separately calibrated model. This extension does not promote any strategy.
 */
export type ScenarioOutcomeClass = 'BULLISH' | 'SIDEWAYS' | 'BEARISH';
export type ScenarioProbabilities = Record<ScenarioOutcomeClass, number>;
export interface MulticlassScenarioScore {
  brierScore: number;
  logLoss: number;
  realizedClassProbability: number;
  signedCalibrationResidual: number;
  calibrationStatus: 'MEASURED_NOT_CERTIFIED';
}
const SCENARIO_CLASSES: ScenarioOutcomeClass[] = ['BULLISH','SIDEWAYS','BEARISH'];
export function scoreMulticlassForecast(
  probabilities: ScenarioProbabilities,
  realized: ScenarioOutcomeClass,
): MulticlassScenarioScore {
  if (!SCENARIO_CLASSES.includes(realized)) throw new Error('INVALID_SCENARIO_OUTCOME');
  const values = SCENARIO_CLASSES.map(key => probabilities?.[key]);
  if (values.some(p => !Number.isFinite(p) || p < 0 || p > 1)
      || Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 1e-7)
    throw new Error('INVALID_SCENARIO_DISTRIBUTION');
  const brierScore = SCENARIO_CLASSES.reduce(
    (score, key) => score + (probabilities[key] - (key === realized ? 1 : 0)) ** 2, 0,
  );
  const realizedClassProbability = probabilities[realized];
  const epsilon = 1e-12;
  return {
    brierScore, logLoss: -Math.log(Math.max(epsilon, Math.min(1 - epsilon, realizedClassProbability))),
    realizedClassProbability, signedCalibrationResidual: realizedClassProbability - 1,
    calibrationStatus: 'MEASURED_NOT_CERTIFIED',
  };
}

export interface ScenarioRegimeObservation {
  regime: 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'HIGH_VOLATILITY' | 'ILLIQUID' | 'TRANSITIONAL';
  probabilities: ScenarioProbabilities;
  realized: ScenarioOutcomeClass;
  /** Only actual executed positions may contribute verified trading expectancy. */
  wasExecuted: boolean;
  realizedNetReturnBps: number | null;
}
export function scoreScenariosByRegime(
  observations: readonly ScenarioRegimeObservation[],
  minSamples = 25,
) {
  if (!Number.isInteger(minSamples) || minSamples <= 0) throw new Error('INVALID_REGIME_MIN_SAMPLES');
  const grouped = new Map<ScenarioRegimeObservation['regime'], ScenarioRegimeObservation[]>();
  for (const row of observations) {
    if (row.wasExecuted && (row.realizedNetReturnBps == null || !Number.isFinite(row.realizedNetReturnBps)))
      throw new Error('EXECUTED_SCENARIO_REQUIRES_SETTLED_NET_RETURN');
    if (!row.wasExecuted && row.realizedNetReturnBps != null)
      throw new Error('SHADOW_SCENARIO_CANNOT_CLAIM_EXECUTED_PNL');
    scoreMulticlassForecast(row.probabilities, row.realized);
    const g = grouped.get(row.regime) ?? [];
    g.push(row); grouped.set(row.regime, g);
  }
  return [...grouped.entries()].map(([regime, samples]) => {
    const scores = samples.map(x => scoreMulticlassForecast(x.probabilities, x.realized));
    const executed = samples.filter(x => x.wasExecuted);
    return {
      regime, sampleCount: samples.length, executedCount: executed.length,
      sampleQualified: samples.length >= minSamples,
      meanBrierScore: scores.reduce((n,x)=>n+x.brierScore,0)/scores.length,
      meanLogLoss: scores.reduce((n,x)=>n+x.logLoss,0)/scores.length,
      actualExecutedNetExpectancyBps: executed.length
        ? executed.reduce((n,x)=>n+x.realizedNetReturnBps!,0)/executed.length : null,
      tradingAuthority: false as const,
      note: 'Historical cohort statistics are not model certification or entry authority.',
    };
  });
}

export interface ScenarioPromotionEvidence {
  walkForward: { windowCount: number; sampleCount: number; meanBrier: number; netExpectancyBps: number; passed: boolean };
  untouchedHoldout: { datasetHash: string; sampleCount: number; meanBrier: number; netExpectancyBps: number; passed: boolean };
  shadow: { durationHours: number; sampleCount: number; slippageDriftBps: number; passed: boolean };
  driftQuarantined: boolean;
}
/** A release-review recommendation, NEVER automatic model deployment or a LIVE gate. */
export function reviewScenarioModelPromotion(e: ScenarioPromotionEvidence) {
  const reasons: string[] = [];
  if (!e.walkForward.passed || e.walkForward.windowCount < 4 || e.walkForward.sampleCount < 120
      || !Number.isFinite(e.walkForward.meanBrier) || !Number.isFinite(e.walkForward.netExpectancyBps)
      || e.walkForward.netExpectancyBps <= 0) reasons.push('WALK_FORWARD_UNVERIFIED');
  if (!e.untouchedHoldout.passed || !e.untouchedHoldout.datasetHash
      || e.untouchedHoldout.sampleCount < 50 || !Number.isFinite(e.untouchedHoldout.meanBrier)
      || !Number.isFinite(e.untouchedHoldout.netExpectancyBps)
      || e.untouchedHoldout.netExpectancyBps <= 0) reasons.push('HOLDOUT_UNVERIFIED');
  if (!e.shadow.passed || e.shadow.durationHours <= 0 || e.shadow.sampleCount < 30
      || !Number.isFinite(e.shadow.slippageDriftBps) || Math.abs(e.shadow.slippageDriftBps) > 6)
    reasons.push('SHADOW_EXECUTION_UNVERIFIED');
  if (e.driftQuarantined) reasons.push('LIVE_CALIBRATION_DRIFT');
  return { stage: e.driftQuarantined ? 'DRIFT_QUARANTINED' as const
      : reasons.length ? 'SHADOW_ONLY' as const : 'MODEL_REVIEW_REQUIRED' as const,
    reasons, tradingAuthority: false as const, automaticPromotion: false as const };
}
