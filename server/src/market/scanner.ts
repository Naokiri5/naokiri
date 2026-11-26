import { setImmediate as nextTurn } from 'node:timers/promises';
import { recordOpportunity } from '../ditas/memory.js';
import { marketBreadth } from './bubbles.js';
import { market } from './store.js';
import { assessQuality, bookImpact, bookFreshForExecution } from './quality.js';
import { assessCexAsset, assessDexPair, type SafetyResult } from '../safety/safety.js';
import { classifyRegime, type Regime } from '../regime/regime.js';
import { STRATEGIES } from '../lab/strategies.js';
import { runConsensus } from '../qci/coordinator.js';
import { decide, type DecisionReport } from '../decision/engine.js';
import { newsContext } from '../news/news.js';
import { printContext } from '../whales/prints.js';
import { correlation } from '../portfolio/correlation.js';
import { accountState, openPositions } from '../portfolio/ledger.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';
import { strategyStats } from '../lab/lab.js';
import { readIndicators } from '../workers/indicators.js';
import { getControl } from '../core/mode.js';
import { uid } from '../core/util.js';
import { ScanLedger, capacityEpoch, storedDecisionsEndKey } from './scanLedger.js';
import { INTERVAL_MS } from './types.js';
import { timed, record } from '../core/latency.js';
import { bus } from '../core/bus.js';
import type { Candidate, WorkerContext } from '../workers/types.js';

/** Part 1 universal scanner + Part 16.8 rejection intelligence. One scanner; QHEF only schedules it. */
export interface BoardRow {
  instrumentId: string; symbol: string; base: string; price: number; changePct: number; quoteVolume: number;
  regime: Regime; safety: SafetyResult['status']; quality: string; qualityIssues: string[]; spreadBps: number | null;
  rsi1h: number | null; trend1h: string; signals: string[]; lastDecision?: { id: string; decision: string; score: number; at: number };
  bullish: number; bearish: number;
}
export const board = new Map<string, BoardRow>();
export const rejections: { at: number; symbol: string; stage: string; reason: string }[] = [];
const ledger = new ScanLedger();
/** Signals denied only for capacity, held until a settlement frees capacity or their candle is superseded. */
export const waitingCandidates = (nowTs = Date.now()) => ledger.waitingList(nowTs);
export const _scanTest = { reset: () => ledger.clear() };
const lastDecisions: DecisionReport[] = [];
export const recentDecisions = () => lastDecisions.slice(-100).reverse();

function rejectLog(symbol: string, stage: string, reason: string) {
  rejections.push({ at: Date.now(), symbol, stage, reason }); if (rejections.length > 500) rejections.splice(0, rejections.length - 500);
}

export function buildContext(cand: Candidate): WorkerContext {
  const d = market.deep.get(cand.instrumentId)!; const t = market.tickers.get(cand.instrumentId);
  const btc = market.deep.get('crypto:binance:BTCUSDT');
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  const acct = accountState();
  const stopPct = (cand.signal.entryRef - cand.signal.stop) / cand.signal.entryRef;
  const equity = acct.equity > 0 ? acct.equity : 10_000;
  const intended = Math.min((equity * pol.riskPerTradePct) / 100 / stopPct, equity * pol.maxPositionNotionalPct / 100);
  const imp = bookImpact(d.book, 'buy', Math.max(intended, 10));
  const ss = strategyStats(cand.strategyId);
  const asOf = Date.now();
  const frameQuality = Object.fromEntries((['15m', '1h', '4h'] as const).map(iv => [iv, assessQuality(cand.instrumentId, iv, asOf)]));
  const btcQuality = { '1h': assessQuality('crypto:binance:BTCUSDT', '1h', asOf), '4h': assessQuality('crypto:binance:BTCUSDT', '4h', asOf) };
  return {
    candidate: cand,
    f: Object.fromEntries((['15m', '1h', '4h'] as const).map(iv => [iv, frameQuality[iv].status === 'FAIL' ? null : d.engines[iv].last])),
    frameQuality: { ...frameQuality, btc1h: btcQuality['1h'], btc4h: btcQuality['4h'] },
    btc1h: btcQuality['1h'].status === 'FAIL' ? null : btc?.engines['1h'].last ?? null, btc4h: btcQuality['4h'].status === 'FAIL' ? null : btc?.engines['4h'].last ?? null,
    ticker: t ? { last: t.last, changePct: t.changePct, quoteVolume: t.quoteVolume, trades: t.trades, high: t.high, low: t.low } : null,
    impact: imp ? { spreadBps: imp.spreadBps, impactBps: imp.impactBps, depth1pct: imp.depth1pct, filledFully: imp.filledFully, bookImbalance: imp.bookImbalance } : null,
    intendedNotional: intended, feeRate: pol.feeRate,
    quality: assessQuality(cand.instrumentId), safety: assessCexAsset(cand.instrumentId),
    news: newsContext(cand.base), prints: printContext(cand.instrumentId),
    corrToBtc: cand.instrumentId.endsWith('BTCUSDT') ? null : correlation(cand.instrumentId, 'crypto:binance:BTCUSDT'),
    breadth: marketBreadth(),
    strategyStats: ss ? { trades: ss.trades, expectancyR: ss.expectancyR, profitFactor: ss.profitFactor } : null,
  };
}

