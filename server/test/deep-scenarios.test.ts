import { describe, expect, it } from 'vitest';
import type { ChartReport } from '../src/chart/analysis.js';
import { analyzeDeepScenarios } from '../src/chart/scenarios.js';
import {
  scoreMulticlassForecast, scoreScenariosByRegime, reviewScenarioModelPromotion,
} from '../src/ditas/calibration.js';

const NOW = Date.UTC(2026, 10, 23, 13, 0, 0);
function chart(
  timeframe: '15m' | '1h' | '4h', trend: ChartReport['trend'],
  status: ChartReport['status'] = 'VALID',
): ChartReport {
  return {
    instrument: 'crypto:binance:BTCUSDT', timeframe, asOf: NOW, trend, status, issues: [],
    support: 95, resistance: 105, detections: [], decision: 'NO TRADE', note: 'test fixture',
  };
}

describe('DEEP point-in-time scenario and DITAS multiclass calibration', () => {
  it('uses full 15m/1h/4h structure, but never labels heuristic weights win probabilities', () => {
    const b = analyzeDeepScenarios({
      '15m': chart('15m','BULLISH'), '1h': chart('1h','BULLISH'), '4h': chart('4h','BULLISH'),
    })!;
    expect(b.regime).toBe('TRENDING_BULL');
    expect(b.calibration).toBe('UNCALIBRATED');
    expect(b.tradingAuthority).toBe(false);
    expect(Object.values(b.relativeWeights).reduce((a,n)=>a+n,0)).toBeCloseTo(1,10);
    expect(b.relativeWeights.bullish).toBeGreaterThan(b.relativeWeights.bearish);
    const mismatch = analyzeDeepScenarios({
      '15m': chart('15m','BULLISH'), '1h': chart('1h','BEARISH'), '4h': chart('4h','BULLISH'),
    })!;
    expect(mismatch.regime).toBe('TRANSITIONAL');
  });

  it('rejects invalid, stale/mismatched timestamp snapshots rather than forward-filling', () => {
    const bad = chart('15m','BULLISH','INVALID');
    expect(analyzeDeepScenarios({ '15m': bad, '1h': chart('1h','BULLISH'), '4h': chart('4h','BULLISH') }))
      .toBeNull();
    expect(analyzeDeepScenarios({ '15m': { ...chart('15m','BULLISH'), asOf: NOW + 1 },
      '1h': chart('1h','BULLISH'), '4h': chart('4h','BULLISH') })).toBeNull();
  });

  it('computes proper Brier and log loss, rejecting fake probabilities', () => {
    const good = scoreMulticlassForecast(
      { BULLISH: 0.7, SIDEWAYS: 0.2, BEARISH: 0.1 }, 'BULLISH',
    );
    expect(good.brierScore).toBeCloseTo(0.14,10);
    expect(good.logLoss).toBeCloseTo(-Math.log(0.7),10);
    expect(good.calibrationStatus).toBe('MEASURED_NOT_CERTIFIED');
    expect(() => scoreMulticlassForecast({
      BULLISH: 0.8, SIDEWAYS: 0.8, BEARISH: -0.6,
    }, 'BULLISH')).toThrow('INVALID_SCENARIO_DISTRIBUTION');
    expect(() => scoreMulticlassForecast({
      BULLISH: Number.NaN, SIDEWAYS: 0.4, BEARISH: 0.6,
    }, 'BULLISH')).toThrow('INVALID_SCENARIO_DISTRIBUTION');
  });

  it('separates market regimes and executed net expectancy from shadow forecasts', () => {
    const rows = [
      { regime: 'TRENDING_BULL' as const,
        probabilities: { BULLISH: 0.7, SIDEWAYS: 0.2, BEARISH: 0.1 },
        realized: 'BULLISH' as const, wasExecuted: true, realizedNetReturnBps: 10 },
      { regime: 'ILLIQUID' as const,
        probabilities: { BULLISH: 0.2, SIDEWAYS: 0.1, BEARISH: 0.7 },
        realized: 'BEARISH' as const, wasExecuted: false, realizedNetReturnBps: null },
    ];
    const slices = scoreScenariosByRegime(rows, 25);
    expect(slices).toHaveLength(2);
    expect(slices.every(x => x.sampleQualified === false && x.tradingAuthority === false)).toBe(true);
    expect(slices.find(x => x.regime === 'ILLIQUID')!.actualExecutedNetExpectancyBps).toBeNull();
    expect(slices.find(x => x.regime === 'TRENDING_BULL')!.actualExecutedNetExpectancyBps).toBe(10);
    expect(() => scoreScenariosByRegime([{ ...rows[1], realizedNetReturnBps: 5 }])).toThrow();
  });

  it('demands separate walk-forward, holdout, shadow and drift review; never self-promotes', () => {
    const evidence = {
      walkForward: { windowCount: 4, sampleCount: 150, meanBrier: 0.4, netExpectancyBps: 9, passed: true },
      untouchedHoldout: { datasetHash: 'sha256-fixture', sampleCount: 60,
        meanBrier: 0.41, netExpectancyBps: 7, passed: true },
      shadow: { durationHours: 72, sampleCount: 60, slippageDriftBps: 2, passed: true },
      driftQuarantined: false,
    };
    expect(reviewScenarioModelPromotion(evidence)).toEqual({
      stage: 'MODEL_REVIEW_REQUIRED', reasons: [], tradingAuthority: false, automaticPromotion: false,
    });
    expect(reviewScenarioModelPromotion({
      ...evidence, untouchedHoldout: { ...evidence.untouchedHoldout, passed: false },
    }).reasons).toContain('HOLDOUT_UNVERIFIED');
    expect(reviewScenarioModelPromotion({ ...evidence, driftQuarantined: true }).stage)
      .toBe('DRIFT_QUARANTINED');
  });
});
