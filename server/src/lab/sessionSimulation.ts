import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FeatureEngine } from '../features/indicators.js';
import { INTERVAL_MS, type Candle } from '../market/types.js';
import { classifyRegime } from '../regime/regime.js';
import { DEFAULT_POLICY, RiskPolicy } from '../risk/policy.js';
import { floorToStep } from '../risk/quantity.js';
import { assertStrategyHistory, stats, type BtStats } from './backtest.js';
import { newExitState, stepExit, type ExitState } from './exits.js';
import type { StrategyDef } from './strategies.js';
import type { HistoricalEvent, HistoricalVenue } from './tape-reader.js';

/**
 * Isolated historical session simulation (research only; NO orders, balances, ledger, database or lease access).
 *
 * One instrument, one long position at a time, simulated cash only:
 * - Signals come from closed candles through the canonical strategy capsules (lab/strategies.ts) and regime filter,
 *   exactly as in the candle backtester. A candle is used only once the tape clock reaches its close boundary.
 * - Entries execute causally at the first matching book observation at or after signal close + latency (within
 *   maxWait), at the ask plus slippage, consuming ask-side depth. No partial entries.
 * - Sizing mirrors the canonical risk gate formula for the accepted policy (see simulatedEntrySizing). Spread,
 *   slippage, notional, per-trade risk, cash and the owner's session boundaries are checked before every entry.
 * - Exits use the shared exit capsule (lab/exits.ts, also used by the paper OMS) against the bid. An exit larger than
 *   the displayed bid depth is deferred, never invented; the position stays open.
 * - The owner's capital ceiling follows the canonical trading mandate (ops/tradingMandate.ts mandateCapitalDenial):
 *   open cost + net realized loss + the new entry's cost (fees included) must stay within the authorized capital.
 * - Optional maxSessionLossUsd is a PROPOSED mandate extension, not yet enforced by the live session: equity is marked
 *   at liquidation value (bid less the exit fee); entries need worst-case headroom, and once the loss is reached the
 *   breach is latched (no new entries, open positions still managed — the REFLEX analogue).
 * - Not modeled: QCI/worker consensus, the decision engine, cross-venue checks, cooldowns, correlation and adaptive
 *   sizing. Results are research evidence about the strategy capsule and execution costs, not a certification.
 */
export interface SessionSimulationOptions {
  venue: HistoricalVenue;
  symbol: string;
  startingCashUsd: number;
  /** Authorized capital, as in the session's trading mandate. Must not exceed starting cash. */
  capitalCeilingUsd: number;
  /** Proposed mandate extension: maximum session loss at liquidation value. Omit to model today's live mandate. */
  maxSessionLossUsd?: number;
  latencyMs: number;
  maxWaitMs: number;
  /** Execution cost beyond the touch, charged against the trader on every fill. */
  slippageBps: number;
  /** Defaults to DEFAULT_POLICY; validated with the canonical schema. */
  policy?: RiskPolicy;
  /** Venue lot size; quantities are floored to it as the risk gate does. */
  stepSize?: number;
}

const LIMITS = z.object({
  capitalCeilingUsd: z.number().finite().positive().max(1e12),
  maxSessionLossUsd: z.number().finite().positive().max(1e12).optional(),
}).strict();

export interface SimulatedEntrySizing {
  qty: number; riskBudget: number; maxNotional: number; perUnitLoss: number; conservativeStopFill: number;
}

/**
 * Same formula as risk/gate.ts sizing for a policy without adaptive drawdown sizing or cash reserves:
 * risk budget = equity × riskPerTrade; per-unit loss from the worst permitted entry (ask + maxSlippage) to the buffered
 * stop plus round-trip fees; capped by maxPositionNotional and 98% of cash; floored exactly to the lot size. Venue minQty/minNotional are not
 * modeled here (the simulator applies its own $5 floor).
 * server/test/session-simulation.test.ts asserts parity with evaluateRisk.
 */
