# MIA 5.0 historical replay evidence

The three built-in strategies each lost money in risk-normalized units after modeled costs on the same out-of-sample BTCUSDT window. These observations support holding strategy promotion for this sample.

## Dataset and replay

- 8,000 closed 1-hour Binance spot BTCUSDT candles from `fetchHistory`, first open 2025-12-24T12:00:00+00:00, last open 2026-11-22T19:00:00+00:00, cutoff 2026-11-22T20:46:23+00:00.
- SHA-256 of the JSON candle array `24a6d0a3cc9785abfd5c5849a168ac9c1f16330247e82071eedbc6ab33bedd7e`.
- The existing `backtest` used incremental features, next-bar open entries, conservative intrabar ordering, fixed strategy defaults, and a chronological 60/40 split at 2026-07-12T12:00:00+00:00.
- Execution assumptions were 10 bps commission per side, 3 bps modeled slippage, and 2 bps spread. The second scenario doubles all three assumptions. The built-in model reports results in R multiples and does not expose a separate commission or gross PnL ledger.
- Over the same out-of-sample window, a BTCUSDT position held from the first open to the last close returned −5.12% before fees. Cash returned 0%. The strategy R multiple and buy-and-hold percentage use different denominators.

| Strategy | In-sample trades / net R | OOS trades | OOS net R | Expectancy (R) | Profit factor | Max drawdown (R) | Double-cost net R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `trend_pullback` | 37 / 0.58 | 30 | -11.93 | -0.398 | 0.400 | 11.93 | -18.79 |
| `donchian_breakout` | 26 / -11.09 | 19 | -3.18 | -0.168 | 0.762 | 5.48 | -7.91 |
| `range_reversion` | 15 / -7.94 | 12 | -5.71 | -0.475 | 0.461 | 7.85 | -12.05 |

## Robustness checks

Three 3,000-bar slices start at zero-based indices 0, 2,500 and 5,000. Each uses the built-in chronological split with fixed parameters. The out-of-sample periods are disjoint. Bootstrap uses 1,000 independent-trade resamples of 100 trades at 0.5% risk per trade. Percentiles describe those resamples. Serial dependence and small samples limit the estimates.

| Strategy | OOS windows (trade count / net R) | Bootstrap return p5 / median / p95 | Runs with at least 20% drawdown |
| --- | --- | ---: | ---: |
| `trend_pullback` | 14 / -1.87, 14 / -5.60, 3 / -1.22 | -24.8% / -18.3% / -10.9% | 40.3% |
| `donchian_breakout` | 13 / -4.81, 6 / -5.95, 2 / -2.41 | -18.5% / -8.1% / 3.8% | 4.9% |
| `range_reversion` | 4 / -4.96, 4 / 1.11, 7 / -4.45 | -28.9% / -21.3% / -12.4% | 69.6% |

## Out-of-sample regimes

| Strategy | Regime | Trades | Net R |
| --- | --- | ---: | ---: |
| `trend_pullback` | TREND_UP | 30 | -11.93 |
| `donchian_breakout` | COMPRESSION | 3 | -3.95 |
| `donchian_breakout` | RANGE | 8 | -3.92 |
| `donchian_breakout` | TREND_UP | 8 | 4.68 |
| `range_reversion` | RANGE | 12 | -5.71 |

## Certification limits

One currently listed instrument cannot establish cross-market generalization or remove survivorship bias. Separate gross returns, model-independent confidence intervals, order-level impact, latency and parameter sensitivity, risk of ruin, and prospective strategy performance remain unverified. The observed 20% drawdown frequency is a bootstrap statistic. Strategy release still requires a representative universe, valid research costs, a predefined acceptance rule and prospective paper evidence.

## Reproduction

From the repository root, run the following with dependencies installed. Use Node with environment proxy support if required. Provider corrections to old candles can change the captured digest.

```js
import './server/src/providers/binance.ts';
import { createHash } from 'node:crypto';
import { fetchHistory } from './server/src/lab/lab.ts';
import { backtest, stats, monteCarlo } from './server/src/lab/backtest.ts';
import { strategyById } from './server/src/lab/strategies.ts';
const cutoff = 1795380383344;
const history = await fetchHistory('BTCUSDT', '1h', 8000, cutoff);
console.log(JSON.stringify({ cutoff, bars:history.length, first:history[0]?.t, last:history.at(-1)?.t, sha256:createHash('sha256').update(JSON.stringify(history)).digest('hex') }));
for(const id of ['trend_pullback','donchian_breakout','range_reversion']) {
  const strategy = strategyById(id);
  if (strategy.interval !== '1h') throw new Error('unexpected interval');
  const result = backtest(strategy,'crypto:binance:BTCUSDT',history);
  const oos = result.trades.filter(t => t.segment === 'OOS');
  const costs = {...result.costs, feeRate:result.costs.feeRate*2, slippageBps:result.costs.slippageBps*2, spreadBps:result.costs.spreadBps*2};
  const slices = [0,2500,5000].map(start => backtest(strategy,result.instrument,history.slice(start,start+3000)).outOfSample);
  const baseline = history.at(-1).c / history.find(c => c.t >= result.splitAt).o - 1;
  const regimes = Object.fromEntries([...new Set(oos.map(t => t.regime))].map(regime => [regime, stats(oos.filter(t => t.regime === regime))]));
  console.log(JSON.stringify({ id, splitAt:result.splitAt, costs:result.costs, warnings:result.warnings, inSample:result.inSample, outOfSample:result.outOfSample, overall:result.all, doubledCosts:backtest(strategy,result.instrument,history,costs).outOfSample, slices, baseline, regimes, monteCarlo:monteCarlo(oos.map(t => t.r),{ runs:1000 }) }));
}
```
