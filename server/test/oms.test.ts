import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl, getControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, accountState, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, emergencyStop, closeAllPositions, queueForApproval, decideApproval, listOrders } from '../src/exec/oms.js';
import { reconcile, calendar } from '../src/portfolio/calendar.js';
import { verifyAuditChain } from '../src/core/audit.js';
import { run, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

function report(id: string, last: number, over: Partial<DecisionReport> = {}): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any, ...over } as DecisionReport;
}
describe('Paper OMS lifecycle (Parts 17/20/26/27)', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('enters with book-walk fill, attaches OMS-monitored stop, exits on stop, reconciles', () => {
    const r = submitEntry(report(id, last), 'bot');
    expect(r.ok).toBe(true);
    const pos = openPositions()[0]; expect(pos.entry_price).toBeGreaterThan(last); // paid the ask + impact
    expect(listOrders().some((o: any) => o.purpose === 'PROTECTIVE_STOP' && o.status === 'ACTIVE')).toBe(true);
    // duplicate submit is idempotent
    expect(submitEntry({ ...report(id, last), candidateId: (listOrders().find((o: any) => o.purpose === 'ENTRY') as any).client_order_id.slice(6) }, 'bot').ok).toBe(false);
    setBook(id, last * 0.96); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    const rec = reconcile(); expect(rec.ok).toBe(true); expect(rec.positionsRealized).toBeLessThan(0);
    expect(rec.positionsRealized).toBeGreaterThan(-60); // ≈ planned max loss (0.5% of 10k) incl. fees & gap
    const cal = calendar(new Date().toISOString().slice(0, 7)); expect(cal.summary.trades).toBe(1);
    expect(accountState().equity).toBeCloseTo(10_000 + rec.positionsRealized, 6);
  });
  it('takes partial profit, trails stop to breakeven (never widens), then exits', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    setBook(id, last * 1.05); monitorPositions(); // hits T1 (1.5R) & >1R ⇒ trail
    const p = openPositions()[0]; expect(p.qty).toBeGreaterThan(0); expect(p.stop_price).toBeGreaterThanOrEqual(p.entry_price);
    setBook(id, last * 1.0); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });
  it('rejects expired consensus and bot entries outside PAPER mode', () => {
    expect(submitEntry(report(id, last, { consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 1, opposition: 0, expiresAt: new Date(Date.now() - 1).toISOString() } }), 'bot').reason).toMatch(/EXPIRED/);
    updateControl('owner', { mode: 'APPROVAL' });
    expect(submitEntry(report(id, last), 'bot').ok).toBe(false);
  });
  it('approval workflow: queued → owner approves → filled', () => {
    updateControl('owner', { mode: 'APPROVAL' });
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)', rep.id, rep.candidateId, id, 'crypto', 'LONG', 'trend_pullback', rep.decision, 70, Date.now(), J(rep));
    const oid = queueForApproval(rep)!; expect(oid).toBeTruthy();
    const res = decideApproval(oid, true); expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  });
  it('emergency stop: blocks, cancels, verifies protection, does not auto-close', () => {
    submitEntry(report(id, last), 'bot');
    const e = emergencyStop('owner');
    expect(getControl().emergency).toBe(true); expect(e.close).toBe('NOT_REQUESTED'); expect(e.protect.state).toBe('CONFIRMED');
    expect(openPositions()).toHaveLength(1);
    expect(() => closeAllPositions('trader-joe', 'CLOSE ALL')).toThrow();
    expect(() => closeAllPositions('owner', 'yes')).toThrow(/confirmation/);
    expect(closeAllPositions('owner', 'CLOSE ALL').state).toBe('CONFIRMED');
    expect(verifyAuditChain().ok).toBe(true);
  });
});
