import type { Book } from '../providers/binance.js';
import type { readSpotTradeTape } from '../whales/prints.js';
import type { DepthExhaustionResearch } from './cexActivityTypes.js';
import { bookAge } from './quality.js';

const FLOW_WINDOW_MS = 3_000;
const BAND_BPS = 15;
const DEPTH_RATIO = 3;
type Tape = Pick<ReturnType<typeof readSpotTradeTape>, 'source' | 'polledAt' | 'trades'>;

/** Research observation using the visible book and a complete, event-time-aligned trade window. */
export function measureDepthExhaustion(book: Book | null, tape: Tape | null, asOf: number): DepthExhaustionResearch {
  const age = bookAge(book, asOf);
  if (!book || age === null || age > FLOW_WINDOW_MS) return { status: 'UNAVAILABLE', reason: 'BOOK_UNAVAILABLE' };
  if (!book.source || book.lastUpdateId === undefined || !Number.isSafeInteger(book.lastUpdateId) || book.lastUpdateId <= 0) {
    return { status: 'UNAVAILABLE', reason: 'BOOK_PROVENANCE_MISSING' };
  }
  const mid = book.bids[0][0] / 2 + book.asks[0][0] / 2;
  const floor = mid * (1 - BAND_BPS / 10_000), ceiling = mid * (1 + BAND_BPS / 10_000);
  // A truncated snapshot ending inside the band cannot establish all resting depth in that band.
  if (book.bids.at(-1)![0] > floor || book.asks.at(-1)![0] < ceiling) {
    return { status: 'UNAVAILABLE', reason: 'DEPTH_BAND_INCOMPLETE' };
  }
  const bidDepthQuote = book.bids.reduce((sum, [price, qty]) => price >= floor ? sum + price * qty : sum, 0);
  const askDepthQuote = book.asks.reduce((sum, [price, qty]) => price <= ceiling ? sum + price * qty : sum, 0);
  if (bidDepthQuote <= 0 || askDepthQuote <= 0) return { status: 'UNAVAILABLE', reason: 'DEPTH_BAND_INCOMPLETE' };

  const lastTrade = tape?.trades.at(-1);
  if (!tape || !lastTrade || tape.polledAt === null || tape.polledAt > asOf || asOf - tape.polledAt > FLOW_WINDOW_MS) {
    return { status: 'UNAVAILABLE', reason: 'TRADE_TAPE_UNAVAILABLE' };
  }
  if (tape.trades.some((trade, i) => i > 0 && trade.ts < tape.trades[i - 1].ts)) {
    return { status: 'UNAVAILABLE', reason: 'TRADE_SEQUENCE_INVALID' };
  }
  const flowEndExclusive = Math.min(book.ts, lastTrade.ts);
  const flowStart = flowEndExclusive - FLOW_WINDOW_MS;
  if (asOf - flowEndExclusive > FLOW_WINDOW_MS) return { status: 'UNAVAILABLE', reason: 'TRADE_WINDOW_INCOMPLETE' };

  // Require trades bracketing both boundaries. A capped page starting inside the window has unknown earlier volume.
  const first = tape.trades.findIndex(trade => trade.ts >= flowStart);
  const end = tape.trades.findIndex(trade => trade.ts >= flowEndExclusive);
  if (first <= 0 || end < first) return { status: 'UNAVAILABLE', reason: 'TRADE_WINDOW_INCOMPLETE' };
  let takerDeltaQuote = 0;
  for (let i = first; i <= end; i++) {
    const trade = tape.trades[i], previous = tape.trades[i - 1];
    if (trade.id !== previous.id + 1) return { status: 'UNAVAILABLE', reason: 'TRADE_SEQUENCE_INVALID' };
    if (i < end) takerDeltaQuote += trade.price * trade.qty * (trade.buyerIsMaker ? -1 : 1);
  }
  if (!Number.isFinite(takerDeltaQuote)) return { status: 'UNAVAILABLE', reason: 'TRADE_SEQUENCE_INVALID' };
  const buying = bidDepthQuote / askDepthQuote >= DEPTH_RATIO && takerDeltaQuote > 0;
  const selling = askDepthQuote / bidDepthQuote >= DEPTH_RATIO && takerDeltaQuote < 0;
  return {
    status: 'MEASURED', pressure: buying ? 'BID_DEPTH_AND_BUYING' : selling ? 'ASK_DEPTH_AND_SELLING' : 'NO_ALIGNMENT',
    bookSource: book.source, bookAt: book.ts, bookUpdateId: book.lastUpdateId,
    bidDepthQuote, askDepthQuote, bandBps: BAND_BPS, depthRatioThreshold: DEPTH_RATIO,
    tradeSource: tape.source, polledAt: tape.polledAt, flowStart, flowEndExclusive,
    firstCoverageId: tape.trades[first - 1].id, lastCoverageId: tape.trades[end].id, tradeCount: end - first, takerDeltaQuote,
  };
}