export function simulatedEntrySizing(policy: RiskPolicy, equity: number, cash: number, ask: number, stop: number, stepSize?: number): SimulatedEntrySizing {
  const conservativeStopFill = stop * (1 - policy.stopFillBufferPct / 100);
  const worstPermittedEntry = ask * (1 + policy.maxSlippageBps / 10_000);
  const perUnitLoss = worstPermittedEntry - conservativeStopFill + policy.feeRate * (worstPermittedEntry + conservativeStopFill);
  const riskBudget = equity * (policy.riskPerTradePct / 100);
  const maxNotional = Math.min(equity * (policy.maxPositionNotionalPct / 100), cash * 0.98);
  let qty = perUnitLoss > 0 ? riskBudget / perUnitLoss : 0;
  if (qty * worstPermittedEntry > maxNotional) qty = maxNotional / worstPermittedEntry;
  // Exact lot floor shared with the gate (never rounds up); without a step the quantity stays continuous.
  if (stepSize !== undefined) qty = floorToStep(qty, stepSize) ?? 0;
  return { qty, riskBudget, maxNotional, perUnitLoss, conservativeStopFill };
}

export interface SimulatedTrade {
  signalTs: number; entryTs: number; exitTs: number; qty: number; entryPrice: number;
  proceedsUsd: number; feesUsd: number; netPnlUsd: number; r: number; reason: string; regime: string; heldCandles: number;
}
export type SimulationRecordKind = 'SIGNAL' | 'ENTRY' | 'ENTRY_REJECTED' | 'EXIT' | 'EXIT_DEFERRED' | 'LOSS_LIMIT_REACHED';
export interface SimulationRecord { ts: number; kind: SimulationRecordKind; detail: string }

export interface SessionSimulationReport {
  version: 1;
  evidence: 'RESEARCH_UNVERIFIED_TAPE';
  tradingAuthority: false;
  strategyId: string; strategyVersion: string; venue: HistoricalVenue; symbol: string;
  from: number | null; to: number | null; eventsProcessed: number; booksUsed: number; candlesUsed: number;
  startingEquityUsd: number; endingEquityUsd: number; netPnlUsd: number;
  maxDrawdownUsd: number; maxDrawdownPct: number;
  signals: number; entries: number; rejections: Record<string, number>; exitsDeferred: number;
  trades: SimulatedTrade[]; tradeStats: BtStats;
  lossLimit: { reachedAt: number; sessionPnlUsd: number } | null;
  openPosition: { entryTs: number; qtyLeft: number; entryPrice: number; stop: number; markValueUsd: number } | null;
  records: SimulationRecord[]; recordsDropped: number;
  warnings: string[];
  determinismHash: string;
}

const MAX_RECORDS = 10_000;
const VENUES: readonly HistoricalVenue[] = ['BINANCE_SPOT', 'BINANCE_FUTURES', 'SOLANA_JUPITER'];
const SCALE = 1e9;
const encode = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const safe = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
const toNumber = (fp: bigint, what: string) => {
  const value = Number(fp) / SCALE;
  if (!Number.isFinite(value) || value < 0) throw new Error(`SIM_INVALID_${what}`);
  return value;
};

interface Book { ts: number; bid: number; ask: number; bidQty: number; askQty: number }
interface Pending { signalTs: number; dueTs: number; regime: string; stop: number; targets: { r: number; fraction: number }[]; trailAfterR: number | null; maxHoldBars: number }
interface Position { st: ExitState; signalTs: number; entryTs: number; regime: string; cost: number; proceeds: number; fees: number; heldCandles: number }

