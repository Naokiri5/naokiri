import { expect } from 'vitest';
import type { seedInstrument } from './helpers.js';
import { decide, type DecisionReport } from '../src/decision/engine.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import type { Candidate } from '../src/workers/types.js';
/**
 * A PAPER_TRADE decision for a seeded instrument, produced by the real decision engine and risk gate with a unanimous
 * consensus fixture. Decision time is the current (fake) clock, so call it after a session opens.
 */
export async function eligiblePaperDecision(instrument: ReturnType<typeof seedInstrument>): Promise<DecisionReport> {
  const { inst, last } = instrument;
  const candidate: Candidate = {
    id: `paper-flow-${inst.symbol}`, traceId: `paper-flow-trace-${inst.symbol}`, eventId: `paper-flow-event-${inst.symbol}`,
    instrumentId: inst.id, symbol: inst.symbol, base: inst.base, market: 'crypto', venue: 'binance',
    strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h', regime: 'TREND_UP', createdAt: Date.now(),
    signal: {
      direction: 'long', entryRef: last, stop: last * 0.95, targets: [{ r: 2, fraction: 1 }],
      maxHoldBars: 48, trailAfterR: 1, trigger: 'fixture entry', invalidation: 'stop hit', reasons: ['fixture signal'],
    },
  };
  const context = buildContext(candidate);
  const observed = await runConsensus(context);
  const report = decide(candidate, context, {
    ...observed,
    state: 'STRONG_CONSENSUS',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    weighted_opposition: 0,
    domains: observed.domains.map(domain => ({ ...domain, score: 1, support: 1, oppose: 0, abstain: 0 })),
  }, { trades: 100, expectancyR: 0.2 }, 0);
  expect(report).toMatchObject({ decision: 'PAPER_TRADE', risk: { decision: 'ALLOW' } });
  return report;
}
