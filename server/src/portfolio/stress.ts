import { bookAge, QUALITY_LIMITS, walkBook } from '../market/quality.js';
import { market } from '../market/store.js';
import { cashBalance, openPositions, PAPER_ACCOUNT, type PositionRow } from './ledger.js';

type StressStatus = 'MODELED' | 'PARTIAL' | 'UNAVAILABLE' | 'NO_EXPOSURE';
interface StressScenario {
  id: string;
  label: string;
  status: StressStatus;
  assumption: string;
  loss: number | null;
  equityLossPct: number | null;
  affectedPositions: number;
  reason: string | null;
  unpricedValue?: number | null;
  largestHolding?: { instrument: string; baselineEquityPct: number; stressedEquityPct: number } | null;
}

interface PositionMark {
  instrument: string;
  qty: number;
  positionCount: number;
  mark: number | null;
  markAt: number | null;
  value: number | null;
  equityPct: number | null;
  reason: string | null;
}

const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

function markPosition({ instrument, qty, market: positionMarket, direction }: PositionRow, asOf: number): PositionMark {
  const inst = market.instruments.get(instrument);
  const t = market.tickers.get(instrument);
  const row: PositionMark = { instrument, qty, positionCount: 1, mark: null, markAt: null, value: null, equityPct: null, reason: null };
  if (direction !== 'LONG' || !finitePositive(qty)) {
    return { ...row, reason: 'Position direction or quantity is unsupported' };
  }
  if (positionMarket !== 'crypto' || inst?.market !== 'crypto' || inst.venue !== 'binance' || inst.quote !== 'USDT') {
    return { ...row, reason: 'No supported Binance spot USDT mark for the position' };
  }
  if (!t || t.instrumentId !== instrument || t.symbol !== inst.symbol || t.base !== inst.base || t.quote !== inst.quote || t.source !== inst.venue) {
    return { ...row, reason: 'Missing or mismatched primary ticker' };
  }
  const oldest = asOf - QUALITY_LIMITS.maxQuoteAgeMs;
  const freshTimestamp = (at: number) => Number.isFinite(at) && at >= 0 && at >= oldest && at <= asOf;
  if (!freshTimestamp(t.providerTs) || !freshTimestamp(t.receivedAt) || t.providerTs > t.receivedAt + QUALITY_LIMITS.clockSkewMs) {
    return { ...row, reason: 'Ticker observation is stale or has inconsistent timestamps' };
  }
  const value = qty * t.last;
  if (!finitePositive(t.last) || !Number.isFinite(value)) {
    return { ...row, reason: 'Invalid primary ticker price or position value' };
  }
  return { ...row, mark: t.last, markAt: t.providerTs, value };
}

function positionMarks(positions: readonly PositionRow[], asOf: number): PositionMark[] {
  const marks = new Map<string, PositionMark>();
  for (const p of positions) {
    const row = markPosition(p, asOf);
    const previous = marks.get(row.instrument);
    if (!previous) {
      marks.set(row.instrument, row);
      continue;
    }
    // Simulate one liquidation per instrument so overlapping positions share the same depth.
    const qty = previous.qty + row.qty;
    const value = qty * (row.mark ?? 0);
    const reason = previous.reason ?? row.reason ?? (!Number.isFinite(value) ? 'Invalid aggregate position value' : null);
    marks.set(row.instrument, {
      ...row, qty, positionCount: previous.positionCount + 1, reason,
      mark: reason ? null : row.mark, markAt: reason ? null : row.markAt, value: reason ? null : value,
    });
  }
  return [...marks.values()];
}

function spreadCost(row: PositionMark, asOf: number, spreadMultiplier: number, depthMultiplier: number) {
  const book = market.deep.get(row.instrument)?.book;
  const age = bookAge(book, asOf);
  if (!book || age === null || age > QUALITY_LIMITS.maxExecBookAgeMs || row.mark === null) {
    return { loss: null, unpricedValue: row.value };
  }
  const halfSpread = (book.asks[0][0] - book.bids[0][0]) / 2;
  const expansion = halfSpread * (spreadMultiplier - 1);
  const widened = {
    ...book,
    bids: book.bids.map(([price, qty]): [number, number] => [price - expansion, qty * depthMultiplier]).filter(([price]) => finitePositive(price)),
    asks: book.asks.map(([price, qty]): [number, number] => [price + expansion, qty * depthMultiplier]),
  };
  const walk = walkBook(widened, 'sell', row.qty);
  if (!walk) return { loss: null, unpricedValue: row.value };
  const loss = Math.max(0, (walk.mid - walk.avgPrice) * walk.filledQty);
  return {
    loss: Number.isFinite(loss) ? loss : null,
    unpricedValue: walk.filledFully ? 0 : Math.max(0, row.qty - walk.filledQty) * row.mark,
  };
}

