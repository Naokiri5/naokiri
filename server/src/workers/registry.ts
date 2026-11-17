import type { WorkerDef, WorkerContext, WorkerResult, Domain, WorkerCapability } from './types.js';
import type { FeatureSnapshot } from '../features/indicators.js';
import { isNum } from '../features/indicators.js';
import type { Interval } from '../market/types.js';

/**
 * The 100 cooperative market workers (Part 3), organized into 11 evidence domains.
 * Each is a deterministic, versioned evaluator — role ≠ process: they run in the bounded pool (runtime.ts).
 */
const ABSTAIN = (why: string): WorkerResult => ({ stance: 'ABSTAIN', features: {}, reasons: [why] });
const vote = (cond: boolean | null, features: WorkerResult['features'], yes: string, no: string): WorkerResult =>
  cond == null ? ABSTAIN('input unavailable') : { stance: cond ? 'SUPPORT' : 'OPPOSE', features, reasons: [cond ? yes : no] };
const tri = (x: number | null, supportIf: (v: number) => boolean, opposeIf: (v: number) => boolean, name: string, fmtv = (v: number) => v.toFixed(3)): WorkerResult => {
  if (x == null || !Number.isFinite(x)) return ABSTAIN(`${name} unavailable`);
  if (supportIf(x)) return { stance: 'SUPPORT', features: { [name]: x }, reasons: [`${name}=${fmtv(x)} supportive`] };
  if (opposeIf(x)) return { stance: 'OPPOSE', features: { [name]: x }, reasons: [`${name}=${fmtv(x)} adverse`] };
  return { stance: 'ABSTAIN', features: { [name]: x }, reasons: [`${name}=${fmtv(x)} inconclusive`] };
};
const F = (ctx: WorkerContext, iv: Interval): FeatureSnapshot | null => ctx.f[iv] ?? null;
const ok = (f: FeatureSnapshot | null, ...k: (keyof FeatureSnapshot)[]) => !!f && k.every((x) => isNum(f[x]));

const W: WorkerDef[] = [];
let seq: Record<string, number> = {};
const PREFIX: Record<Domain, string> = { trend: 'TRD', momentum: 'MOM', volatility: 'VOL', flow: 'FLW', liquidity: 'LIQ', structure: 'STR', regime: 'REG', news: 'NWS', onchain: 'ONC', risk: 'RSK', execution: 'EXE' };
const BLOCKED_SOURCES = ['evm_rpc', 'x_api', 'pending'];
function add(domain: Domain, name: string, dependencyGroup: string, sourceIds: string[], evaluate: WorkerDef['evaluate'], o: { mandatory?: boolean; canVeto?: boolean; constant?: boolean; version?: string } = {}) {
  seq[domain] = (seq[domain] ?? 0) + 1;
  const capability: WorkerCapability = sourceIds.some((x) => BLOCKED_SOURCES.includes(x)) ? 'PROVIDER_BLOCKED' : o.constant ? 'CONSTANT_RULE' : 'DATA_DRIVEN';
  W.push({ id: `W-${PREFIX[domain]}-${String(seq[domain]).padStart(2, '0')}`, name, domain, version: o.version ?? '1.0.0', dependencyGroup, sourceIds, evaluate, capability, mandatory: o.mandatory, canVeto: o.canVeto });
}
const K = (iv: Interval) => [`binance.klines.${iv}`];