export async function scanOnce(onDecision?: (r: DecisionReport, snapshotId?: string) => void, continueScan?: () => boolean) {
  const t0 = performance.now();
  const ctl = getControl();
  let candidates = 0;
  const epoch = capacityEpoch();
  for (const id of market.universe) {
    // Scheduled scans give due protection timers a turn between instruments.
    if (continueScan) {
      await nextTurn();
      if (!continueScan()) return { candidates, universe: market.universe.length };
    }
    const inst = market.instruments.get(id); const d = market.deep.get(id); const t = market.tickers.get(id);
    if (!inst || !d || !t) continue;
    const f1 = d.engines['1h'].last;
    const q = assessQuality(id); const safety = assessCexAsset(id); const reg = classifyRegime(f1);
    const imp = bookImpact(d.book, 'buy', 1000);
    const ind = readIndicators({ '15m': d.engines['15m'].last, '1h': f1, '4h': d.engines['4h'].last });
    const row: BoardRow = {
      instrumentId: id, symbol: inst.symbol, base: inst.base, price: t.last, changePct: t.changePct, quoteVolume: t.quoteVolume, regime: reg.regime,
      safety: safety.status, quality: q.status, qualityIssues: q.issues, spreadBps: imp?.spreadBps ?? null, rsi1h: f1?.rsi14 ?? null,
      trend1h: !f1 ? 'n/a' : f1.ema20 > f1.ema50 ? 'up' : 'down', signals: [], lastDecision: board.get(id)?.lastDecision,
      bullish: ind.filter((x) => (x.signal ?? 0) > 0.25).length, bearish: ind.filter((x) => (x.signal ?? 0) < -0.25).length,
    };
    board.set(id, row);
    if (!f1) { recordOpportunity({ kind: 'NO_SIGNAL', instrumentId: id, dedupeKey: `scan:no-candles:${id}:${Math.floor(Date.now() / 3600000)}`, reason: 'No closed 1h candles available' }); continue; }
    for (const s of STRATEGIES) {
      if (ctl.disabledStrategies.includes(s.id)) continue;
      const key = `${id}:${s.id}:${f1.t}`;
      const verdict = ledger.verdict(key, Date.now(), epoch);
      if (verdict !== 'EVALUATE') continue;
      // survive restarts: a terminal decision for this instrument/strategy after this candle closed already exists
      // (a capacity-only denial is not terminal; it is re-evaluated once and then waits for a settlement)
      if (storedDecisionsEndKey(id, s.id, f1.t + INTERVAL_MS[s.interval])) { ledger.markProcessed(key); continue; }
      if (q.status === 'FAIL') { recordOpportunity({ kind: 'REJECTED', instrumentId: id, strategyId: s.id, dedupeKey: `scan:${key}`, reason: `Data quality: ${q.issues.join('; ')}` }); rejectLog(inst.symbol, 'data-quality', q.issues.join('; ')); continue; }
      if (!s.suitableRegimes.includes(reg.regime)) { recordOpportunity({ kind: 'NO_SIGNAL', instrumentId: id, strategyId: s.id, dedupeKey: `scan:${key}`, reason: `Regime ${reg.regime} unsuitable for strategy ${s.version}` }); continue; }
      const sig = s.generate(f1);
      if (!sig) { recordOpportunity({ kind: 'NO_SIGNAL', instrumentId: id, strategyId: s.id, dedupeKey: `scan:${key}`, reason: `Strategy ${s.version}: no entry condition` }); continue; }
      row.signals.push(s.id);
      if (!safety.eligibleForAutomation) { recordOpportunity({ kind: 'REJECTED', instrumentId: id, strategyId: s.id, dedupeKey: `scan:${key}`, reason: `Safety: ${safety.reasons.join('; ')}` }); rejectLog(inst.symbol, 'safety', `${s.id}: ${safety.status} — ${safety.reasons.join('; ')}`); continue; }
      candidates++;
      try {
      const cand: Candidate = { id: uid('cand'), eventId: `${inst.symbol}:${s.interval}:${f1.t}`, traceId: uid('trace'), instrumentId: id, symbol: inst.symbol, base: inst.base, market: 'crypto', venue: 'binance',
        strategyId: s.id, strategyVersion: s.version, interval: s.interval, signal: sig, regime: reg.regime, createdAt: Date.now() };
      const ctx = buildContext(cand);
      const proposalMemory = recordOpportunity({ kind: 'PROPOSAL', instrumentId: id, strategyId: s.id, dedupeKey: `proposal:${cand.id}`, reason: sig.reasons.join('; '), candidate: cand, ctx });
      ctx.memorySnapshotId = proposalMemory.snapshotId ?? undefined;
      const qci = await runConsensus(ctx);
      if (continueScan && !continueScan()) return { candidates, universe: market.universe.length };
      const correlatedOpen = openPositions().filter((p) => { const c = correlation(p.instrument, id); return c == null || c >= (currentPolicy()?.policy ?? DEFAULT_POLICY).correlationThreshold; }).length;
      const rep = decide(cand, ctx, qci, ctx.strategyStats, correlatedOpen);
      record('pipeline.candidate_to_decision', Date.now() - cand.createdAt);
      row.lastDecision = { id: rep.id, decision: rep.decision, score: rep.opportunity.score, at: Date.now() };
      if (rep.decision === 'REJECTED' || rep.decision === 'INSUFFICIENT_DATA') rejectLog(inst.symbol, 'decision', `${s.id}: ${rep.decision} — ${[...qci.reason_codes, ...(rep.risk?.reasonCodes ?? [])].slice(0, 3).join('; ')}`);
      lastDecisions.push(rep); if (lastDecisions.length > 300) lastDecisions.shift();
      // A capacity-only denial waits for a settlement; any other outcome ends this key for the candle.
      ledger.record(key, { instrumentId: id, strategyId: s.id }, rep.risk, epoch, f1.t + 2 * INTERVAL_MS['1h'], Date.now());
      onDecision?.(rep, ctx.memorySnapshotId);
      } catch (e: any) {
        // One failing candidate must not abort the scan for the rest of the universe; it is retried next cycle.
        ledger.forget(key); rejectLog(inst.symbol, 'error', `${s.id}: ${String(e?.message ?? e).slice(0, 200)}`);
      }
    }
  }
  ledger.prune(Date.now());
  record('scan.cycle', performance.now() - t0);
  market.lastScanAt = Date.now();
  bus.publish('scan', { at: market.lastScanAt, universe: market.universe.length, candidates });
  return { candidates, universe: market.universe.length };
}

