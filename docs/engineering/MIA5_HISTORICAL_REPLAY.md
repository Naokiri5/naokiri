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

## Independent archive reproduction across three markets

The later BTC-only sample above and this earlier replay both support holding strategy promotion. The earlier sample includes three Binance spot markets, an exact archive check, an out-of-sample price mutation, and the existing Academy walk-forward path. Eight of nine strategy/market cases lost money in the fixed holdout after modeled costs. The ninth, BTCUSDT Donchian breakout, returned +0.072R from nine trades and fell to -1.325R when all cost assumptions doubled. All nine stressed cases lost money.

### Inputs and provenance

- Verified 18 monthly ZIPs for BTCUSDT, ETHUSDT, and SOLUSDT against Binance's published SHA-256 files. Parsed values matched all 13,104 cached rows. Each symbol has 4,368 contiguous closed one-hour candles from January 1 through June 30, 2024 UTC. The fixed chronological holdout starts April 1, 2024 at 00:00 UTC.
- The replay used MIA commits `a39ddaa597172619d8c897e49464910ebad6681f` and `e2d07d346ffa5da6474d7bd73b2dad982ba7f9e3`, Node v26.13.1, all three version `1.0.0` strategy defaults, and backtest fill model 2. The mode-lock candidate reproduced all reported figures. The base scenario charges 10 bps commission per side, 3 bps slippage, and 2 bps total spread. The stress scenario uses 20, 6, and 4 bps, respectively. The strategy parameters stayed fixed across runs.
- The exact cached candle JSON has SHA-256 `7ecee797170ee9d3691a2fd5e661fb382bfaa262b18a21a5a3368ef1c41ad428`. The cached archive manifest has SHA-256 `d42d32ec1bb2d4d9fa9265ad0931dfbbe793e3cd546c9e475e112f2d8c41a39d`. Binance can revise archive content, so validate both the published checksum and the pinned value below before reusing an archive. [Binance public kline and checksum documentation](https://github.com/binance/binance-public-data#checksum)

<details>
<summary>Pinned archive checksums</summary>

| Monthly ZIP | Closed rows | SHA-256 |
| --- | ---: | --- |
| [BTCUSDT-1h-2024-01.zip](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-01.zip.CHECKSUM) | 744 | `cf873a185bd5b24b8e00034e49583fcb49928e0c3a45c6fc27a632a683655417` |
| [BTCUSDT-1h-2024-02.zip](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-02.zip.CHECKSUM) | 696 | `b83aa7319ef1d4baa7b923c0fe802b88dfaf241c7456af295f1f656a24379b33` |
| [BTCUSDT-1h-2024-03.zip](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-03.zip.CHECKSUM) | 744 | `b0851daf609d6ab82fdf8f1d1c4fbd974bc1b4e6530a832067516ac1c2be63a6` |
| [BTCUSDT-1h-2024-04.zip](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-04.zip.CHECKSUM) | 720 | `e266707ad2ea3cd4680bf1ac5025f0c1bfeb38e703374a91f8dc193d1ec8d48f` |
| [BTCUSDT-1h-2024-05.zip](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-05.zip.CHECKSUM) | 744 | `077c71eec71a8ecf2edb6e3a3927b600b8f358fd37066ce120c19fb5302a9ab8` |
| [BTCUSDT-1h-2024-06.zip](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-06.zip.CHECKSUM) | 720 | `2e1f968fa34b9feabfb19cc6eec47a146e20d64a706f4b17d0babf4d2f475c39` |
| [ETHUSDT-1h-2024-01.zip](https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/1h/ETHUSDT-1h-2024-01.zip.CHECKSUM) | 744 | `1fdb3a8fa6b77ef30ef17ed4b71b184172ef1f812d83bd0f50bbd08e71a92057` |
| [ETHUSDT-1h-2024-02.zip](https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/1h/ETHUSDT-1h-2024-02.zip.CHECKSUM) | 696 | `f080ff288b2f7e85e78c5370a8a3258b93f85531ff96b4131c1b7889649a8ba4` |
| [ETHUSDT-1h-2024-03.zip](https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/1h/ETHUSDT-1h-2024-03.zip.CHECKSUM) | 744 | `4eb16ab0c5db15e5e0d77827f5c19c215c7ce601a5501d9563b75bda7602f46e` |
| [ETHUSDT-1h-2024-04.zip](https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/1h/ETHUSDT-1h-2024-04.zip.CHECKSUM) | 720 | `8b710fad720ae0bc75eaded37b3add95ca49122ae398f3f6e33e57e864da781e` |
| [ETHUSDT-1h-2024-05.zip](https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/1h/ETHUSDT-1h-2024-05.zip.CHECKSUM) | 744 | `0307d64f0d9ae6ff4001442a014d7b02dcbc5a003dcc36ba139f1c9695996b51` |
| [ETHUSDT-1h-2024-06.zip](https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/1h/ETHUSDT-1h-2024-06.zip.CHECKSUM) | 720 | `59ee6920bd72d93d1130c89711c93ea192bbfd5f82b548dcb0448f66450f6a06` |
| [SOLUSDT-1h-2024-01.zip](https://data.binance.vision/data/spot/monthly/klines/SOLUSDT/1h/SOLUSDT-1h-2024-01.zip.CHECKSUM) | 744 | `f2a90d8c6ed9f666b95e85e048ac4f6ba424c7fe143a982f671ad0b7f0c8cbdc` |
| [SOLUSDT-1h-2024-02.zip](https://data.binance.vision/data/spot/monthly/klines/SOLUSDT/1h/SOLUSDT-1h-2024-02.zip.CHECKSUM) | 696 | `fd194ff79e56690fa5bb463b6c280f5c521fb39087c6f4d5fa9c683eb92ca0d8` |
| [SOLUSDT-1h-2024-03.zip](https://data.binance.vision/data/spot/monthly/klines/SOLUSDT/1h/SOLUSDT-1h-2024-03.zip.CHECKSUM) | 744 | `b24ea98ce4ffebb0bc831acd1de8558f49c371ff4774fa31667daa11ffc0dd6c` |
| [SOLUSDT-1h-2024-04.zip](https://data.binance.vision/data/spot/monthly/klines/SOLUSDT/1h/SOLUSDT-1h-2024-04.zip.CHECKSUM) | 720 | `ab98165d2c785e871a4614bcb853edbd49b0701a2b3fed1f9d0bf602d128a4fc` |
| [SOLUSDT-1h-2024-05.zip](https://data.binance.vision/data/spot/monthly/klines/SOLUSDT/1h/SOLUSDT-1h-2024-05.zip.CHECKSUM) | 744 | `effcd422f7171f6b8fdaec8b8a7bdf9f354e772503569ca648f5a106f82871d9` |
| [SOLUSDT-1h-2024-06.zip](https://data.binance.vision/data/spot/monthly/klines/SOLUSDT/1h/SOLUSDT-1h-2024-06.zip.CHECKSUM) | 720 | `578fd34d382d7663934a9556c3316a28ac504cffa9a53434b2909f241271898f` |

</details>

### Fixed holdout after costs

R denotes one unit of planned trade risk. Trade counts are individual strategy/market observations and do not form a joint portfolio return. One SOLUSDT breakout position remained open at the final candle, so the closed-trade metrics exclude its unrealized result and entry costs.

| Market | Strategy | Trades | Win rate | Profit factor | Expectancy R | Net R | Max drawdown R | Double-cost net R | Entry regimes and counts |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| BTCUSDT | `trend_pullback` | 18 | 22.22% | 0.374 | -0.541 | -9.731 | 11.345 | -12.838 | TREND_UP 18 |
| BTCUSDT | `donchian_breakout` | 9 | 33.33% | 1.012 | +0.008 | +0.072 | 3.577 | -1.325 | TREND_UP 5, RANGE 4 |
| BTCUSDT | `range_reversion` | 8 | 37.50% | 0.635 | -0.299 | -2.392 | 3.058 | -4.638 | RANGE 8 |
| ETHUSDT | `trend_pullback` | 15 | 33.33% | 0.481 | -0.325 | -4.869 | 5.922 | -7.487 | TREND_UP 15 |
| ETHUSDT | `donchian_breakout` | 9 | 33.33% | 0.303 | -0.482 | -4.340 | 4.474 | -5.414 | TREND_UP 5, RANGE 3, COMPRESSION 1 |
| ETHUSDT | `range_reversion` | 2 | 0.00% | 0.000 | -1.340 | -2.680 | 2.680 | -3.284 | RANGE 2 |
| SOLUSDT | `trend_pullback` | 15 | 26.67% | 0.629 | -0.250 | -3.744 | 5.637 | -5.148 | TREND_UP 15 |
| SOLUSDT | `donchian_breakout` | 7 | 42.86% | 0.974 | -0.016 | -0.114 | 3.199 | -0.680 | RANGE 4, TREND_UP 3 |
| SOLUSDT | `range_reversion` | 5 | 20.00% | 0.292 | -0.668 | -3.339 | 3.582 | -4.098 | RANGE 5 |

Doubling every holdout candle's OHLC prices left all 139 completed pre-holdout trades identical across the nine runs. This tests future-price isolation for this sample. For BTCUSDT breakout, 2,000 independent-trade bootstrap runs at 0.5% modeled risk per trade and 100 trades per run yielded a 5th-percentile return of -10.81%, a median return of +0.22%, and a 95th-percentile maximum drawdown of 13.58%. The bootstrap assumes independent trades, so clustering can change those outcomes.

### Academy walk-forward

Ran `runExperiment` in an offline, in-memory SQLite database using `storeCandles`, model 2, and seed 42. Each market/strategy had one warm-up window, five evaluation windows, a 24-bar embargo at evaluation boundaries, and a purge of boundary-crossing trades. These windows reuse the same 2024 dataset. All nine persisted records reported `VERIFIED` integrity and `STORE_ONLY` data origin. Three verdicts were `NOT_SUPPORTED`, and six were `INSUFFICIENT_EVIDENCE`.

Net return and drawdown use the Academy's simulated 0.5% fractional risk per trade. Exposure estimates the fraction of bars held. Sharpe and Sortino are the Academy's annualized trade-based estimates. Confidence intervals use its 1,000-resample independent-trade bootstrap. Turnover counts trades per year. Small cohorts make the annualized and bootstrap estimates unstable.

| Market | Strategy | Trades | Net return | Max drawdown | Sharpe / Sortino | Expectancy R and 95% interval | Exposure | Turnover | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| BTCUSDT | `trend_pullback` | 33 | -4.78% | 6.14% | -2.253 / -2.996 | -0.293 [-0.665, 0.116] | 20.49% | 79.5 | `NOT_SUPPORTED` |
| BTCUSDT | `donchian_breakout` | 21 | -0.35% | 3.46% | -0.124 / -0.216 | -0.027 [-0.674, 0.611] | 17.28% | 50.6 | `INSUFFICIENT_EVIDENCE` |
| BTCUSDT | `range_reversion` | 12 | -0.95% | 1.79% | -0.603 / -0.832 | -0.154 [-0.886, 0.624] | 2.12% | 28.9 | `INSUFFICIENT_EVIDENCE` |
| ETHUSDT | `trend_pullback` | 37 | -1.44% | 5.30% | -0.619 / -0.956 | -0.075 [-0.415, 0.283] | 16.13% | 89.1 | `NOT_SUPPORTED` |
| ETHUSDT | `donchian_breakout` | 23 | 1.25% | 3.08% | 0.580 / 1.072 | +0.114 [-0.463, 0.774] | 22.39% | 55.4 | `INSUFFICIENT_EVIDENCE` |
| ETHUSDT | `range_reversion` | 3 | -1.88% | 1.88% | -28.165 / -2.676 | -1.263 [-1.403, -1.109] | 0.77% | 7.2 | `INSUFFICIENT_EVIDENCE` |
| SOLUSDT | `trend_pullback` | 38 | -0.98% | 2.99% | -0.398 / -0.632 | -0.048 [-0.415, 0.345] | 18.54% | 91.5 | `NOT_SUPPORTED` |
| SOLUSDT | `donchian_breakout` | 19 | -1.80% | 3.30% | -0.920 / -1.425 | -0.187 [-0.745, 0.490] | 17.80% | 45.8 | `INSUFFICIENT_EVIDENCE` |
| SOLUSDT | `range_reversion` | 6 | -0.96% | 1.78% | -0.985 / -1.248 | -0.316 [-1.192, 0.566] | 1.48% | 14.4 | `INSUFFICIENT_EVIDENCE` |

The OHLCV dataset hashes recorded by Academy were BTCUSDT `927b073219f7e7e909a83da7951f6081ecc37435b02bf6b4e4208f4087019842`, ETHUSDT `0402a808ac37e135da308270ac2933b30e720aa8ac90d3bc8c29f54d68b281fe`, and SOLUSDT `faac6fa6e494957ef27a9efccc089ae592b842519431950fa06c2f426efa64b1`.

The replay tests point-in-time calculations and cost sensitivity on three currently listed spot pairs. It leaves order-book queue priority, liquidity outages, observed fees and slippage, delisted markets, independent prospective paper supervision, and real-money execution unverified. Separate actual fee and slippage totals are absent from this fill model. [Canonical backtester](../../server/src/lab/backtest.ts) · [Academy walk-forward and metrics](../../server/src/knowledge/research.ts)

### Repeat the archive check

Build a JSON object keyed by exchange symbol from the pinned ZIPs above. Order rows by opening timestamp and map Binance's documented CSV fields to `t`, `o`, `h`, `l`, `c`, `v`, `closeTime`, `qv`, `n`, and `tbv`. Verify that each candle closes exactly 3,599,999 milliseconds after its opening time and that each symbol has every hourly bar in the stated date range.

From the repository root with dependencies installed, set `MIA_REPLAY_CANDLES` to the JSON file path and run the following module from standard input with `node --import tsx --input-type=module`.

```js
process.env.MIA_OFFLINE = '1';
delete process.env.MIA_DATA_DIR;
const assert = (await import('node:assert/strict')).default;
const { readFileSync } = await import('node:fs');
const { backtest, monteCarlo } = await import('./server/src/lab/backtest.ts');
const { STRATEGIES } = await import('./server/src/lab/strategies.ts');
const { openDb, closeDb } = await import('./server/src/db/db.ts');
const { runExperiment, storeCandles } = await import('./server/src/knowledge/research.ts');
const histories = JSON.parse(readFileSync(process.env.MIA_REPLAY_CANDLES, 'utf8'));
const split = Date.parse('2024-04-01T00:00:00Z');
const baseCosts = { feeRate: 0.001, slippageBps: 3, spreadBps: 2 };
const stressCosts = { feeRate: 0.002, slippageBps: 6, spreadBps: 4 };

openDb(':memory:');
try {
  for (const [symbol, candles] of Object.entries(histories)) {
    assert.equal(candles.length, 4368);
    assert.equal(candles[2184].t, split);
    const edited = candles.map(bar => bar.t < split ? bar : {
      ...bar, o: bar.o * 2, h: bar.h * 2, l: bar.l * 2, c: bar.c * 2,
    });
    storeCandles(symbol, '1h', candles);
    for (const strategy of STRATEGIES) {
      const instrument = `crypto:binance:${symbol}`;
      const baseline = backtest(strategy, instrument, candles, baseCosts, 0.5);
      const stressed = backtest(strategy, instrument, candles, stressCosts, 0.5);
      const mutated = backtest(strategy, instrument, edited, baseCosts, 0.5);
      const prefix = result => result.trades.filter(trade => trade.exitT < split);
      assert.deepEqual(prefix(baseline), prefix(mutated));
      const bootstrap = monteCarlo(baseline.trades.filter(t => t.segment === 'OOS').map(t => t.r), {
        seed: 42, runs: 2000, tradesPerRun: 100, riskPct: 0.5,
      });
      const experiment = await runExperiment('owner', {
        kind: 'strategy_walkforward', symbol, interval: '1h', bars: candles.length,
        strategyId: strategy.id, seed: 42,
      });
      assert.equal(experiment.integrity, 'VERIFIED');
      assert.equal(experiment.dataset.origin, 'STORE_ONLY');
      assert.equal(experiment.results.backtestModelVersion, 2);
      assert.equal(experiment.results.windows.length, 6);
      console.log(JSON.stringify({
        symbol, strategy: strategy.id, outOfSample: baseline.outOfSample,
        doubleCosts: stressed.outOfSample, prefixTrades: prefix(baseline).length,
        bootstrap, datasetHash: experiment.data_hash, verdict: experiment.verdict,
        walkForward: experiment.results,
      }));
    }
  }
} finally {
  closeDb();
}
```
