/**
 * Offline historical session simulation (research only; never touches the database, orders or the paper account).
 *   npm run simulate -- --strategy trend_pullback --candles eth-1h.json --tape eth-books.ndjson.gz --symbol ETHUSDT \
 *     --cash 10000 --capital 5000 [--max-loss 200] [--venue BINANCE_SPOT] [--latency-ms 1000] [--max-wait-ms 5000]
 *     [--slippage-bps 5] [--from <ms>] [--to <ms>] [--policy policy.json] [--step-size 0.0001] [--out report.json]
 * --candles: JSON array of closed candles ({ t, o, h, l, c, v, closeTime? }) for the strategy interval.
 * --tape: gzip NDJSON book/funding/launch events read by lab/tape-reader.ts.
 * --capital: authorized capital, as in the session's trading mandate. --max-loss: proposed mandate extension (optional).
 * --policy: optional risk policy JSON (defaults to the built-in default policy, not the owner's accepted one).
 * Relative paths resolve from the server/ directory; pass absolute paths when running from the repository root.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { RiskPolicy } from '../risk/policy.js';
import { simulateSession } from './sessionSimulation.js';
import { strategyById } from './strategies.js';
import { streamCompressedMarketTape, type HistoricalVenue } from './tape-reader.js';

const CANDLES = z.array(z.object({
  t: z.number().int(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number(),
  qv: z.number().optional(), n: z.number().optional(), tbv: z.number().optional(), closeTime: z.number().int().optional(),
}).strict()).max(1_000_000);

const { values } = parseArgs({
  options: {
    strategy: { type: 'string' }, candles: { type: 'string' }, tape: { type: 'string' }, symbol: { type: 'string' },
    venue: { type: 'string', default: 'BINANCE_SPOT' }, cash: { type: 'string' }, capital: { type: 'string' },
    'max-loss': { type: 'string' }, 'latency-ms': { type: 'string', default: '1000' }, 'max-wait-ms': { type: 'string', default: '5000' },
    'slippage-bps': { type: 'string', default: '5' }, from: { type: 'string' }, to: { type: 'string' },
    policy: { type: 'string' }, 'step-size': { type: 'string' }, out: { type: 'string' },
  },
  strict: true,
});
const num = (name: string, value: string | undefined) => {
  const n = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
};
const required = (name: keyof typeof values) => {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
};

try {
  const strategy = strategyById(required('strategy'));
  if (!strategy) throw new Error('unknown --strategy');
  const candles = CANDLES.parse(JSON.parse(readFileSync(required('candles'), 'utf8')));
  const policy = values.policy ? RiskPolicy.parse(JSON.parse(readFileSync(values.policy, 'utf8'))) : undefined;
  const venue = values.venue as HistoricalVenue;
  const report = await simulateSession(strategy, candles, streamCompressedMarketTape(required('tape'), {
    startTsMs: values.from === undefined ? undefined : num('from', values.from),
    endTsMs: values.to === undefined ? undefined : num('to', values.to),
  }), {
    venue, symbol: required('symbol'), startingCashUsd: num('cash', values.cash), policy,
    capitalCeilingUsd: num('capital', values.capital),
    maxSessionLossUsd: values['max-loss'] === undefined ? undefined : num('max-loss', values['max-loss']),
    latencyMs: num('latency-ms', values['latency-ms']), maxWaitMs: num('max-wait-ms', values['max-wait-ms']),
    slippageBps: num('slippage-bps', values['slippage-bps']),
    stepSize: values['step-size'] === undefined ? undefined : num('step-size', values['step-size']),
  });
  const s = report.tradeStats;
  console.log(`${report.strategyId} ${report.strategyVersion} · ${report.venue} ${report.symbol} · ${report.booksUsed} books, ${report.candlesUsed} candles`);
  console.log(`Equity ${report.startingEquityUsd.toFixed(2)} → ${report.endingEquityUsd.toFixed(2)} (net ${report.netPnlUsd.toFixed(2)}), max drawdown ${report.maxDrawdownUsd.toFixed(2)} (${report.maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Signals ${report.signals}, entries ${report.entries}, closed trades ${s.trades}, win rate ${(s.winRate * 100).toFixed(1)}%, expectancy ${s.expectancyR.toFixed(3)}R`);
  if (Object.keys(report.rejections).length) console.log(`Rejections: ${Object.entries(report.rejections).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (report.lossLimit) console.log(`Session loss limit reached at ${new Date(report.lossLimit.reachedAt).toISOString()}`);
  for (const warning of report.warnings) console.log(`! ${warning}`);
  console.log(`Determinism hash ${report.determinismHash}`);
  if (values.out) { writeFileSync(values.out, JSON.stringify(report, null, 2)); console.log(`Report written to ${values.out}`); }
} catch (e: any) {
  console.error(`✖ ${e?.message ?? e}`);
  process.exitCode = 1;
}
