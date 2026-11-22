import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, sha256 } from '../core/util.js';
import { audit } from '../core/audit.js';
import { config } from '../config.js';
import { fetchHistory } from '../lab/lab.js';
import { backtest, type BtTrade } from '../lab/backtest.js';
import { STRATEGIES, strategyById } from '../lab/strategies.js';
import { classifyRegime } from '../regime/regime.js';
import { FeatureEngine } from '../features/indicators.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';
import { researchSpec, findConcept } from './concepts.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';

/**
 * Quantitative Research Laboratory (Parts 6–7). Reuses MIA's backtester, strategy capsules, regime classifier and
 * candle provider. Every run is stored immutably with its data hash, parameters, seeds and code version so it can be
 * reproduced. Results are evidence for humans and the Strategy Lab — never a trade authorization.
 */
export const RESEARCH_VERSION = 'kb-research@1.0.0';
export type ExperimentKind = 'volatility_clustering' | 'return_autocorrelation' | 'strategy_walkforward';
const sha = sha256; // shared helper (core/util.ts)
const INTERVALS: Interval[] = ['15m', '1h', '4h'];

// ── Project 1: historical market-data store ─────────────────────────────────
export function storeCandles(instrument: string, interval: Interval, candles: Candle[], source = 'binance') {
  tx(() => { for (const c of candles) run('INSERT OR REPLACE INTO research_candles(instrument,interval,t,o,h,l,c,v,close_time,source,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', instrument, interval, c.t, c.o, c.h, c.l, c.c, c.v, c.closeTime ?? null, source, Date.now()); });
}
export function storedCandles(instrument: string, interval: Interval, limit = 100_000): Candle[] {
  return all<any>('SELECT t,o,h,l,c,v,close_time FROM (SELECT * FROM research_candles WHERE instrument=? AND interval=? ORDER BY t DESC LIMIT ?) ORDER BY t', instrument, interval, limit)
    .map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, closeTime: r.close_time ?? undefined }));
}
/** Closed candles for research: refreshed from the provider when online, otherwise the stored history only. */
export async function researchCandles(symbol: string, interval: Interval, bars: number): Promise<{ candles: Candle[]; origin: 'PROVIDER+STORE' | 'STORE_ONLY' }> {
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error('invalid symbol');
  if (!INTERVALS.includes(interval)) throw new Error('interval must be 15m, 1h or 4h');
  if (!config.offline) { try { storeCandles(symbol, interval, await fetchHistory(symbol, interval, bars + 1)); } catch (e: any) { if (!storedCandles(symbol, interval, 1).length) throw new Error(`no stored history and provider failed: ${e.message}`); } }
  const candles = storedCandles(symbol, interval, bars).filter((c) => (c.closeTime ?? c.t + INTERVAL_MS[interval]) < Date.now());
  const gaps = candles.slice(1).filter((c, i) => c.t - candles[i].t !== INTERVAL_MS[interval]).length;
  if (gaps) throw new Error(`stored history for ${symbol} ${interval} has ${gaps} gap(s); refresh it before research`);
  return { candles, origin: config.offline ? 'STORE_ONLY' : 'PROVIDER+STORE' };
}
export function candleInventory() { return all('SELECT instrument, interval, COUNT(*) bars, MIN(t) first, MAX(t) last, MAX(fetched_at) fetched FROM research_candles GROUP BY instrument, interval ORDER BY instrument, interval'); }
const dataHash = (c: Candle[]) => sha(c.map((x) => `${x.t},${x.o},${x.h},${x.l},${x.c},${x.v}`).join(';'));