/** Manual "analyze now" for any instrument & strategy (Trader Joe / Scanner button). Runs the full pipeline even with no live signal → evaluation only. */
export async function analyzeInstrument(id: string, strategyId?: string): Promise<DecisionReport | { instrumentId: string; status: string; reason: string; indicators: ReturnType<typeof readIndicators>; regime: Regime; safety: SafetyResult; quality: ReturnType<typeof assessQuality> }> {
  const inst = market.instruments.get(id); if (!inst) throw new Error('unknown instrument');
  const held = market.deep.get(id);
  if (!held || !held.engines['1h'].last || !bookFreshForExecution(held.book)) {
    const { refreshDeep } = await import('./fabric.js'); await timed('analyze.ondemand', () => refreshDeep([id]));
  }
  const d = market.deep.get(id)!; const f1 = d.engines['1h'].last; const reg = classifyRegime(f1);
  const ind = readIndicators({ '15m': d.engines['15m'].last, '1h': f1, '4h': d.engines['4h'].last });
  const strategies = strategyId ? STRATEGIES.filter((s) => s.id === strategyId) : STRATEGIES;
  for (const s of strategies) {
    const sig = f1 && s.suitableRegimes.includes(reg.regime) ? s.generate(f1) : null;
    if (!sig) continue;
    const cand: Candidate = { id: uid('cand'), eventId: `${inst.symbol}:manual:${Date.now()}`, traceId: uid('trace'), instrumentId: id, symbol: inst.symbol, base: inst.base, market: 'crypto', venue: 'binance', strategyId: s.id, strategyVersion: s.version, interval: s.interval, signal: sig, regime: reg.regime, createdAt: Date.now() };
    const ctx = buildContext(cand); const proposalMemory = recordOpportunity({ kind: 'PROPOSAL', instrumentId: id, strategyId: s.id, dedupeKey: `proposal:${cand.id}`, reason: sig.reasons.join('; '), candidate: cand, ctx }); ctx.memorySnapshotId = proposalMemory.snapshotId ?? undefined; const qci = await runConsensus(ctx);
    const rep = decide(cand, ctx, qci, ctx.strategyStats, 0);
    lastDecisions.push(rep); if (lastDecisions.length > 300) lastDecisions.shift();
    return rep;
  }
  recordOpportunity({ kind: 'NO_SIGNAL', instrumentId: id, strategyId, dedupeKey: `manual:${id}:${uid('analysis')}`, reason: `No strategy entry condition (regime ${reg.regime})` });
  return { instrumentId: id, status: 'NO_SIGNAL', reason: `No strategy entry condition is met (regime ${reg.regime}). Nothing to trade — monitoring.`, indicators: ind, regime: reg.regime, safety: assessCexAsset(id), quality: assessQuality(id) };
}
export function dexBoard() { return market.dex.map((p) => ({ ...p, safety: assessDexPair(p) })).sort((a, b) => b.volume24h - a.volume24h); }