export async function simulateSession(
  strategy: StrategyDef, candles: readonly Candle[],
  tape: AsyncIterable<HistoricalEvent> | Iterable<HistoricalEvent>, options: Readonly<SessionSimulationOptions>,
): Promise<SessionSimulationReport> {
  const o = { ...options };
  if (!VENUES.includes(o.venue) || !/^[A-Za-z0-9._:/-]{1,128}$/.test(o.symbol) ||
      !(Number.isFinite(o.startingCashUsd) && o.startingCashUsd > 0 && o.startingCashUsd <= 1e12) ||
      !safe(o.latencyMs, 1, 86_400_000) || !safe(o.maxWaitMs, 0, 86_400_000) || !safe(o.slippageBps, 0, 1_000) ||
      (o.stepSize !== undefined && !(Number.isFinite(o.stepSize) && o.stepSize > 0))) throw new Error('INVALID_SIMULATION_OPTIONS');
  const policy = RiskPolicy.parse(o.policy ?? DEFAULT_POLICY);
  const limits = LIMITS.parse({ capitalCeilingUsd: o.capitalCeilingUsd, maxSessionLossUsd: o.maxSessionLossUsd });
  if (limits.capitalCeilingUsd > o.startingCashUsd) throw new Error('MANDATE_CAPITAL_EXCEEDS_FUNDS');
  assertStrategyHistory(strategy.interval, candles);

  const duration = INTERVAL_MS[strategy.interval];
  const fee = policy.feeRate, slip = o.slippageBps / 10_000;
  const digest = createHash('sha256');
  digest.update(encode({ version: 1, strategy: [strategy.id, strategy.version], options: { ...o, policy }, candles: candles.length,
    firstCandle: candles[0]?.t ?? null, lastCandle: candles.at(-1)?.t ?? null }) + '\n');
  const engine = new FeatureEngine();
  const records: SimulationRecord[] = [];
  const rejections: Record<string, number> = {};
  const trades: SimulatedTrade[] = [];
  let recordsDropped = 0, clock = -1, from: number | null = null, eventsProcessed = 0, booksUsed = 0, candleIndex = 0;
  let cash = o.startingCashUsd, equity = cash, peak = cash, maxDrawdownUsd = 0, maxDrawdownPct = 0;
  let signals = 0, entries = 0, exitsDeferred = 0;
  // Union-typed initializers: these are mutated inside the closures below, so TypeScript must not narrow them to null.
  let pending = null as Pending | null, position = null as Position | null, lastBook = null as Book | null;
  let lossLimit = null as SessionSimulationReport['lossLimit'];

  const record = (kind: SimulationRecordKind, detail: string) => {
    const row = { ts: clock, kind, detail };
    digest.update(encode(row) + '\n');
    if (records.length < MAX_RECORDS) records.push(row); else recordsDropped++;
  };
  const reject = (reason: string, detail = '') => {
    pending = null;
    rejections[reason] = (rejections[reason] ?? 0) + 1;
    record('ENTRY_REJECTED', detail ? `${reason}: ${detail}` : reason);
  };

  /** A candle is processed only once the virtual clock has reached its close boundary. */
  function closeCandle(candle: Candle) {
    engine.ingest([candle]);
    if (position) { position.heldCandles++; position.st.barsHeld++; return; }
    if (pending) return;
    const features = engine.last;
    if (!features || features.n < 210) return;
    const { regime } = classifyRegime(features);
    if (!strategy.suitableRegimes.includes(regime)) return;
    const signal = strategy.generate(features);
    if (!signal) return;
    const signalTs = candle.t + duration;
    signals++;
    pending = { signalTs, dueTs: signalTs + o.latencyMs, regime, stop: signal.stop, targets: signal.targets,
      trailAfterR: signal.trailAfterR, maxHoldBars: signal.maxHoldBars };
    record('SIGNAL', `${strategy.id} close ${signal.entryRef} stop ${signal.stop}`);
    // After a loss-limit breach signals are still evaluated and recorded, but never traded.
    if (lossLimit) reject('SESSION_LOSS_LIMIT_REACHED');
  }

  function enter(book: Book) {
    const p = pending!;
    if (lossLimit) return reject('SESSION_LOSS_LIMIT_REACHED');
    const spreadBps = ((book.ask - book.bid) / ((book.ask + book.bid) / 2)) * 10_000;
    if (!(spreadBps <= policy.maxSpreadBps)) return reject('SPREAD', `${spreadBps.toFixed(1)}bps > ${policy.maxSpreadBps}`);
    if (o.slippageBps > policy.maxSlippageBps) return reject('SLIPPAGE', `${o.slippageBps}bps > ${policy.maxSlippageBps}`);
    const fill = book.ask * (1 + slip);
    if (!(fill > p.stop)) return reject('PRICE_THROUGH_STOP');
    // Entries happen only while flat, so equity is the simulated cash balance.
    const sizing = simulatedEntrySizing(policy, cash, cash, book.ask, p.stop, o.stepSize);
    if (!(sizing.qty > 0) || sizing.qty * book.ask < 5) return reject('SIZE_BELOW_VENUE_MINIMUM');
    if (sizing.qty > book.askQty) return reject('INSUFFICIENT_DEPTH', `need ${sizing.qty}, ask shows ${book.askQty}`);
    const notional = fill * sizing.qty;
    if (notional > sizing.maxNotional + 1e-9) return reject('POSITION_NOTIONAL_LIMIT');
    const plannedMaxLoss = sizing.qty * (fill - sizing.conservativeStopFill + fee * (fill + sizing.conservativeStopFill));
    if (!(plannedMaxLoss > 0) || plannedMaxLoss > sizing.riskBudget + 1e-9) return reject('EXECUTED_TRADE_RISK_LIMIT');
    const entryFee = notional * fee;
    // Canonical mandate ceiling (flat account: no open cost, so capital in use is the net realized loss).
    const realizedLoss = Math.max(0, o.startingCashUsd - cash);
    if (realizedLoss + notional + entryFee > limits.capitalCeilingUsd + 1e-9) {
      return reject('MANDATE_CAPITAL_CEILING', `realized loss ${realizedLoss.toFixed(2)} + entry ${(notional + entryFee).toFixed(2)} > ${limits.capitalCeilingUsd.toFixed(2)}`);
    }
    if (limits.maxSessionLossUsd !== undefined) {
      const worst = (cash - o.startingCashUsd) - plannedMaxLoss;
      if (worst < -limits.maxSessionLossUsd - 1e-9) {
        return reject('SESSION_LOSS_HEADROOM', `worst case ${worst.toFixed(2)} if the stop is hit < -${limits.maxSessionLossUsd.toFixed(2)}`);
      }
    }
    if (notional + entryFee > cash + 1e-9) return reject('INSUFFICIENT_CASH');
    cash -= notional + entryFee;
    position = { st: newExitState(fill, p.stop, sizing.qty, p.targets, p.trailAfterR, p.maxHoldBars), signalTs: p.signalTs,
      entryTs: book.ts, regime: p.regime, cost: notional, proceeds: 0, fees: entryFee, heldCandles: 0 };
    pending = null;
    entries++;
    record('ENTRY', `qty ${sizing.qty} @ ${fill} (ask ${book.ask}), planned max loss ${plannedMaxLoss.toFixed(2)}`);
  }

  function manage(book: Book) {
    const pos = position!;
    const next = structuredClone(pos.st);
    const fills = stepExit(next, { o: book.bid, h: book.bid, l: book.bid, c: book.bid }, slip, false);
    if (!fills.length) { pos.st = next; return; }
    const sold = fills.reduce((total, f) => total + f.qty, 0);
    if (sold > book.bidQty + 1e-12) {
      exitsDeferred++;
      record('EXIT_DEFERRED', `${fills.map((f) => f.reason).join('+')} needs ${sold}, bid shows ${book.bidQty}`);
      return; // never invent a fill: keep the previous state and retry on a later observation
    }
    pos.st = next;
    for (const f of fills) {
      // The exit capsule already prices stops at the bid less slippage; targets and time exits arrive at the touch.
      const price = f.reason === 'TARGET' || f.reason === 'TIME' ? f.price * (1 - slip) : f.price;
      const proceeds = price * f.qty, exitFee = proceeds * fee;
      cash += proceeds - exitFee;
      pos.proceeds += proceeds; pos.fees += exitFee;
      record('EXIT', `${f.reason} ${f.qty} @ ${price}`);
    }
    if (next.qtyLeft > 1e-12) return;
    const netPnlUsd = pos.proceeds - pos.cost - pos.fees;
    const riskUsd = (next.entry - next.initialStop) * next.qtyInit;
    trades.push({ signalTs: pos.signalTs, entryTs: pos.entryTs, exitTs: book.ts, qty: next.qtyInit, entryPrice: next.entry,
      proceedsUsd: pos.proceeds, feesUsd: pos.fees, netPnlUsd, r: netPnlUsd / riskUsd, reason: fills.at(-1)!.reason,
      regime: pos.regime, heldCandles: pos.heldCandles });
    position = null;
  }

  function mark(book: Book) {
    equity = cash + (position ? position.st.qtyLeft * book.bid * (1 - fee) : 0);
    peak = Math.max(peak, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    const pnl = equity - o.startingCashUsd;
    if (!lossLimit && limits.maxSessionLossUsd !== undefined && pnl <= -limits.maxSessionLossUsd) {
      lossLimit = { reachedAt: book.ts, sessionPnlUsd: pnl };
      record('LOSS_LIMIT_REACHED', `session P&L ${pnl.toFixed(2)} <= -${limits.maxSessionLossUsd}`);
      if (pending) reject('SESSION_LOSS_LIMIT_REACHED');
    }
  }

  for await (const event of tape) {
    if (!safe(event.tsMs, 0, Number.MAX_SAFE_INTEGER) || event.tsMs < clock) throw new Error('SIM_NON_MONOTONIC');
    clock = event.tsMs; from ??= clock; eventsProcessed++;
    digest.update(encode(event) + '\n');
    while (candleIndex < candles.length && candles[candleIndex].t + duration <= clock) {
      const closeTs = candles[candleIndex].t + duration;
      // Candle closes are points on the virtual clock too: a signal that could no longer execute must not block a newer one.
      if (pending && closeTs - pending.dueTs > o.maxWaitMs) reject('EXPIRED');
      closeCandle(candles[candleIndex++]);
    }
    if (pending && clock - pending.dueTs > o.maxWaitMs) reject('EXPIRED');
    if (event.type !== 'BOOK_TICK' || event.venue !== o.venue || event.symbol !== o.symbol) continue;
    const book: Book = { ts: clock, bid: toNumber(event.bidFp, 'BID'), ask: toNumber(event.askFp, 'ASK'),
      bidQty: toNumber(event.bidQtyFp, 'BID_QTY'), askQty: toNumber(event.askQtyFp, 'ASK_QTY') };
    if (!(book.bid > 0) || book.ask < book.bid) throw new Error('SIM_INVALID_BOOK');
    booksUsed++;
    lastBook = book;
    // Protection before new risk: manage the open position, then consider a due entry, then mark the session.
    if (position) manage(book);
    if (pending && clock >= pending.dueTs) enter(book);
    mark(book);
  }

  const warnings: string[] = ['Research only: caller-supplied tape and candles are not authenticated venue evidence.'];
  if (pending) reject('END_OF_TAPE');
  let openPosition: SessionSimulationReport['openPosition'] = null;
  if (position) {
    const pos = position as Position;
    openPosition = { entryTs: pos.entryTs, qtyLeft: pos.st.qtyLeft, entryPrice: pos.st.entry, stop: pos.st.stop,
      markValueUsd: lastBook ? pos.st.qtyLeft * lastBook.bid * (1 - fee) : 0 };
    warnings.push('The tape ends with an open position; it is valued at the last bid less the exit fee, not closed.');
  }
  if (!booksUsed) warnings.push('No book observations matched the venue and symbol.');
  if (trades.length < 30) warnings.push(`only ${trades.length} closed trades — not statistically meaningful`);
  if (exitsDeferred) warnings.push(`${exitsDeferred} exit attempts were deferred for lack of displayed bid depth.`);
  if (rejections.POSITION_NOTIONAL_LIMIT) {
    warnings.push(`${rejections.POSITION_NOTIONAL_LIMIT} entries were refused because the executed notional exceeded the position cap `
      + '(the cap is sized at the worst permitted entry, so this indicates a fill worse than the slippage policy).');
  }
  const tradeStats = stats(trades.map((t) => ({ entryT: t.entryTs, exitT: t.exitTs, entry: t.entryPrice, exit: t.proceedsUsd,
    r: t.r, reason: t.reason, regime: t.regime, segment: 'OOS' as const, bars: t.heldCandles, mfe: 0, mae: 0 })));
  const report = {
    version: 1 as const, evidence: 'RESEARCH_UNVERIFIED_TAPE' as const, tradingAuthority: false as const,
    strategyId: strategy.id, strategyVersion: strategy.version, venue: o.venue, symbol: o.symbol,
    from, to: from === null ? null : clock, eventsProcessed, booksUsed, candlesUsed: candleIndex,
    startingEquityUsd: o.startingCashUsd, endingEquityUsd: equity, netPnlUsd: equity - o.startingCashUsd,
    maxDrawdownUsd, maxDrawdownPct, signals, entries, rejections, exitsDeferred, trades, tradeStats, lossLimit, openPosition,
    records, recordsDropped, warnings,
  };
  digest.update(encode({ ...report, records: undefined }) + '\n');
  return { ...report, determinismHash: digest.digest('hex') };
}
