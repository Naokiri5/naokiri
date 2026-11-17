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