// ── TREND (12) ───────────────────────────────────────────────
for (const iv of ['15m', '1h', '4h'] as Interval[]) {
  add('trend', `EMA stack ${iv}`, `ema.${iv}`, K(iv), (c) => { const f = F(c, iv); return ok(f, 'ema20', 'ema50') ? vote(f!.ema20 > f!.ema50 && f!.close > f!.ema20 * 0.995, { ema20: f!.ema20, ema50: f!.ema50 }, `EMA20>EMA50 on ${iv}`, `EMA stack bearish on ${iv}`) : ABSTAIN('warming up'); });
  add('trend', `Price vs EMA200 ${iv}`, `ema200.${iv}`, K(iv), (c) => { const f = F(c, iv); return ok(f, 'ema200') ? vote(f!.close > f!.ema200, { close: f!.close, ema200: f!.ema200 }, `above EMA200 ${iv}`, `below EMA200 ${iv}`) : ABSTAIN('EMA200 warming up'); });
}
for (const iv of ['1h', '4h'] as Interval[]) {
  add('trend', `ADX trend strength ${iv}`, `dmi.${iv}`, K(iv), (c) => { const f = F(c, iv); if (!ok(f, 'adx14', 'plusDI', 'minusDI')) return ABSTAIN('ADX unavailable'); if (f!.adx14 < 18) return { stance: 'ABSTAIN', features: { adx: f!.adx14 }, reasons: ['no trend (ADX<18)'] }; return vote(f!.plusDI > f!.minusDI, { adx: f!.adx14, pdi: f!.plusDI, mdi: f!.minusDI }, '+DI dominant', '-DI dominant'); });
  add('trend', `MACD trend ${iv}`, `macd.${iv}`, K(iv), (c) => { const f = F(c, iv); return ok(f, 'macd', 'macdSignal') ? vote(f!.macd > f!.macdSignal && f!.macd > 0 || f!.macd > f!.macdSignal, { macd: f!.macd, signal: f!.macdSignal }, 'MACD above signal', 'MACD below signal') : ABSTAIN('MACD warming up'); });
}
add('trend', 'EMA50 slope 1h', 'ema.1h', K('1h'), (c) => tri(F(c, '1h')?.ema50Slope10 ?? null, (v) => v > 0.002, (v) => v < -0.002, 'ema50Slope10', (v) => `${(v * 100).toFixed(2)}%`));
add('trend', 'EMA20 slope 4h', 'ema.4h', K('4h'), (c) => tri(F(c, '4h')?.ema20Slope5 ?? null, (v) => v > 0.003, (v) => v < -0.003, 'ema20Slope5', (v) => `${(v * 100).toFixed(2)}%`));
// ── MOMENTUM (10) ─────────────────────────────────────────────
for (const iv of ['15m', '1h', '4h'] as Interval[]) add('momentum', `RSI regime ${iv}`, `rsi.${iv}`, K(iv), (c) => tri(F(c, iv)?.rsi14 ?? null, (v) => v >= 45 && v <= 70, (v) => v < 35 || v > 80, 'rsi14', (v) => v.toFixed(1)));
add('momentum', 'ROC10 1h', `roc.1h`, K('1h'), (c) => tri(F(c, '1h')?.roc10 ?? null, (v) => v > 0, (v) => v < -0.03, 'roc10'));
add('momentum', 'MACD histogram 1h', `macd.1h`, K('1h'), (c) => tri(F(c, '1h')?.macdHist ?? null, (v) => v > 0, (v) => v < 0, 'macdHist', (v) => v.toPrecision(3)));
add('momentum', 'Stochastic 1h', `stoch.1h`, K('1h'), (c) => tri(F(c, '1h')?.stochK14 ?? null, (v) => v > 20 && v < 85, (v) => v >= 95, 'stochK14', (v) => v.toFixed(1)));
add('momentum', 'CCI 1h', `cci.1h`, K('1h'), (c) => tri(F(c, '1h')?.cci20 ?? null, (v) => v > -100 && v < 200, (v) => v >= 250 || v < -200, 'cci20', (v) => v.toFixed(0)));
add('momentum', 'Williams %R 4h', `stoch.4h`, K('4h'), (c) => tri(F(c, '4h')?.williamsR14 ?? null, (v) => v > -80 && v < -5, (v) => v >= -2, 'williamsR14', (v) => v.toFixed(1)));
add('momentum', 'ROC10 4h', `roc.4h`, K('4h'), (c) => tri(F(c, '4h')?.roc10 ?? null, (v) => v > 0, (v) => v < -0.05, 'roc10'));
add('momentum', '5-bar return 15m', `ret.15m`, K('15m'), (c) => tri(F(c, '15m')?.ret5 ?? null, (v) => v > -0.01, (v) => v < -0.025, 'ret5'));
// ── VOLATILITY (8) ────────────────────────────────────────────
for (const iv of ['1h', '4h'] as Interval[]) add('volatility', `ATR% suitability ${iv}`, `atr.${iv}`, K(iv), (c) => tri(F(c, iv)?.atrPct ?? null, (v) => v >= 0.003 && v <= (iv === '1h' ? 0.03 : 0.06), (v) => v > (iv === '1h' ? 0.05 : 0.1), 'atrPct', (v) => `${(v * 100).toFixed(2)}%`));
add('volatility', 'Realized vol 1h', `rv.1h`, K('1h'), (c) => tri(F(c, '1h')?.realizedVol20 ?? null, (v) => v < 0.02, (v) => v > 0.04, 'realizedVol20'));
add('volatility', 'BB width percentile 1h', `bb.1h`, K('1h'), (c) => tri(F(c, '1h')?.bbWidthPctile100 ?? null, (v) => v < 0.85, (v) => v >= 0.97, 'bbWidthPctile'));
add('volatility', 'BB width percentile 4h', `bb.4h`, K('4h'), (c) => tri(F(c, '4h')?.bbWidthPctile100 ?? null, (v) => v < 0.85, (v) => v >= 0.97, 'bbWidthPctile'));
add('volatility', 'Stop distance vs ATR', `atr.1h`, K('1h'), (c) => { const f = F(c, '1h'); if (!ok(f, 'atr14')) return ABSTAIN('ATR unavailable'); const k = (c.candidate.signal.entryRef - c.candidate.signal.stop) / f!.atr14; return tri(k, (v) => v >= 1.2 && v <= 4, (v) => v < 0.8, 'stopInAtr', (v) => v.toFixed(2)); });
add('volatility', '24h range expansion', `ticker.24h`, ['binance.ticker24h'], (c) => c.ticker ? tri((c.ticker.high - c.ticker.low) / c.ticker.last, (v) => v < 0.12, (v) => v > 0.25, 'range24h') : ABSTAIN('no ticker'));
add('volatility', 'Z-score stretch 1h', `bb.1h`, K('1h'), (c) => tri(F(c, '1h')?.zscore20 ?? null, (v) => v > -2.5 && v < 2.2, (v) => v >= 3, 'zscore20', (v) => v.toFixed(2)));
// ── FLOW (10) ─────────────────────────────────────────────────
for (const iv of ['15m', '1h'] as Interval[]) add('flow', `Taker buy ratio ${iv}`, `taker.${iv}`, K(iv), (c) => tri(F(c, iv)?.takerBuyRatio ?? null, (v) => v >= 0.52, (v) => v <= 0.45, 'takerBuyRatio'));
for (const iv of ['1h', '4h'] as Interval[]) add('flow', `OBV slope ${iv}`, `obv.${iv}`, K(iv), (c) => tri(F(c, iv)?.obvSlope10 ?? null, (v) => v > 0.1, (v) => v < -0.1, 'obvSlope10'));
add('flow', 'Relative volume 1h', `vol.1h`, K('1h'), (c) => tri(F(c, '1h')?.relVol20 ?? null, (v) => v >= 1.1, (v) => v < 0.5, 'relVol20', (v) => `${v.toFixed(2)}×`));
add('flow', 'Volume z-score 15m', `vol.15m`, K('15m'), (c) => tri(F(c, '15m')?.volZ20 ?? null, (v) => v > 0.5, (v) => v < -1.2, 'volZ20', (v) => v.toFixed(2)));
add('flow', 'Price vs VWAP20 1h', `vwap.1h`, K('1h'), (c) => { const f = F(c, '1h'); return ok(f, 'vwap20') ? vote(f!.close >= f!.vwap20, { vwap20: f!.vwap20 }, 'price above rolling VWAP', 'price below rolling VWAP') : ABSTAIN('no VWAP'); });
add('flow', 'MFI 1h', `mfi.1h`, K('1h'), (c) => tri(F(c, '1h')?.mfi14 ?? null, (v) => v >= 45 && v <= 80, (v) => v < 25 || v > 90, 'mfi14', (v) => v.toFixed(1)));
add('flow', 'CEX large-print imbalance', `aggtrades`, ['binance.aggTrades'], (c) => { const p = c.prints; if (!p || p.count === 0) return ABSTAIN('no large prints observed'); const r = p.buyNotional / (p.buyNotional + p.sellNotional); return tri(r, (v) => v >= 0.6, (v) => v <= 0.4, 'largePrintBuyShare'); });
add('flow', 'Order-book imbalance ±1%', `book`, ['binance.depth'], (c) => c.impact ? tri(c.impact.bookImbalance, (v) => v >= 0.55, (v) => v <= 0.4, 'bidShareWithin1pct') : ABSTAIN('no book'));
// ── LIQUIDITY (10) ────────────────────────────────────────────
add('liquidity', 'Spread', 'book', ['binance.depth'], (c) => c.impact ? tri(c.impact.spreadBps, (v) => v <= 5, (v) => v > 15, 'spreadBps', (v) => v.toFixed(2)) : ABSTAIN('no book'), { mandatory: true });
add('liquidity', 'Impact at intended size', 'book', ['binance.depth'], (c) => c.impact ? tri(c.impact.filledFully ? c.impact.impactBps : Infinity, (v) => v <= 10, (v) => v > 30, 'impactBps', (v) => v.toFixed(2)) : ABSTAIN('no book'), { mandatory: true, canVeto: true });
add('liquidity', 'Depth within 1%', 'book', ['binance.depth'], (c) => c.impact ? tri(c.impact.depth1pct / Math.max(1, c.intendedNotional), (v) => v >= 50, (v) => v < 10, 'depthToOrderRatio', (v) => v.toFixed(0)) : ABSTAIN('no book'));
add('liquidity', '24h quote volume', 'ticker.24h', ['binance.ticker24h'], (c) => c.ticker ? tri(c.ticker.quoteVolume, (v) => v >= 20e6, (v) => v < 5e6, 'quoteVolume24h', (v) => `$${(v / 1e6).toFixed(1)}M`) : ABSTAIN('no ticker'));
add('liquidity', 'Trade count 24h', 'ticker.24h', ['binance.ticker24h'], (c) => c.ticker ? tri(c.ticker.trades, (v) => v >= 50_000, (v) => v < 10_000, 'trades24h', (v) => v.toFixed(0)) : ABSTAIN('no ticker'));
add('liquidity', 'Order size vs daily volume', 'ticker.24h', ['binance.ticker24h'], (c) => c.ticker ? tri(c.intendedNotional / c.ticker.quoteVolume, (v) => v < 1e-4, (v) => v > 1e-3, 'orderToAdv', (v) => v.toExponential(2)) : ABSTAIN('no ticker'));
add('liquidity', 'Exit liquidity at 2× size', 'book', ['binance.depth'], (c) => c.impact ? tri(c.impact.depth1pct / Math.max(1, 2 * c.intendedNotional), (v) => v >= 20, (v) => v < 5, 'exitDepthRatio', (v) => v.toFixed(0)) : ABSTAIN('no book'));
add('liquidity', 'Cross-venue listing', 'cross', ['coinbase', 'kraken'], (c) => tri(c.quality.independentSources, (v) => v >= 2, () => false, 'independentVenues', (v) => v.toFixed(0)));
add('liquidity', 'Market-cap tier', 'cg', ['coingecko'], (c) => c.safety.checks.find((x) => x.name === 'market-cap reference')?.result === 'PASS' ? { stance: 'SUPPORT', features: {}, reasons: ['listed in top-250 by market cap'] } : ABSTAIN('market cap reference unavailable'));
add('liquidity', 'Volume stability 1h', 'vol.1h', K('1h'), (c) => tri(F(c, '1h')?.relVol20 ?? null, (v) => v >= 0.6 && v <= 4, (v) => v > 8, 'relVol20', (v) => v.toFixed(2)));
// ── STRUCTURE (10) ────────────────────────────────────────────
add('structure', 'Above swing low 1h', 'swing.1h', K('1h'), (c) => { const f = F(c, '1h'); return ok(f, 'swingLow') ? vote(f!.close > f!.swingLow, { swingLow: f!.swingLow }, 'holding above recent swing low', 'broke recent swing low') : ABSTAIN('no swings'); });
add('structure', 'Room to swing high 1h', 'swing.1h', K('1h'), (c) => { const f = F(c, '1h'); if (!ok(f, 'swingHigh', 'atr14')) return ABSTAIN('no swings'); const room = (f!.swingHigh - f!.close) / f!.atr14; return room <= 0 ? { stance: 'SUPPORT', features: { roomAtr: room }, reasons: ['at/above swing high (breakout)'] } : tri(room, (v) => v >= 1.5, (v) => v < 0.5, 'roomToResistanceAtr', (v) => v.toFixed(2)); });
add('structure', 'Donchian position 4h', 'donch.4h', K('4h'), (c) => { const f = F(c, '4h'); if (!ok(f, 'donchHigh20', 'donchLow20')) return ABSTAIN('warming up'); const pos = (f!.close - f!.donchLow20) / (f!.donchHigh20 - f!.donchLow20); return tri(pos, (v) => v >= 0.5, (v) => v < 0.2, 'donchPos4h'); });
add('structure', '55-bar breakout 1h', 'donch.1h', K('1h'), (c) => { const f = F(c, '1h'); return ok(f, 'donchHigh55', 'donchLow55') ? tri((f!.close - f!.donchLow55) / (f!.donchHigh55 - f!.donchLow55), (v) => v >= 0.6, (v) => v <= 0.15, 'donch55Pos') : ABSTAIN('warming up'); });
add('structure', 'Higher low 4h', 'swing.4h', K('4h'), (c) => { const f = F(c, '4h'); return ok(f, 'swingLow', 'donchLow20') ? vote(f!.swingLow > f!.donchLow20, {}, 'recent low above 20-bar low', 'making lower lows') : ABSTAIN('warming up'); });
add('structure', 'Pullback depth', 'swing.1h', K('1h'), (c) => { const f = F(c, '1h'); if (!ok(f, 'swingHigh', 'swingLow')) return ABSTAIN('no swings'); const depth = (f!.swingHigh - f!.close) / (f!.swingHigh - f!.swingLow || 1); return tri(depth, (v) => v <= 0.62, (v) => v > 0.9, 'retracement'); });
add('structure', 'Distance from 24h high', 'ticker.24h', ['binance.ticker24h'], (c) => c.ticker ? tri(1 - c.ticker.last / c.ticker.high, (v) => v < 0.05, (v) => v > 0.15, 'offHigh24h') : ABSTAIN('no ticker'));
add('structure', 'Close vs 15m EMA20', 'ema.15m', K('15m'), (c) => { const f = F(c, '15m'); return ok(f, 'ema20') ? vote(f!.close >= f!.ema20, {}, 'short-term structure intact', 'short-term structure broken') : ABSTAIN('warming up'); });
add('structure', 'Efficiency ratio 1h', 'er.1h', K('1h'), (c) => tri(F(c, '1h')?.efficiencyRatio10 ?? null, (v) => v >= 0.3, (v) => v < 0.1, 'efficiencyRatio10'));
add('structure', 'Reward room to first target', 'swing.4h', K('4h'), (c) => { const f = F(c, '4h'); const s = c.candidate.signal; if (!ok(f, 'donchHigh20')) return ABSTAIN('warming up'); const t1 = s.entryRef + s.targets[0].r * (s.entryRef - s.stop); return vote(f!.donchHigh20 >= t1 || s.entryRef >= f!.donchHigh20 * 0.995, { t1, resistance4h: f!.donchHigh20 }, 'first target below 4h resistance or breaking out', '4h resistance before first target'); });
// ── REGIME / CROSS-MARKET (8) ─────────────────────────────────
add('regime', 'Strategy-regime fit', 'regime', K('1h'), (c) => { const fit = ['trend_pullback', 'donchian_breakout'].includes(c.candidate.strategyId) ? ['TREND_UP', 'COMPRESSION', 'RANGE'].includes(c.candidate.regime) : c.candidate.regime === 'RANGE'; return c.candidate.regime === 'UNKNOWN' ? ABSTAIN('regime unknown') : vote(fit, { regime: c.candidate.regime }, `${c.candidate.regime} suits strategy`, `${c.candidate.regime} unsuitable for strategy`); }, { mandatory: true });
add('regime', 'BTC trend 1h', 'btc.1h', ['binance.klines.1h.BTC'], (c) => ok(c.btc1h, 'ema20', 'ema50') ? vote(c.btc1h!.ema20 > c.btc1h!.ema50, {}, 'BTC 1h uptrend', 'BTC 1h downtrend') : ABSTAIN('BTC data unavailable'));
add('regime', 'BTC trend 4h', 'btc.4h', ['binance.klines.4h.BTC'], (c) => ok(c.btc4h, 'ema20', 'ema50') ? vote(c.btc4h!.ema20 > c.btc4h!.ema50, {}, 'BTC 4h uptrend', 'BTC 4h downtrend') : ABSTAIN('BTC data unavailable'));
add('regime', 'BTC volatility shock', 'btc.1h', ['binance.klines.1h.BTC'], (c) => tri(c.btc1h?.ret1 ?? null, (v) => v > -0.015, (v) => v < -0.03, 'btcRet1h'));
add('regime', 'Correlation to BTC', 'corr', ['binance.klines.1h'], (c) => c.corrToBtc == null ? ABSTAIN('correlation unavailable') : tri(c.corrToBtc, (v) => v < 0.85 || (c.btc1h != null && c.btc1h.ema20 > c.btc1h.ema50), (v) => v >= 0.85 && c.btc1h != null && c.btc1h.ema20 < c.btc1h.ema50, 'corrToBtc'));
add('regime', 'Relative strength vs BTC 1h', 'btc.1h', ['binance.klines.1h.BTC'], (c) => { const f = F(c, '1h'); return ok(f, 'ret20') && ok(c.btc1h, 'ret20') ? tri(f!.ret20 - c.btc1h!.ret20, (v) => v > 0, (v) => v < -0.05, 'rsVsBtc20') : ABSTAIN('unavailable'); });
add('regime', 'Higher-timeframe regime 4h', 'regime.4h', K('4h'), (c) => { const f = F(c, '4h'); return ok(f, 'ema50', 'ema200') ? vote(f!.ema50 > f!.ema200 || c.candidate.strategyId === 'range_reversion', {}, '4h regime constructive', '4h regime bearish') : ABSTAIN('4h warming up'); });
// Breadth over ≥30 liquid pairs from a ticker snapshot no older than 5 minutes; otherwise abstain (never guessed).
add('regime', 'Market breadth', 'breadth', ['binance.ticker24h'], (c) => {
  const b = c.breadth; if (!b || b.universe < 30) return ABSTAIN('breadth unavailable (fewer than 30 liquid pairs)');
  const age = b.asOf == null ? NaN : Date.now() - b.asOf;
  if (!Number.isFinite(age) || age < 0 || age > 300_000) return ABSTAIN('breadth snapshot stale, future-dated or missing');
  return tri(b.advancers / b.universe, (v) => v >= 0.55, (v) => v <= 0.35, 'advancerShare', (v) => `${(v * 100).toFixed(0)}%`);
}, { version: '1.1.0' });
// ── NEWS (8) ──────────────────────────────────────────────────
add('news', 'Asset headline sentiment', 'googlenews', ['googlenews'], (c) => { const n = c.news; if (!n || n.relevant === 0) return ABSTAIN('no recent asset headlines'); return tri(n.positive - n.negative, (v) => v > 0, (v) => v < 0, 'netSentimentCount', (v) => v.toFixed(0)); });
add('news', 'Negative-event screen', 'googlenews', ['googlenews'], (c) => { const n = c.news; if (!n) return ABSTAIN('news feed unavailable'); return n.negative >= 2 ? { stance: 'OPPOSE', features: { negative: n.negative }, reasons: ['multiple negative headlines (hack/exploit/delisting/lawsuit)'] } : { stance: 'ABSTAIN', features: { negative: n.negative }, reasons: ['no material negative headlines'] }; });
add('news', 'Macro event risk', 'googlenews.macro', ['googlenews'], (c) => { const n = c.news; if (!n) return ABSTAIN('news feed unavailable'); return n.highImpactMacro > 0 ? { stance: 'OPPOSE', features: { macro: n.highImpactMacro }, reasons: ['high-impact macro headlines in last 6h'] } : { stance: 'ABSTAIN', features: {}, reasons: ['no high-impact macro headlines'] }; });
for (const name of ['Regulatory screen', 'Exchange incident screen', 'Social sentiment (X)', 'Economic calendar', 'Earnings/fundamentals']) add('news', name, name.includes('X') ? 'x_api' : 'pending', name.includes('X') ? ['x_api'] : ['pending'], () => ABSTAIN('provider pending credentials'));
// ── ONCHAIN (6) — CEX spot candidates: not applicable; DEX requires RPC (pending) ──
for (const name of ['Whale wallet accumulation', 'Exchange inflow/outflow', 'Holder concentration', 'Smart-money wallets', 'Token unlock schedule', 'Contract permission changes']) add('onchain', name, 'evm_rpc', ['evm_rpc'], () => ABSTAIN('on-chain provider pending credentials'));
// ── RISK (10) ─────────────────────────────────────────────────
add('risk', 'Asset safety status', 'safety', ['binance', 'coingecko'], (c) => { const s = c.safety.status; return s === 'REJECTED' || s === 'HIGH_RISK' ? { stance: 'OPPOSE', features: { safety: s }, reasons: c.safety.reasons, veto: true } : s === 'UNVERIFIED' ? { stance: 'OPPOSE', features: { safety: s }, reasons: ['asset unverified'], veto: true } : { stance: 'SUPPORT', features: { safety: s }, reasons: [`safety ${s}`] }; }, { mandatory: true, canVeto: true });
add('risk', 'Data quality gate', 'quality', ['binance', 'coinbase', 'kraken'], (c) => c.quality.status === 'FAIL' ? { stance: 'OPPOSE', features: { quality: 'FAIL' }, reasons: c.quality.issues, veto: true } : { stance: 'SUPPORT', features: { quality: c.quality.status }, reasons: [`data quality ${c.quality.status}`] }, { mandatory: true, canVeto: true });
add('risk', 'Pump detection', 'ticker.24h', ['binance.ticker24h'], (c) => c.ticker ? tri(c.ticker.changePct, (v) => v < 15, (v) => v > 25, 'change24hPct', (v) => `${v.toFixed(1)}%`) : ABSTAIN('no ticker'));
add('risk', 'Overextension vs EMA50', 'ema.1h', K('1h'), (c) => { const f = F(c, '1h'); return ok(f, 'ema50', 'atr14') ? tri((f!.close - f!.ema50) / f!.atr14, (v) => v < 4, (v) => v > 6, 'atrAboveEma50', (v) => v.toFixed(2)) : ABSTAIN('warming up'); });
add('risk', 'Gap risk (max 1h move)', 'rv.1h', K('1h'), (c) => tri(F(c, '1h')?.realizedVol20 ?? null, (v) => v < 0.025, (v) => v > 0.05, 'realizedVol20'));
add('risk', 'Stop below structure', 'swing.1h', K('1h'), (c) => { const f = F(c, '1h'); return ok(f, 'swingLow') ? vote(c.candidate.signal.stop <= f!.swingLow * 1.002, {}, 'stop beyond structural low', 'stop inside structure (noise risk)') : ABSTAIN('no swings'); });
add('risk', 'Max stop distance', 'signal', ['strategy'], (c) => tri((c.candidate.signal.entryRef - c.candidate.signal.stop) / c.candidate.signal.entryRef, (v) => v > 0.004 && v <= 0.06, (v) => v > 0.1 || v <= 0.002, 'stopPct', (v) => `${(v * 100).toFixed(2)}%`));
add('risk', 'Strategy track record', 'strategyStats', ['backtest'], (c) => { const s = c.strategyStats; if (!s || s.trades < 20) return ABSTAIN('insufficient out-of-sample trades'); return tri(s.expectancyR, (v) => v > 0.05 && s.profitFactor > 1.1, (v) => v < 0, 'expectancyR'); });
add('risk', 'Reward:risk', 'signal', ['strategy'], (c) => tri(c.candidate.signal.targets.reduce((a, t) => a + t.r * t.fraction, 0), (v) => v >= 1.5, (v) => v < 1, 'blendedR', (v) => v.toFixed(2)));
add('risk', 'Liquidation/leverage', 'policy', ['policy'], () => ({ stance: 'SUPPORT', features: { leverage: 1 }, reasons: ['spot, no leverage'] }), { constant: true });
// ── EXECUTION (8) ─────────────────────────────────────────────
const costR = (c: WorkerContext) => { const s = c.candidate.signal; if (!c.impact) return null; const rt = 2 * c.feeRate + (c.impact.spreadBps + 2 * c.impact.impactBps) / 1e4; return (rt * s.entryRef) / (s.entryRef - s.stop); };
add('execution', 'Round-trip cost in R', 'cost', ['binance.depth', 'fees'], (c) => tri(costR(c), (v) => v <= 0.1, (v) => v > 0.25, 'costR', (v) => v.toFixed(3)), { mandatory: true, canVeto: true });
add('execution', 'Min notional feasibility', 'rules', ['binance.exchangeInfo'], (c) => vote(c.intendedNotional >= 10, { notional: c.intendedNotional }, 'order above venue minimum', 'order below venue minimum'));
add('execution', 'Quote age', 'quality', ['binance'], (c) => tri(c.quality.quoteAgeMs, (v) => v < 30_000, (v) => v > 60_000, 'quoteAgeMs', (v) => `${(v / 1000).toFixed(0)}s`));
add('execution', 'Book age', 'quality', ['binance.depth'], (c) => tri(c.quality.bookAgeMs, (v) => v < 120_000, (v) => v > 180_000, 'bookAgeMs', (v) => `${(v / 1000).toFixed(0)}s`));
add('execution', 'Entry still near signal', 'ticker', ['binance'], (c) => c.ticker ? tri(Math.abs(c.ticker.last / c.candidate.signal.entryRef - 1) / ((c.candidate.signal.entryRef - c.candidate.signal.stop) / c.candidate.signal.entryRef), (v) => v < 0.25, (v) => v > 0.5, 'driftInR', (v) => v.toFixed(2)) : ABSTAIN('no ticker'), { canVeto: false });
add('execution', 'Stop executable (spot stop)', 'venue', ['venue'], () => ({ stance: 'SUPPORT', features: {}, reasons: ['spot stop monitored by OMS (paper)'] }), { constant: true });
add('execution', 'Cross-venue price agreement', 'cross', ['coinbase', 'kraken'], (c) => tri(c.quality.maxDeviationPct, (v) => v < 0.3, (v) => v > 1, 'maxDeviationPct', (v) => `${v.toFixed(2)}%`));
add('execution', 'Fee tier', 'fees', ['fees'], (c) => tri(c.feeRate, (v) => v <= 0.001, (v) => v > 0.002, 'feeRate'), { constant: true }); // fee rate is a policy constant within one policy version

export const WORKERS: readonly WorkerDef[] = Object.freeze(W);
export const DOMAINS: Domain[] = ['trend', 'momentum', 'volatility', 'flow', 'liquidity', 'structure', 'regime', 'news', 'onchain', 'risk', 'execution'];
export const REQUIRED_DOMAINS: Domain[] = ['trend', 'momentum', 'liquidity', 'risk', 'execution', 'regime'];
seq = {};