// ── statistics ──────────────────────────────────────────────────────────────
export const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / (x.length || 1);
export function acf(x: number[], lag: number) {
  const m = mean(x); let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) { den += (x[i] - m) ** 2; if (i >= lag) num += (x[i] - m) * (x[i - lag] - m); }
  return den ? num / den : 0;
}
function lnGamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (const c of g) ser += c / ++y; return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
/** Regularized upper incomplete gamma Q(a, x) — chi-square survival function is Q(k/2, x/2). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; } return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
export const chiSquareSurvival = (q: number, k: number) => gammaQ(k / 2, q / 2);
/** Ljung–Box Q statistic over lags 1..m and its chi-square(m) p-value (assumes i.i.d. under the null). */
export function ljungBox(x: number[], m: number) { const n = x.length; let q = 0; for (let k = 1; k <= m; k++) q += acf(x, k) ** 2 / (n - k); q *= n * (n + 2); return { q, df: m, p: chiSquareSurvival(q, m) }; }
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function shuffle<T>(a: T[], r: () => number) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
const logReturns = (c: Candle[]) => c.slice(1).map((x, i) => Math.log(x.c / c[i].c)).filter(Number.isFinite);
const round = (x: number, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

// ── Projects 4/5/8: experiments ─────────────────────────────────────────────
function volatilityClustering(c: Candle[], seed: number) {
  const r = logReturns(c); if (r.length < 300) throw new Error(`need ≥300 returns, have ${r.length}`);
  const abs = r.map(Math.abs); const lags = Array.from({ length: 10 }, (_, i) => i + 1);
  const absAcf = lags.map((k) => acf(abs, k)); const stat = absAcf.reduce((a, b) => a + b, 0);
  const rand = rng(seed); const nullStats = Array.from({ length: 200 }, () => { const s = shuffle(abs, rand); return lags.reduce((t, k) => t + acf(s, k), 0); });
  const pEmp = (nullStats.filter((s) => s >= stat).length + 1) / (nullStats.length + 1);
  const half = Math.floor(abs.length / 2); const halfStat = [abs.slice(0, half), abs.slice(half)].map((h) => lags.reduce((t, k) => t + acf(h, k), 0));
  const lbAbs = ljungBox(abs, 10), lbSq = ljungBox(r.map((x) => x * x), 10), lbRaw = ljungBox(r, 10);
  const supported = pEmp < 0.01 && lbAbs.p < 0.01 && halfStat.every((h) => h > 0);
  return {
    results: { n: r.length, absReturnAcf: absAcf.map((v, i) => ({ lag: i + 1, acf: round(v) })), sumAcfLag1to10: round(stat), shuffledNull: { runs: 200, seed, p95: round([...nullStats].sort((a, b) => a - b)[189]), empiricalP: round(pEmp, 5) },
      ljungBoxAbs: { q: round(lbAbs.q, 2), p: lbAbs.p }, ljungBoxSquared: { q: round(lbSq.q, 2), p: lbSq.p }, ljungBoxRawReturns: { q: round(lbRaw.q, 2), p: lbRaw.p, note: 'raw-return autocorrelation shown for contrast' },
      firstHalfStat: round(halfStat[0]), secondHalfStat: round(halfStat[1]) },
    verdict: supported ? 'SUPPORTED' : pEmp < 0.05 ? 'INCONCLUSIVE' : 'NOT_SUPPORTED',
    limitations: ['Ljung–Box p-values assume i.i.d. under the null and finite variance; the shuffle test is the primary evidence.', 'Clustering describes volatility persistence, not price direction — it is not by itself a trading edge.'],
  };
}
function returnAutocorrelation(c: Candle[], seed: number) {
  const r = logReturns(c); if (r.length < 300) throw new Error(`need ≥300 returns, have ${r.length}`);
  const lags = [1, 2, 3, 4, 5]; const ac = lags.map((k) => acf(r, k)); const rand = rng(seed);
  const nullLag1 = Array.from({ length: 200 }, () => acf(shuffle(r, rand), 1)); const pTwo = (nullLag1.filter((v) => Math.abs(v) >= Math.abs(ac[0])).length + 1) / 201;
  const half = Math.floor(r.length / 2); const halves = [r.slice(0, half), r.slice(half)].map((h) => acf(h, 1)); const lb = ljungBox(r, 5);
  const stable = Math.sign(halves[0]) === Math.sign(halves[1]) && Math.sign(halves[0]) === Math.sign(ac[0]);
  const verdict = pTwo < 0.01 && stable ? (ac[0] < 0 ? 'SUPPORTED_MEAN_REVERSION' : 'SUPPORTED_MOMENTUM') : pTwo < 0.05 ? 'INCONCLUSIVE' : 'NOT_SUPPORTED';
  return { results: { n: r.length, acf: ac.map((v, i) => ({ lag: lags[i], acf: round(v) })), lag1ShuffleTwoSidedP: round(pTwo, 5), seed, ljungBox: { q: round(lb.q, 2), p: lb.p }, lag1FirstHalf: round(halves[0]), lag1SecondHalf: round(halves[1]) },
    verdict, limitations: ['Small autocorrelations are usually smaller than round-trip costs; significance is not profitability.', 'Shuffle null destroys volatility clustering too, which can widen the null.'] };
}

/** Part 7 performance metrics from trade R-multiples at fixed fractional risk. */
export function performanceMetrics(trades: BtTrade[], riskPct: number, bars: number, interval: Interval, seed = 7) {
  const rs = trades.map((t) => t.r); const risk = riskPct / 100; let eq = 1, peak = 1, mdd = 0; const rets: number[] = [];
  for (const r of rs) { const ret = risk * r; rets.push(ret); eq *= 1 + ret; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak); }
  const m = mean(rets); const sd = Math.sqrt(mean(rets.map((x) => (x - m) ** 2))); const down = Math.sqrt(mean(rets.map((x) => Math.min(0, x) ** 2)));
  const years = (bars * INTERVAL_MS[interval]) / (365.25 * 86400_000); const perYear = years > 0 ? rs.length / years : 0;
  const netReturn = eq - 1; const cagr = years > 0 && eq > 0 ? eq ** (1 / years) - 1 : NaN;
  const gains = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0), losses = -rs.filter((r) => r <= 0).reduce((a, b) => a + b, 0);
  const sorted = [...rets].sort((a, b) => a - b); const tail = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)));
  const rand = rng(seed); const boots = Array.from({ length: 1000 }, () => mean(Array.from({ length: rs.length }, () => rs[Math.floor(rand() * rs.length)] ?? 0))).sort((a, b) => a - b);
  const exposureBars = trades.reduce((s, t) => s + Math.max(1, t.bars), 0);
  return {
    trades: rs.length, netReturn: round(netReturn), cagr: round(cagr), volatilityPerTrade: round(sd), sharpePerTrade: round(sd ? m / sd : NaN), sharpeAnnualized: round(sd ? (m / sd) * Math.sqrt(perYear) : NaN),
    sortinoAnnualized: round(down ? (m / down) * Math.sqrt(perYear) : NaN), maxDrawdown: round(mdd), calmar: round(mdd ? cagr / mdd : NaN), profitFactor: round(losses ? gains / losses : gains ? Infinity : NaN),
    winRate: round(rs.length ? rs.filter((r) => r > 0).length / rs.length : NaN), expectancyR: round(rs.length ? mean(rs) : NaN), expectancyR95CI: rs.length ? [round(boots[25]), round(boots[974])] : null,
    turnoverTradesPerYear: round(perYear, 1), exposure: round(bars ? exposureBars / bars : NaN), cvar5: round(mean(tail)), costsIncluded: 'fees both sides + spread + slippage (lab/backtest.ts cost model)',
    calibration: 'not applicable to rule-based R outcomes — probability forecasts are calibrated in DITAS (ditas/calibration.ts)',
    uncertainty: rs.length < 30 ? `only ${rs.length} trades: metrics are highly uncertain` : 'bootstrap 95% CI shown for expectancy',
  };
}

