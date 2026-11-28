import { fetchProvider, registerProvider, setRateLimit } from './http.js';
registerProvider({
  hosts: ['api.frankfurter.dev'],
  id: 'frankfurter', name: 'Frankfurter (ECB reference rates)', sourceClass: 'fx_reference', markets: ['forex'],
  license: 'ECB euro foreign exchange reference rates — free reuse with attribution. Reference fixing, NOT a tradeable quote.',
  realtime: 'DAILY_REFERENCE', requiresCredentials: false,
  note: 'Daily ECB fixing (~16:00 CET). No bid/ask → forex is display-only; paper execution blocked by execution-feasibility check.',
});
setRateLimit('frankfurter', 30);
export const FX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'USDMXN', 'USDCNY', 'USDINR'];
export interface FxSeries { pair: string; date: string; rate: number; series: { date: string; rate: number }[] }
export async function fxSeries(days = 120): Promise<FxSeries[]> {
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const r = await fetchProvider('frankfurter', `https://api.frankfurter.dev/v1/${start}..?base=USD`, { timeoutMs: 15_000 });
  const dates = Object.keys(r.rates).sort();
  const rateOf = (d: string, ccy: string) => (ccy === 'USD' ? 1 : r.rates[d]?.[ccy]);
  return FX_PAIRS.map((pair) => {
    const b = pair.slice(0, 3), q = pair.slice(3);
    // USD-based: price of 1 b in q = (USD->q)/(USD->b)
    const series = dates.map((d) => ({ date: d, rate: rateOf(d, q) / rateOf(d, b) })).filter((x) => Number.isFinite(x.rate));
    const last = series[series.length - 1];
    return { pair, date: last?.date ?? '', rate: last?.rate ?? NaN, series };
  });
}
