import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { all, closeDb, run } from '../src/db/db.js';
import { QUALITY_LIMITS } from '../src/market/quality.js';
import { market } from '../src/market/store.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { portfolioStress } from '../src/portfolio/stress.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const BTC = 'crypto:binance:BTCUSDT';
const ETH = 'crypto:binance:ETHUSDT';
function position(id: string, instrument: string, qty: number, account = PAPER_ACCOUNT, status = 'OPEN') {
  run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,planned_risk)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, account, instrument, 'crypto', 'LONG', 'trend_pullback', qty, 80, 75, 75, '{}', status, NOW - 3600000, 10);
}

describe('paper portfolio scenario stress', () => {
  beforeEach(() => { freshDb(); market.reset(); });
  afterEach(() => { closeDb(); market.reset(); });

  it('values the current paper positions, computes a shock and depeg, and leaves the ledger untouched', () => {
    seedInstrument('BTCUSDT', { nowTs: NOW }); setBook(BTC, 100, NOW);
    seedInstrument('ETHUSDT', { nowTs: NOW }); setBook(ETH, 50, NOW);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 300);
    ledger('other-account', 'DEPOSIT', 2000);
    position('open-btc', BTC, 2);
    position('open-eth', ETH, 2);
    position('unrelated', BTC, 5, 'other-account');
    position('closed', ETH, 5, PAPER_ACCOUNT, 'CLOSED');
    const before = ['positions', 'ledger_entries', 'settings'].map(table => all(`SELECT * FROM ${table}`));

    const result = portfolioStress(NOW);
    expect(result).toMatchObject({ asOf: NOW, account: PAPER_ACCOUNT, cash: 300, baselineEquity: 600 });
    // seedInstrument supplies enough closed 4h candles; a valid research estimate is expected.
    expect(result.tailRisk).toMatchObject({ status: 'ESTIMATED', horizon: '4H', authority: 'RESEARCH_ONLY' });
    expect(result.tailRisk.observations).toBeGreaterThanOrEqual(90);
    expect(result.tailRisk.varLoss).toBeGreaterThanOrEqual(0);
    expect(result.positions).toEqual([
      { instrument: BTC, qty: 2, positionCount: 1, mark: 100, markAt: NOW, value: 200, equityPct: expect.closeTo(100 / 3), reason: null },
      { instrument: ETH, qty: 2, positionCount: 1, mark: 50, markAt: NOW, value: 100, equityPct: expect.closeTo(50 / 3), reason: null },
    ]);
    expect(result.scenarios.find(s => s.id === 'FLASH_CRASH')).toMatchObject({
      status: 'MODELED', loss: 75, equityLossPct: 12.5, affectedPositions: 2,
      largestHolding: { instrument: BTC, baselineEquityPct: expect.closeTo(100 / 3), stressedEquityPct: expect.closeTo(200 / 7) },
    });
    expect(result.scenarios.find(s => s.id === 'USDT_DEPEG')).toMatchObject({ status: 'MODELED', loss: 30, equityLossPct: 5, affectedPositions: 0 });
    expect(result.scenarios.find(s => s.id === 'VENUE_OUTAGE')).toMatchObject({ status: 'UNAVAILABLE', loss: null, unpricedValue: 300 });
    expect(result.scenarios.find(s => s.id === 'SECTOR_DRAWDOWN')).toMatchObject({ status: 'UNAVAILABLE', loss: null });
    expect(portfolioStress(NOW)).toEqual(result);
    expect(['positions', 'ledger_entries', 'settings'].map(table => all(`SELECT * FROM ${table}`))).toEqual(before);
  });

  it('requires fresh timestamps on both the provider event and local receipt', () => {
    seedInstrument('BTCUSDT', { nowTs: NOW }); setBook(BTC, 100, NOW);
    position('open-btc', BTC, 2);
    const t = market.tickers.get(BTC)!;
    t.providerTs = NOW - QUALITY_LIMITS.maxQuoteAgeMs - 1;
    expect(portfolioStress(NOW)).toMatchObject({
      baselineEquity: null,
      positions: [{ value: null, mark: null, markAt: null, reason: expect.stringContaining('timestamps') }],
      scenarios: expect.arrayContaining([{ id: 'FLASH_CRASH', label: 'Flash crash', status: 'UNAVAILABLE', assumption: expect.any(String),
        loss: null, equityLossPct: null, affectedPositions: 1, reason: expect.any(String) }]),
    });
    t.providerTs = NOW + 1;
    expect(portfolioStress(NOW).positions[0].mark).toBeNull();
    t.providerTs = NOW;
    t.receivedAt = NOW - QUALITY_LIMITS.maxQuoteAgeMs - 1;
    expect(portfolioStress(NOW).positions[0].mark).toBeNull();
  });

  it('combines positions before estimating visible liquidation cost or missing liquidity', () => {
    seedInstrument('BTCUSDT', { nowTs: NOW }); setBook(BTC, 100, NOW);
    market.deep.get(BTC)!.book = { ts: NOW, bids: [[99, 10]], asks: [[101, 10]] };
    position('open-btc', BTC, 0.75);
    position('second-btc', BTC, 0.75);

    const result = portfolioStress(NOW);
    expect(result.positions).toMatchObject([{ instrument: BTC, qty: 1.5, positionCount: 2, value: 150 }]);
    expect(result.scenarios.find(s => s.id === 'SPREAD_EXPANSION')).toMatchObject({ status: 'MODELED', loss: 4.5, unpricedValue: 0 });
    expect(result.scenarios.find(s => s.id === 'LIQUIDITY_COLLAPSE')).toMatchObject({ status: 'PARTIAL', loss: null, unpricedValue: 50 });
  });

  it('does not use a stale book even when its ticker mark is fresh', () => {
    seedInstrument('BTCUSDT', { nowTs: NOW });
    setBook(BTC, 100, NOW);
    const book = market.deep.get(BTC)!.book!;
    book.ts = NOW - QUALITY_LIMITS.maxExecBookAgeMs - 1;
    position('open-btc', BTC, 2);
    const result = portfolioStress(NOW);
    expect(result.baselineEquity).toBe(200);
    expect(result.scenarios.find(s => s.id === 'SPREAD_EXPANSION')).toMatchObject({
      status: 'UNAVAILABLE', loss: null, equityLossPct: null, unpricedValue: 200,
    });
  });

  it('reports zero market exposure on a cash-only account', () => {
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 100);
    const result = portfolioStress(NOW);
    expect(result.positions).toEqual([]);
    expect(result.scenarios.find(s => s.id === 'FLASH_CRASH')).toMatchObject({ status: 'NO_EXPOSURE', loss: 0, equityLossPct: 0 });
    expect(result.scenarios.find(s => s.id === 'USDT_DEPEG')).toMatchObject({ status: 'MODELED', loss: 10, equityLossPct: 10 });
  });
});
