import { describe, it, expect, beforeEach } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl, getControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, accountState, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, emergencyStop, closeAllPositions, closePosition, executeExit, queueForApproval, decideApproval, listOrders, listPositions, cancelPendingEntries, expireApprovals, paperEntryForDecision } from '../src/exec/oms.js';
import { executionAdapter, LiveLockedError, environmentsOverview } from '../src/exec/environment.js';
import { tradingHistory } from '../src/journal/history.js';
import { reconcile, calendar } from '../src/portfolio/calendar.js';
import { verifyAuditChain } from '../src/core/audit.js';
import { run, all, get, J } from '../src/db/db.js';
import { walkBook, QUALITY_LIMITS } from '../src/market/quality.js';
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
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('routes paper via the existing OMS adapter and refuses live without touching financial state', () => {
    const environments = environmentsOverview();
    expect(environments.map(x => x.environment)).toEqual(['PAPER', 'LIVE']);
    expect(environments[0].state).toBe('ACTIVE');
    expect(environments[1].state).toBe('LOCKED');

    const paper = executionAdapter('PAPER');
    const entry = paper.submitEntry(report(id, last), 'bot');
    expect(entry).toMatchObject({ ok: true, environment: 'PAPER' });
    expect(entry.positionId).toBeTruthy();
    const fillsBefore = get<{ n: number }>('SELECT COUNT(*) n FROM fills')!.n;
    const ordersBefore = get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n;
    const cashBefore = accountState().cash;

    const live = executionAdapter('LIVE');
    expect(live.availability().state).toBe('LOCKED');
    expect(() => live.submitEntry(report(id, last), 'bot')).toThrow(LiveLockedError);
    expect(() => live.closePosition('bot', entry.positionId!)).toThrow(LiveLockedError);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM fills')!.n).toBe(fillsBefore);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n).toBe(ordersBefore);
    expect(accountState().cash).toBe(cashBefore);
    expect(all<{ account: string }>('SELECT DISTINCT account FROM orders').map(x => x.account)).toEqual([PAPER_ACCOUNT]);
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
    updateControl('owner', { mode: 'APPROVAL' }, modeGate);
    expect(submitEntry(report(id, last), 'bot').ok).toBe(false);
  });
  it('preserves an approval cancelled before the entry transaction starts', async () => {
    const { setCrashHook } = await import('../src/exec/crashpoint.js');
    updateControl('owner', { mode: 'APPROVAL' }, modeGate);
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)',
      rep.id, rep.candidateId, id, 'crypto', 'LONG', 'trend_pullback', rep.decision, 70, Date.now(), J(rep));
    const orderId = queueForApproval(rep)!;
    setCrashHook(point => {
      if (point === 'entry.preTx') run("UPDATE orders SET status='CANCELLED' WHERE id=?", orderId);
    });
    try { expect(decideApproval(orderId, true).ok).toBe(false); }
    finally { setCrashHook(null); }
    expect(get('SELECT status FROM orders WHERE id=?', orderId)).toMatchObject({ status: 'CANCELLED' });
    expect(all('SELECT id FROM fills WHERE order_id=?', orderId)).toHaveLength(0);
    expect(openPositions()).toHaveLength(0);
  });
  it('withholds entry without the matching approval, a valid expiry and an enrolled strategy version', () => {
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    expect(submitEntry(rep, 'owner')).toMatchObject({ ok: false, reason: 'PENDING_APPROVAL_REQUIRED' });
    const invalid = report(id, last);
    invalid.consensus.expiresAt = 'invalid';
    expect(submitEntry(invalid, 'bot')).toMatchObject({ ok: false, reason: 'CONSENSUS_EXPIRY_INVALID' });
    expect(submitEntry(report(id, last, { strategy: { id: 'trend_pullback', version: '0.0.1' } }), 'bot').reason)
      .toMatch(/STRATEGY_VERSION_MISMATCH/);
    expect(openPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });
  it('approval workflow: queued → owner approves → filled', () => {
    updateControl('owner', { mode: 'APPROVAL' }, modeGate);
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)', rep.id, rep.candidateId, id, 'crypto', 'LONG', 'trend_pullback', rep.decision, 70, Date.now(), J(rep));
    expect(paperEntryForDecision(rep.id, id)).toBeNull();
    const oid = queueForApproval(rep)!; expect(oid).toBeTruthy();
    expect(paperEntryForDecision(rep.id, id)).toMatchObject({ orderId: oid, status: 'PENDING_APPROVAL', filledQty: 0 });
    const res = decideApproval(oid, true); expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(paperEntryForDecision(rep.id, id)).toMatchObject({ orderId: oid, status: 'FILLED', filledQty: expect.any(Number) });
  });
  it('does not approve, expire, cancel or list another account’s pending order', () => {
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    rep.consensus.expiresAt = '2020-01-01T00:00:00Z';
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)',
      rep.id, rep.candidateId, id, 'crypto', 'LONG', 'trend_pullback', rep.decision, 70, Date.now(), J(rep));
    const oid = queueForApproval(rep)!;
    run('UPDATE orders SET account=?, venue=? WHERE id=?', 'other-account', 'other-venue', oid);
    expect(() => decideApproval(oid, true)).toThrow(/not pending approval/);
    expect(() => decideApproval(oid, false)).toThrow(/not pending approval/);
    expect(submitEntry(rep, 'owner')).toMatchObject({ ok: false, reason: 'ORDER_ACCOUNT_MISMATCH' });
    expireApprovals();
    expect(cancelPendingEntries('owner').cancelled).toBe(0);
    expect(listOrders()).toHaveLength(0);
    expect(tradingHistory().orders).toHaveLength(0);
    expect(paperEntryForDecision(rep.id, id)).toBeNull();
    expect(get('SELECT status FROM orders WHERE id=?', oid)).toMatchObject({ status: 'PENDING_APPROVAL' });
  });
  it('does not paper-fill or list a position belonging to another account', () => {
    const entered = submitEntry(report(id, last), 'bot');
    expect(entered.ok).toBe(true);
    run('UPDATE positions SET account=? WHERE id=?', 'other-account', entered.positionId);
    const cash = accountState().cash;
    expect(executeExit(entered.positionId!, Infinity, 'TEST')).toBeNull();
    expect(() => closePosition('owner', entered.positionId!)).toThrow(/position not open/);
    expect(listPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(cash);
    expect(get('SELECT status FROM positions WHERE id=?', entered.positionId)).toMatchObject({ status: 'OPEN' });
    expect(all("SELECT 1 FROM orders WHERE side='SELL' AND status='FILLED'")).toHaveLength(0);
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

describe('Order-book freshness and fill accounting', () => {
  let id = ''; let last = 0;
  const OLD = () => Date.now() - 10 * 60_000;
  /** Move only the ticker (fresh), leaving the book untouched — the hot lane refreshes tickers more often than books. */
  const setTicker = (mid: number, ts = Date.now()) => Object.assign(market.tickers.get(id)!, { last: mid, bid: mid * 0.9999, ask: mid * 1.0001, receivedAt: ts });
  const sells = () => all<any>("SELECT o.purpose, f.qty, f.price, f.fee FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.side='SELL' ORDER BY f.ts, o.created_at");
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  // ── from PR #4 (fix/mia-4.1-audit-repairs), kept verbatim ──
  it('does not record a full exit when executable order-book depth is unavailable', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book = null;
    expect(executeExit(pos.id, pos.qty, 'TEST')).toBeNull();
    expect(openPositions()).toHaveLength(1);
    expect(openPositions()[0].qty).toBeCloseTo(pos.qty, 10);
    expect(listOrders().filter((o: any) => o.purpose === 'EXIT_TEST')).toHaveLength(0);
  });
  it('does not execute an exit against a stale order book', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book!.ts = Date.now() - 180_001;
    expect(executeExit(pos.id, pos.qty, 'STALE_BOOK')).toBeNull();
    expect(openPositions()).toHaveLength(1);
  });
  it('refuses to enter against a stale order book even when the ticker is fresh', () => {
    market.deep.get(id)!.book!.ts = Date.now() - QUALITY_LIMITS.maxExecBookAgeMs - 5_000;
    const r = submitEntry(report(id, last), 'bot');
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/ORDER_BOOK_STALE/);
    expect(openPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });
  it('never prices a stop-out from a stale book or a ticker fallback: keeps it open and raises the alert', () => {
    // CLAUDE.md invariant #4 (PR #4): no synthetic fills. Originally (PR #3) this exit filled at a quote-based price.
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book!.ts = OLD(); // book still shows bids near `last`
    setTicker(last * 0.96); // the market has actually fallen through the stop
    monitorPositions();
    expect(openPositions()).toHaveLength(1); // not closed at a fabricated price
    expect(all("SELECT * FROM orders WHERE position_id=? AND purpose LIKE 'EXIT_%'", pos.id)).toHaveLength(0);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE severity='CRITICAL'")!.n).toBeGreaterThan(0);
    expect(reconcile().ok).toBe(true);
    // once a fresh book arrives, the stop executes against real depth
    setBook(id, last * 0.96); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(get<any>('SELECT exit_reason FROM positions WHERE id=?', pos.id).exit_reason).toBe('STOP');
    expect(reconcile().ok).toBe(true);
  });
  it('partial take-profit keeps position, protective stop, fills and cash in step, and is not repeated', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const entry = openPositions()[0]; const qty0 = entry.qty;
    setBook(id, last * 1.05); monitorPositions();
    const p = openPositions()[0]; const s1 = sells();
    expect(s1).toHaveLength(1); expect(s1[0].purpose).toBe('EXIT_TARGET');
    expect(s1[0].qty + p.qty).toBeCloseTo(qty0, 9);
    expect(Math.abs(p.qty / qty0 - 0.5)).toBeLessThan(0.01);
    const stop = get<any>("SELECT * FROM orders WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", p.id);
    expect(stop.qty).toBeCloseTo(p.qty, 9); expect(stop.stop_price).toBe(p.stop_price);
    const buy = get<any>("SELECT avg_price, filled_qty, fees FROM orders WHERE purpose='ENTRY' AND status='FILLED'");
    const expectedCash = 10_000 - buy.avg_price * buy.filled_qty - buy.fees + s1[0].price * s1[0].qty - s1[0].fee;
    expect(accountState().cash).toBeCloseTo(expectedCash, 6);
    expect(p.realized_pnl).toBeCloseTo(-buy.fees + (s1[0].price - p.entry_price) * s1[0].qty - s1[0].fee, 6);
    monitorPositions(); monitorPositions(); // same prices again: the target must not fill twice
    expect(sells()).toHaveLength(1); expect(openPositions()[0].qty).toBe(p.qty);
    setBook(id, last * 1.10); monitorPositions(); // second target closes the rest exactly
    expect(openPositions()).toHaveLength(0);
    expect(sells().reduce((a, f) => a + f.qty, 0)).toBeCloseTo(qty0, 9);
    expect(reconcile().ok).toBe(true);
    expect(all("SELECT id FROM orders WHERE purpose='PROTECTIVE_STOP' AND status='ACTIVE'")).toHaveLength(0);
  });
  it('a target that closes a small position does not roll back with a TIME exit in the same pass (MIA-OMS-003)', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    // A venue minimum larger than half the position: the first target's remainder is unsellable, so it closes everything.
    market.instruments.get(id)!.minQty = pos.qty * 0.6;
    run('UPDATE positions SET max_hold_ms=1000, opened_at=? WHERE id=?', Date.now() - 10_000, pos.id); // max hold also expired
    setBook(id, last * 1.05); monitorPositions();
    expect(openPositions()).toHaveLength(0); // before the fix: every pass rolled back and the position never exited
    expect(all("SELECT id FROM protection_incidents WHERE status='OPEN'")).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });
  it('a stale monitor cannot overwrite newer excursion values (CodeRabbit PR #16: mfe/mae in the CAS guard)', async () => {
    const { setCrashHook } = await import('../src/exec/crashpoint.js');
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    // Another monitor commits a newer mfe after this pass took its snapshot (qty, stop and targets unchanged).
    setCrashHook((p) => { if (p === 'monitor.preTx') { run('UPDATE positions SET mfe=? WHERE id=?', 123.456, pos.id); setCrashHook(null); } });
    try { setBook(id, last * 1.01); monitorPositions(); } finally { setCrashHook(null); }
    expect(get<any>('SELECT mfe FROM positions WHERE id=?', pos.id).mfe).toBe(123.456); // stale pass was skipped, not written
  });
  it('never fills an exit from a thin book at top-of-book or an invented price: waits for real depth', () => {
    // CLAUDE.md invariant #4 (PR #4): sufficient fresh depth or no fill. Originally (PR #3) this booked a partial
    // fill plus a synthetic remainder below the worst visible bid.
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0]; const mid = last * 0.96; const ts = Date.now();
    market.deep.get(id)!.book = { bids: [[mid, pos.qty / 10], [mid * 0.999, pos.qty / 10]], asks: [[mid * 1.0002, 50]], ts };
    setTicker(mid, ts - 1);
    monitorPositions();
    expect(get<any>('SELECT status, qty FROM positions WHERE id=?', pos.id)).toMatchObject({ status: 'OPEN', qty: pos.qty });
    expect(sells()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
    setBook(id, mid); monitorPositions(); // real depth returns → the stop executes against it, below top-of-book
    const closed = get<any>('SELECT * FROM positions WHERE id=?', pos.id);
    expect(closed.status).toBe('CLOSED'); expect(closed.exit_price).toBeLessThanOrEqual(mid);
    expect(reconcile().ok).toBe(true);
  });
  it('manual close is refused when no fresh price exists, and changes nothing', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0]; const cash = accountState().cash;
    market.deep.get(id)!.book!.ts = OLD(); market.tickers.get(id)!.receivedAt = OLD();
    expect(() => closePosition('owner', pos.id)).toThrow(/fresh/);
    expect(openPositions()).toHaveLength(1); expect(sells()).toHaveLength(0); expect(accountState().cash).toBe(cash);
  });
  it('walkBook is exact by quantity and rejects crossed or empty books', () => {
    const book = { bids: [[99, 1], [98, 2]] as [number, number][], asks: [[101, 1], [102, 2]] as [number, number][], ts: Date.now() };
    const b = walkBook(book, 'buy', 2)!; expect(b.avgPrice).toBeCloseTo(101.5, 9); expect(b.filledFully).toBe(true); expect(b.worst).toBe(102);
    const s = walkBook(book, 'sell', 10)!; expect(s.filledFully).toBe(false); expect(s.filledQty).toBe(3);
    expect(walkBook({ ...book, bids: [[103, 1]] }, 'buy', 1)).toBe(null);
    expect(walkBook({ ...book, asks: [] }, 'buy', 1)).toBe(null);
    expect(walkBook(book, 'buy', 0)).toBe(null);
  });
});