/** Walk-forward over a single point-in-time backtest: trades partitioned by entry time, boundary-crossing trades purged, embargo after each boundary. */
function strategyWalkforward(c: Candle[], interval: Interval, strategyId: string, instrumentId: string, seed: number, windows = 5, embargoBars = 24) {
  const s = strategyById(strategyId); if (!s) throw new Error('unknown strategy');
  if (s.interval !== interval) throw new Error(`strategy ${s.id} runs on ${s.interval} candles`);
  if (c.length < 1500) throw new Error(`need ≥1500 bars for 1 training + ${windows} test windows, have ${c.length}`);
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY; const costs = { feeRate: pol.feeRate, slippageBps: 3, spreadBps: 2 };
  const bt = backtest(s, instrumentId, c, costs, 1);
  const segLen = Math.floor(c.length / (windows + 1)); const bounds = Array.from({ length: windows + 2 }, (_, i) => c[Math.min(c.length - 1, i * segLen)].t);
  bounds[bounds.length - 1] = c[c.length - 1].t + INTERVAL_MS[interval];
  const embargoMs = embargoBars * INTERVAL_MS[interval]; let purged = 0, embargoed = 0;
  const keptByWindow: BtTrade[][] = [];
  const win = (i: number) => {
    const lo = bounds[i], hi = bounds[i + 1];
    const inWin = bt.trades.filter((t) => t.entryT >= lo && t.entryT < hi);
    const kept = inWin.filter((t) => { if (t.exitT >= hi) { purged++; return false; } if (i > 0 && t.entryT < lo + embargoMs) { embargoed++; return false; } return true; });
    const startPx = c.find((x) => x.t >= lo)!.o; const endPx = [...c].reverse().find((x) => x.t < hi)!.c;
    const regimes = (() => { const e = new FeatureEngine(); const counts: Record<string, number> = {}; for (const x of c) { if (x.t >= hi) break; e.ingest([x]); if (x.t >= lo) { const r = classifyRegime(e.last).regime; counts[r] = (counts[r] ?? 0) + 1; } } return counts; })();
    const bars = c.filter((x) => x.t >= lo && x.t < hi).length;
    keptByWindow[i] = kept;
    return { window: i, from: lo, to: hi, role: i === 0 ? 'TRAINING (warm-up, fixed parameters — reported, not used to select)' : 'OUT_OF_SAMPLE', bars,
      metrics: performanceMetrics(kept, pol.riskPerTradePct, bars, interval, seed + i), benchmarkBuyHold: round(endPx / startPx - 1), regimeBars: regimes };
  };
  const all_ = Array.from({ length: windows + 1 }, (_, i) => win(i)); const oos = all_.slice(1);
  // Aggregate, verdict and regime breakdown use exactly the trades that survived purge AND embargo in each OOS window.
  const oosTrades = keptByWindow.slice(1).flat();
  const positiveWindows = oos.filter((w) => w.metrics.trades > 0 && w.metrics.expectancyR > 0).length;
  const agg = performanceMetrics(oosTrades, pol.riskPerTradePct, c.length - segLen, interval, seed);
  const verdict = agg.trades < 30 ? 'INSUFFICIENT_EVIDENCE' : positiveWindows === windows && (agg.expectancyR95CI?.[0] ?? -1) > 0 ? 'SUPPORTED' : agg.expectancyR > 0 ? 'INCONCLUSIVE' : 'NOT_SUPPORTED';
  const byRegime: Record<string, { trades: number; expectancyR: number }> = {};
  for (const t of oosTrades) { const g = (byRegime[t.regime] ??= { trades: 0, expectancyR: 0 }); g.expectancyR = (g.expectancyR * g.trades + t.r) / (g.trades + 1); g.trades++; }
  return { results: { strategy: { id: s.id, version: s.version }, backtestInstrument: bt.instrument, costs, windows: all_, outOfSampleAggregate: agg, positiveOosWindows: `${positiveWindows}/${windows}`, byRegime, purgedTrades: purged, embargoedTrades: embargoed, embargoBars },
    verdict, limitations: ['Strategy parameters are fixed research defaults (no optimisation), so the training window only warms indicators.', 'Survivorship bias: tested on a currently listed instrument.', 'Paper/backtest fills; real fills may be worse.'] };
}

