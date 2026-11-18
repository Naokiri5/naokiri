import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { modeGate } from '../src/qa/gates.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions } from '../src/exec/oms.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { run, get } from '../src/db/db.js';

/** E-02 / E-03 (100-agent audit, Squad E). */
let seq = 0;
const report = (id: string, last: number, fractions: number[]): any => ({ id: `dec_x${++seq}`, candidateId: `cand_x${seq}`, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
  entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: fractions[0], r: 1.5 }, { price: last * 1.09, fraction: fractions[1], r: 3 }],
  consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() }, decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } });

describe('exit edge cases', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('E-03: invalid take-profit fractions are rejected at entry', () => {
    for (const f of [[-1, 0.5], [Number.NaN, 0.5], [0.7, 0.7]]) {
      const r = submitEntry(report(id, last, f), 'bot');
      expect(r.ok).toBe(false); expect(r.reason).toMatch(/INVALID_TARGET_FRACTIONS/);
    }
    expect(openPositions()).toHaveLength(0);
  });
  it('E-02: a target and the max-hold time in the same pass close the position completely', () => {
    expect(submitEntry(report(id, last, [0.333, 0.667]), 'bot').ok).toBe(true);
    const p = openPositions()[0];
    run('UPDATE positions SET opened_at=?, max_hold_ms=? WHERE id=?', Date.now() - 10_000, 1_000, p.id); // max hold elapsed
    setBook(id, last * 1.05); // first target reached in the same pass
    monitorPositions();
    const after = get<{ status: string; qty: number }>('SELECT status, qty FROM positions WHERE id=?', p.id)!;
    expect(after).toEqual({ status: 'CLOSED', qty: 0 }); // was OPEN with a one-lot remainder
    expect(reconcile().ok).toBe(true);
  });
});
