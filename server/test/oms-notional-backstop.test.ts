/**
 * The OMS re-checks the position notional cap at the executed price. Through the normal depth walk that check cannot
 * fire: the gate sizes the cap at the worst permitted entry, and the slippage check bounds the fill below it. This file
 * forces the fill above the cap through a module seam so the backstop itself stays covered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const seam = vi.hoisted(() => ({ extraSlipFrac: 0 }));
vi.mock('../src/market/quality.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/market/quality.js')>();
  return {
    ...real,
    walkBook: (...args: Parameters<typeof real.walkBook>) => {
      const w = real.walkBook(...args);
      // Inflate only the fill price; impactBps stays inside the slippage policy so the backstop is the guard that acts.
      return w && { ...w, slipFrac: w.slipFrac + seam.extraSlipFrac };
    },
  };
});

const { freshDb, seedInstrument } = await import('./helpers.js');
const { acceptPolicy, DEFAULT_POLICY } = await import('../src/risk/policy.js');
const { updateControl } = await import('../src/core/mode.js');
const { ledger, PAPER_ACCOUNT, accountState, openPositions } = await import('../src/portfolio/ledger.js');
const { submitEntry } = await import('../src/exec/oms.js');
const { market } = await import('../src/market/store.js');
const { all } = await import('../src/db/db.js');

function report(id: string, last: number) {
  return { id: 'dec_backstop', createdAt: new Date().toISOString(), candidateId: 'cand_backstop', traceId: 'tr', asset: id.split(':')[2],
    instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } } as never;
}

describe('OMS notional backstop', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    seam.extraSlipFrac = 0;
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as never);
    acceptPolicy('owner', { ...DEFAULT_POLICY, maxPositionNotionalPct: 1 });
    updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  it('refuses a fill above the cap at the executed price and books nothing', () => {
    // 1% above the best ask exceeds the 20 bps headroom the gate sized for.
    seam.extraSlipFrac = 0.01;
    const result = submitEntry(report(id, last), 'bot');
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/^POSITION_NOTIONAL_LIMIT/);
    expect(openPositions()).toHaveLength(0);
    expect(all('SELECT id FROM fills')).toHaveLength(0);
    expect(all("SELECT id FROM ledger_entries WHERE kind != 'DEPOSIT'")).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });

  it('accepts the same capped entry without the seam', () => {
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: true });
  });
});