export interface RunInput { conceptId?: string; kind: ExperimentKind; symbol: string; interval: Interval; bars?: number; strategyId?: string; seed?: number }
export async function runExperiment(actor: string, input: RunInput) {
  if (actor !== 'owner') throw new Error('only the owner may run research experiments');
  const seed = input.seed ?? 42; const bars = Math.min(8000, Math.max(500, input.bars ?? 3000));
  const concept = input.conceptId ? findConcept(input.conceptId) : null; if (input.conceptId && !concept) throw new Error('concept not found');
  const strategyId = input.kind === 'strategy_walkforward' ? input.strategyId ?? 'trend_pullback' : undefined;
  if (concept) {
    const kind = P<{ experiment?: ExperimentKind }>(concept.card).experiment;
    // The record is immutable, so a hypothesis from a different test must never be attached to these results.
    if (kind !== input.kind) throw new Error(`concept "${concept.name}" is tested by ${kind ?? 'no defined experiment'}, not ${input.kind}`);
  }
  const spec = concept ? researchSpec(concept.id, { symbol: input.symbol, interval: input.interval, strategyId }) : null;
  const { candles, origin } = await researchCandles(input.symbol.toUpperCase(), input.interval, bars);
  const out = input.kind === 'volatility_clustering' ? volatilityClustering(candles, seed) : input.kind === 'return_autocorrelation' ? returnAutocorrelation(candles, seed)
    : strategyWalkforward(candles, input.interval, strategyId!, `crypto:binance:${input.symbol.toUpperCase()}`, seed);
  const priorTrials = get<{ n: number }>("SELECT COUNT(*) n FROM research_experiments WHERE kind=? AND json_extract(dataset,'$.symbol')=? AND json_extract(dataset,'$.interval')=? AND COALESCE(json_extract(spec,'$.strategyId'),'')=?",
    input.kind, input.symbol.toUpperCase(), input.interval, strategyId ?? '')!.n;
  const dataset = { symbol: input.symbol.toUpperCase(), interval: input.interval, bars: candles.length, from: candles[0]?.t, to: candles[candles.length - 1]?.t, source: 'Binance public klines', origin };
  const hypothesis = spec?.hypothesis ?? `${input.kind} on ${dataset.symbol} ${input.interval}`;
  const limitations = [...out.limitations, ...(priorTrials ? [`${priorTrials} earlier run(s) of this test on the same data: repeated testing raises false-discovery risk.`] : []), 'Historical evidence does not establish future profitability.'];
  const rec = { id: uid('exp'), created_at: Date.now(), kind: input.kind, concept_id: concept?.id ?? null, hypothesis, spec: J({ ...(spec ?? {}), strategyId: strategyId ?? null, seed }), dataset: J(dataset),
    data_hash: dataHash(candles), results: J({ ...out.results, trialNumber: priorTrials + 1 }), verdict: out.verdict, limitations: J(limitations), code_version: `${RESEARCH_VERSION}+${process.env.MIA_GIT_SHA ?? 'local'}` };
  const hash = sha(J(rec));
  tx(() => { // experiment and its audit entry commit together, so a failed audit never leaves an orphan trial
    run('INSERT INTO research_experiments(id,created_at,kind,concept_id,hypothesis,spec,dataset,data_hash,results,verdict,limitations,code_version,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      rec.id, rec.created_at, rec.kind, rec.concept_id, rec.hypothesis, rec.spec, rec.dataset, rec.data_hash, rec.results, rec.verdict, rec.limitations, rec.code_version, hash);
    audit(actor, 'research.experiment', { id: rec.id, kind: rec.kind, verdict: rec.verdict });
  });
  return experimentDetail(rec.id)!;
}
export function listExperiments(limit = 100) {
  return all<any>('SELECT e.id, e.created_at, e.kind, e.concept_id, c.name concept, e.hypothesis, e.verdict, e.dataset, e.data_hash FROM research_experiments e LEFT JOIN kb_concepts c ON c.id = e.concept_id ORDER BY e.created_at DESC LIMIT ?', limit)
    .map((e) => ({ ...e, dataset: P(e.dataset) }));
}
export function experimentDetail(id: string) {
  const e = get<any>('SELECT * FROM research_experiments WHERE id=?', id); if (!e) return null;
  const rec = { ...e, spec: P(e.spec), dataset: P(e.dataset), results: P(e.results), limitations: P(e.limitations) };
  const { hash, ...body } = e; const intact = sha(J({ id: body.id, created_at: body.created_at, kind: body.kind, concept_id: body.concept_id, hypothesis: body.hypothesis, spec: body.spec, dataset: body.dataset, data_hash: body.data_hash, results: body.results, verdict: body.verdict, limitations: body.limitations, code_version: body.code_version })) === hash;
  return { ...rec, integrity: intact ? 'VERIFIED' : 'MISMATCH', reproduce: { kind: e.kind, symbol: rec.dataset.symbol, interval: rec.dataset.interval, bars: rec.dataset.bars, seed: rec.spec.seed, strategyId: rec.spec.strategyId, expectDataHash: e.data_hash } };
}
/** Project 8: strategy comparison laboratory — every strategy capsule on identical data and costs. */
export async function compareStrategies(actor: string, symbol: string, interval: Interval = '1h', bars = 4000) {
  const ids = STRATEGIES.filter((s) => s.interval === interval).map((s) => s.id); const rows = [];
  for (const id of ids) {
    const e = await runExperiment(actor, { kind: 'strategy_walkforward', symbol, interval, bars, strategyId: id, conceptId: 'con_walk_forward_validation' });
    rows.push({ strategyId: id, experimentId: e.id, verdict: e.verdict, oos: e.results.outOfSampleAggregate, positiveOosWindows: e.results.positiveOosWindows });
  }
  return { symbol, interval, bars, rows, note: 'Ranked by evidence, not profit alone: compare verdict, OOS expectancy CI, drawdown and stability across windows.' };
}
/** Project 10: 90-day paper-trading experiment status from the real paper ledger (no simulation). */
export function paperExperimentStatus() {
  const first = get<{ t: number | null }>('SELECT MIN(opened_at) t FROM positions')!.t; const closed = all<any>("SELECT realized_pnl, planned_risk, closed_at FROM positions WHERE status='CLOSED' ORDER BY closed_at");
  const days = first ? (Date.now() - first) / 86400_000 : 0; const rs = closed.map((p) => (p.planned_risk > 0 ? p.realized_pnl / p.planned_risk : 0));
  return { started: first, daysElapsed: Math.floor(days), targetDays: 90, closedTrades: closed.length, expectancyR: rs.length ? round(mean(rs)) : null, winRate: rs.length ? round(rs.filter((r) => r > 0).length / rs.length) : null,
    status: !first ? 'NOT_STARTED' : days >= 90 ? 'COMPLETE' : 'RUNNING', note: 'Measured from actual paper positions. Requires the app to run continuously (hosting, Phase 8).' };
}
