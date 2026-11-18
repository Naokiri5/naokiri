import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { modeGate } from '../src/qa/gates.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { submitEntry } from '../src/exec/oms.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { run, get } from '../src/db/db.js';

/** E-01 (100-agent audit, Squad E): the production reconcile must catch orphan or edited cash, not only closed-PnL drift. */
let seq = 0;
const report = (id: string, last: number): any => ({ id: `dec_r${++seq}`, candidateId: `cand_r${seq}`, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
  entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
  consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() }, decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } });

describe('reconcile integrity (E-01)', () => {
  beforeEach(() => {
    freshDb(); market.reset(); const { inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any;
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    expect(reconcile().ok).toBe(true);
  });
  it('an orphan fee posting (no order) is not reconciled', () => {
    ledger(PAPER_ACCOUNT, 'FEE', -123.45, undefined, 'orphan');
    const r = reconcile(); expect(r.ok).toBe(false); expect(r.orphanPostings).toBe(1);
  });
  it('an edited trade posting no longer matches its fill', () => {
    run("UPDATE ledger_entries SET amount = amount - 50 WHERE id = (SELECT id FROM ledger_entries WHERE kind='BUY' LIMIT 1)");
    const r = reconcile(); expect(r.ok).toBe(false); expect(r.cashVsFillsDifference).toBeCloseTo(50, 6);
  });
  it('deposits and withdrawals alone never break reconciliation', () => {
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 500); ledger(PAPER_ACCOUNT, 'WITHDRAW', -200);
    expect(reconcile().ok).toBe(true);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM ledger_entries')!.n).toBeGreaterThan(3);
  });
  it('R-01: deleting an open entry\'s postings is not reconciled', () => {
    run("DELETE FROM ledger_entries WHERE kind IN ('BUY','FEE')");
    const r = reconcile(); expect(r.ok).toBe(false); expect(r.unpostedOrders).toBe(1);
  });
});