/** Research-only point-in-time projection over the paper ledger and existing cached observations. */
export function portfolioStress(asOf = Date.now()) {
  const cash = cashBalance();
  const open = openPositions();
  const positions = positionMarks(open, asOf);
  const total = positions.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const allMarked = positions.every(row => row.value !== null) && Number.isFinite(total);
  const baselineEquity = allMarked && Number.isFinite(cash + total) ? cash + total : null;
  for (const row of positions) {
    if (row.value !== null && baselineEquity !== null && baselineEquity > 0) row.equityPct = (row.value / baselineEquity) * 100;
  }

  const largest = positions.reduce<PositionMark | undefined>((best, row) =>
    row.value !== null && (best?.value == null || row.value > best.value) ? row : best, undefined);
  const concentration = (positionMultiplier: number, loss: number) => {
    if (largest?.value == null || largest.equityPct === null || baselineEquity === null || baselineEquity <= loss) return null;
    return {
      instrument: largest.instrument,
      baselineEquityPct: largest.equityPct,
      stressedEquityPct: (largest.value * positionMultiplier / (baselineEquity - loss)) * 100,
    };
  };

  const scenario = (id: string, label: string, assumption: string, status: StressStatus, loss: number | null,
    affectedPositions: number, reason: string | null = null): StressScenario => ({
    id, label, assumption, status, loss, affectedPositions, reason,
    equityLossPct: loss !== null && baselineEquity !== null && baselineEquity > 0 ? (loss / baselineEquity) * 100 : null,
  });
  const priceShock = (id: string, label: string, declinePct: number) => {
    const assumption = `All supported spot marks fall together by ${declinePct}%. Quote cash is held constant.`;
    if (!open.length) return scenario(id, label, assumption, 'NO_EXPOSURE', 0, 0);
    if (!allMarked) return scenario(id, label, assumption, 'UNAVAILABLE', null, open.length, 'At least one position lacks a usable mark');
    const loss = total * (declinePct / 100);
    return {
      ...scenario(id, label, assumption, 'MODELED', loss, open.length),
      largestHolding: concentration(1 - declinePct / 100, loss),
    };
  };
  const liquidityShock = (id: string, label: string, assumption: string, spreadMultiplier: number, depthMultiplier: number) => {
    if (!open.length) return { ...scenario(id, label, assumption, 'NO_EXPOSURE', 0, 0), unpricedValue: 0 };
    const exposures = positions.map(row => spreadCost(row, asOf, spreadMultiplier, depthMultiplier));
    const unpriced = exposures.reduce((sum, row) => sum + (row.unpricedValue ?? 0), 0);
    const unpricedValue = exposures.every(row => row.unpricedValue !== null) && Number.isFinite(unpriced) ? unpriced : null;
    const priced = exposures.some(row => row.loss !== null);
    const loss = exposures.reduce((sum, row) => sum + (row.loss ?? 0), 0);
    const complete = exposures.every(row => row.loss !== null && row.unpricedValue === 0);
    // Costs for the visible portion are not a portfolio estimate when depth cannot cover all holdings.
    if (!priced || !Number.isFinite(loss)) return { ...scenario(id, label, assumption, 'UNAVAILABLE', null, open.length, 'No usable stressed liquidation prices'), unpricedValue };
    if (!complete) return { ...scenario(id, label, assumption, 'PARTIAL', null, open.length, 'At least one holding exceeds usable stressed depth'), unpricedValue };
    return { ...scenario(id, label, assumption, 'MODELED', loss, open.length), unpricedValue };
  };
  const outage = 'All Binance liquidity is unavailable. Holding values measure exposure; no liquidation price is estimated.';
  const depeg = 'At assumed initial USD parity, USDT paper cash loses 10% of its USD purchasing power. Noncash holdings keep their USD value.';
  const scenarios = [
    priceShock('FLASH_CRASH', 'Flash crash', 25),
    priceShock('MARKET_GAP', 'Downward gap', 12),
    liquidityShock('SPREAD_EXPANSION', 'Spread expansion', 'Spread triples around the current book midpoint at unchanged visible size. Cost is relative to midpoint, before fees.', 3, 1),
    liquidityShock('LIQUIDITY_COLLAPSE', 'Liquidity collapse', 'Only 10% of visible size remains at each current book level. Cost is relative to midpoint, before fees.', 1, 0.1),
    Number.isFinite(cash) && cash >= 0
      ? {
        ...scenario('USDT_DEPEG', 'USDT cash depeg', depeg, cash > 0 ? 'MODELED' : 'NO_EXPOSURE', cash * 0.1, 0),
        largestHolding: concentration(1, cash * 0.1),
      }
      : scenario('USDT_DEPEG', 'USDT cash depeg', depeg, 'UNAVAILABLE', null, 0, 'Paper cash is unavailable for the assumed depeg'),
    {
      ...scenario('VENUE_OUTAGE', 'Binance outage', outage, open.length ? 'UNAVAILABLE' : 'NO_EXPOSURE', open.length ? null : 0, open.length,
        open.length ? 'No executable venue prices under the outage assumption' : null),
      unpricedValue: allMarked ? total : null,
    },
    scenario('SECTOR_DRAWDOWN', 'Sector drawdown', 'Apply a shared shock to positions in a verified sector.', open.length ? 'UNAVAILABLE' : 'NO_EXPOSURE',
      open.length ? null : 0, 0, open.length ? 'Verified sector exposure is unavailable for this account' : null),
    priceShock('CORRELATION_SPIKE', 'Common downside shock', 20),
    priceShock('MACRO_SHOCK', 'Broad macro shock', 15),
    scenario('MEMECOIN_DRAIN', 'Memecoin liquidity drain', 'Reduce liquidity for verified memecoin positions.', open.length ? 'UNAVAILABLE' : 'NO_EXPOSURE',
      open.length ? null : 0, 0, open.length ? 'Verified memecoin classification and pool liquidity are unavailable for this account' : null),
  ];

  return {
    asOf, account: PAPER_ACCOUNT, cash, baselineEquity, positions, scenarios,
    note: 'Hypothetical paper estimates in USDT or assumed parity for the depeg scenario. Percentages use baseline equity. Scenarios are independent, exclude fees and carry no order or risk-policy authority.',
  };
}
