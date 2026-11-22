import { describe, expect, it } from 'vitest';
import { marketCoverage } from '../src/market/coverage.js';
import { LIVE_EXECUTION_AVAILABLE } from '../src/core/mode.js';

const at = Date.parse('2026-11-21T00:00:00.000Z');

describe('MIA-ID-01 five-sleeve market capability projection (read-only)', () => {
  it('has precisely the PDF proposed five sleeves with no duplicated execution service', () => {
    const report = marketCoverage(at, 'Asia/Manila');
    expect(report.sleeves.map(s => s.sleeve)).toEqual(['futures', 'spot', 'memecoin', 'yield', 'stocks_etf']);
    expect(new Set(report.sleeves.map(s => s.sleeve)).size).toBe(5);
  });

  it('uses the existing market source state instead of creating a duplicate provider registry', () => {
    const report = marketCoverage(at, 'UTC');
    for (const sleeve of report.sleeves) {
      const canonicalMarket = report.markets.find(m => m.market === sleeve.referenceMarket);
      expect(sleeve.sources).toEqual(canonicalMarket?.sources ?? []);
    }
  });

  it('identifies the only current PAPER implementation correctly', () => {
    const report = marketCoverage(at, 'UTC');
    expect(report.sleeves.find(s => s.sleeve === 'spot')).toMatchObject({
      paperCapability: 'PAPER_IMPLEMENTED',
      liveExecution: 'LOCKED',
    });
    expect(report.sleeves.find(s => s.sleeve === 'memecoin')?.paperCapability).toBe('DISCOVERY_ONLY');
    for (const sleeve of ['futures', 'yield', 'stocks_etf'] as const) {
      expect(report.sleeves.find(s => s.sleeve === sleeve)?.paperCapability).toBe('UNAVAILABLE');
    }
  });

  it('never mistakes a healthy market-data provider for real-money execution authorization', () => {
    expect(LIVE_EXECUTION_AVAILABLE).toBe(false);
    const report = marketCoverage(at, 'UTC');
    expect(report.sleeves.every(s => s.liveExecution === 'LOCKED')).toBe(true);
    expect(report.sleeves.every(s => s.limitation.length > 20)).toBe(true);
  });

  it('keeps existing market coverage, session clocks and additional markets intact', () => {
    const report = marketCoverage(at, 'Asia/Manila');
    expect(report.asOf).toBe(at);
    expect(report.markets.some(m => m.market === 'Forex')).toBe(true);
    expect(report.markets.some(m => m.market === 'Commodities')).toBe(true);
    expect(report.markets.some(m => m.market === 'CEX crypto spot')).toBe(true);
    expect(report.displayClock).toBeDefined();
    expect(report.clocks).toHaveLength(8);
  });
});
