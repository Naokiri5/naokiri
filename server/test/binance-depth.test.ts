import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { refreshBooks } from '../src/market/fabric.js';
import { bookFreshForExecution, walkBook } from '../src/market/quality.js';
import { market } from '../src/market/store.js';
import { seedInstrument } from './helpers.js';

const now = Date.parse('2026-11-27T08:00:00Z');
const snapshot = {
  bids: [['100', '1'], ['99', '1']],
  asks: [['101', '1'], ['102', '1']],
};

describe('Binance spot depth ingress', () => {
  const fetchDepth = vi.fn<typeof fetch>();
  let offline: boolean;

  beforeEach(() => {
    offline = config.offline;
    config.offline = false;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    fetchDepth.mockReset();
    vi.stubGlobal('fetch', fetchDepth);
    market.reset();
  });

  afterEach(() => {
    config.offline = offline;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('invalidates both execution sides when a newer snapshot contains a malformed level', async () => {
    const { inst } = seedInstrument('ETHUSDT');
    const depth = () => market.deep.get(inst.id)!.book;
    fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId: 10 }));
    await refreshBooks([inst.id]);
    expect(bookFreshForExecution(depth())).toBe(true);
    expect(walkBook(depth(), 'buy', 2)).toMatchObject({ filledFully: true, avgPrice: 101.5 });

    vi.setSystemTime(now + 1_000);
    fetchDepth.mockResolvedValueOnce(Response.json({
      ...snapshot,
      asks: [['101', '1'], ['102', 'invalid'], ['103', '1']],
      lastUpdateId: 12,
    }));
    await refreshBooks([inst.id]);
    expect(depth()).toMatchObject({ lastUpdateId: 12, ts: now + 1_000 });
    expect(bookFreshForExecution(depth())).toBe(false);
    expect(walkBook(depth(), 'buy', 2)).toBeNull();
    expect(walkBook(depth(), 'sell', 2)).toBeNull();

    vi.setSystemTime(now + 2_000);
    fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId: 11 }));
    await refreshBooks([inst.id]);
    expect(depth()).toMatchObject({ lastUpdateId: 12 });
    expect(bookFreshForExecution(depth())).toBe(false);

    fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId: 13 }));
    await refreshBooks([inst.id]);
    expect(bookFreshForExecution(depth())).toBe(true);
    expect(walkBook(depth(), 'sell', 2)).toMatchObject({ filledFully: true, avgPrice: 99.5 });
  });

  it('keeps the previous timestamp when the depth request fails at the transport', async () => {
    const { inst } = seedInstrument('ETHUSDT');
    fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId: 10 }));
    await refreshBooks([inst.id]);
    const previous = market.deep.get(inst.id)!.book;

    vi.setSystemTime(now + 1_000);
    fetchDepth.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await refreshBooks([inst.id]);
    expect(market.deep.get(inst.id)!.book).toBe(previous);
    expect(previous).toMatchObject({ lastUpdateId: 10, ts: now });
  });

  it('does not refresh execution depth with a missing or invalid sequence', async () => {
    const { inst } = seedInstrument('ETHUSDT');
    fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId: 10 }));
    await refreshBooks([inst.id]);
    const previous = market.deep.get(inst.id)!.book;

    vi.setSystemTime(now + 1_000);
    for (const lastUpdateId of [undefined, null, false, '20', 10.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId }));
      await refreshBooks([inst.id]);
      expect(market.deep.get(inst.id)!.book).toBe(previous);
    }

    fetchDepth.mockResolvedValueOnce(Response.json({ ...snapshot, lastUpdateId: 11 }));
    await refreshBooks([inst.id]);
    expect(market.deep.get(inst.id)!.book).toMatchObject({ lastUpdateId: 11, ts: now + 1_000 });
  });
});
