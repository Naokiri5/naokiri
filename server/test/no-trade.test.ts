import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument } from './helpers.js';
import { get, getDb, run } from '../src/db/db.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { noTradeBoard, globalBlockers, classifyRiskCode, NO_TRADE_TTL_MS } from '../src/decision/noTrade.js';

/** S6 "Why MIA is not trading": a read-only projection of persisted decisions and existing control state. */
const T = Date.UTC(2026, 10, 10, 12, 0, 0);
const MIN = 60_000;
let seq = 0;
function decision(symbol: string, state: string, ageMs: number, report: object | string = {}) {
  const id = 'dec_t' + (++seq); const instrument = 'crypto:binance:' + symbol;
  const body = typeof report === 'string' ? report : JSON.stringify({ id, asset: symbol, instrumentId: instrument, decision: state, steps: [], risk: null, ...report });
  run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, 'cand_' + id, instrument, 'crypto', 'NO_POSITION', 'trend_pullback', state, 55, null, null, T - ageMs, body);
  return id;
}
const row = (symbol: string) => noTradeBoard().rows.find((r) => r.symbol === symbol);

describe('no-trade board', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T); freshDb(); market.reset(); market.tickersFetchedAt = 0; seq = 0; });
  afterEach(() => vi.useRealTimers());

  it('maps risk reason codes verbatim and keeps the stored policy version and check time', () => {
    decision('BTCUSDT', 'REJECTED', 10 * MIN, { risk: { decision: 'DENY', reasonCodes: ['DAILY_LOSS_BREAKER -2.10%', 'SPREAD 9.0bps > 8', 'MODE_READ_ONLY', 'ASSET_INELIGIBLE:BLOCKED', 'NEW_GATE_CODE x'], policyVersion: 3, ts: '2026-11-10T11:50:00.000Z' } });
    const r = row('BTCUSDT')!;
    expect(r.reasons).toEqual([
      { group: 'risk', code: 'DAILY_LOSS_BREAKER', text: 'DAILY_LOSS_BREAKER -2.10%' }, { group: 'risk', code: 'SPREAD', text: 'SPREAD 9.0bps > 8' },
      { group: 'mode', code: 'MODE_READ_ONLY', text: 'MODE_READ_ONLY' }, { group: 'safety', code: 'ASSET_INELIGIBLE', text: 'ASSET_INELIGIBLE:BLOCKED' },
      { group: 'risk', code: 'NEW_GATE_CODE', text: 'NEW_GATE_CODE x' }]);
    expect(r.risk).toEqual({ decision: 'DENY', policyVersion: 3, checkedAt: '2026-11-10T11:50:00.000Z' });
    expect(r).toMatchObject({ evidence: 'RECENT', ageMs: 10 * MIN, expiresAt: T - 10 * MIN + NO_TRADE_TTL_MS, supersededBy: null });
  });

  it('classifies safety, QCI, consensus, data and monitoring reasons from the stored pipeline steps', () => {
    decision('SAFUSDT', 'REJECTED', MIN, { steps: [{ step: 3, name: 'Asset eligibility / safety', result: 'FAIL', detail: 'HIGH_RISK: thin float' }] });
    decision('QCIUSDT', 'REJECTED', MIN, { steps: [{ step: 9, name: 'QCI consensus record', result: 'FAIL', detail: 'VETOED: whale dump' }] });
    decision('ETHUSDT', 'WAIT_FOR_CONFIRMATION', MIN, { consensus: { state: 'NO_QUORUM' } });
    decision('SOLUSDT', 'INSUFFICIENT_DATA', MIN, { steps: [{ step: 1, name: 'Market data freshness', result: 'FAIL', detail: 'quote 400s old' }] });
    decision('OBSUSDT', 'APPROVED_FOR_MONITORING', MIN, { steps: [{ step: 17, name: 'Execution permission (Part 9)', result: 'FAIL', detail: 'mode OBSERVE' }] });
    decision('LOWUSDT', 'APPROVED_FOR_MONITORING', MIN, { opportunity: { score: 41 }, steps: [{ step: 17, name: 'Execution permission (Part 9)', result: 'PASS', detail: 'mode PAPER' }] });
    expect(row('SAFUSDT')!.reasons).toEqual([{ group: 'safety', code: 'ASSET_INELIGIBLE', text: 'HIGH_RISK: thin float' }]);
    expect(row('QCIUSDT')!.reasons).toEqual([{ group: 'consensus', code: 'QCI_VETOED', text: 'VETOED: whale dump' }]);
    expect(row('ETHUSDT')!.reasons).toEqual([{ group: 'consensus', code: 'NO_QUORUM', text: 'consensus NO_QUORUM' }]);
    expect(row('SOLUSDT')!.reasons).toEqual([{ group: 'data', code: 'MARKET_DATA_FAIL', text: 'quote 400s old' }]);
    expect(row('OBSUSDT')!.reasons).toEqual([{ group: 'mode', code: 'MODE_READ_ONLY', text: 'mode OBSERVE' }]);
    expect(row('LOWUSDT')!.reasons[0]).toMatchObject({ group: 'consensus', code: 'SCORE_BELOW_MIN' });
  });

  it('omits instruments whose latest decision is a trade and keeps superseded history', () => {
    decision('BNBUSDT', 'PAPER_TRADE', MIN);
    decision('ADAUSDT', 'REJECTED', 30 * MIN); const adaTrade = decision('ADAUSDT', 'PAPER_TRADE', 5 * MIN);
    decision('DOGEUSDT', 'PAPER_TRADE', 40 * MIN); const old = decision('DOGEUSDT', 'REJECTED', 30 * MIN); const mid = decision('DOGEUSDT', 'INSUFFICIENT_DATA', 20 * MIN); const cur = decision('DOGEUSDT', 'WAIT_FOR_CONFIRMATION', 5 * MIN, { consensus: { state: 'EXPIRED' } });
    const b = noTradeBoard();
    expect(b.rows.map((r) => r.symbol)).toEqual(['DOGEUSDT']);
    expect(b.omittedTrades.map((o) => o.decisionId).sort()).toEqual([adaTrade, expect.any(String)].sort());
    const doge = b.rows[0];
    expect(doge.decisionId).toBe(cur);
    expect(doge.history.map((h) => [h.decisionId, h.supersededBy])).toEqual([[mid, cur], [old, mid]]);
  });

  it('marks evidence STALE at exactly the 2h TTL, UNKNOWN for unreadable reports and future timestamps, and never drops them', () => {
    decision('XRPUSDT', 'REJECTED', NO_TRADE_TTL_MS, { risk: { decision: 'DENY', reasonCodes: ['NO_PRICE'], policyVersion: 1, ts: 'x' } });
    decision('BADUSDT', 'REJECTED', MIN, '{not json');
    decision('FUTUSDT', 'REJECTED', -10 * MIN, { risk: { decision: 'DENY', reasonCodes: ['NO_PRICE'], policyVersion: 1, ts: 'x' } });
    decision('EMPUSDT', 'REJECTED', MIN, { steps: [] });
    expect(row('XRPUSDT')!.evidence).toBe('STALE');
    expect(row('crypto:binance:BADUSDT'.split(':')[2])).toMatchObject({ evidence: 'UNKNOWN', reasons: [{ group: 'data', code: 'REPORT_UNREADABLE' }] });
    expect(row('FUTUSDT')).toMatchObject({ evidence: 'UNKNOWN', ageMs: null, expiresAt: null });
    expect(row('EMPUSDT')!.reasons).toEqual([{ group: 'data', code: 'UNKNOWN', text: 'no blocking reason could be read from the stored report' }]);
  });

  it('empty decisions give no rows and no invented recommendation; default globals are honest', () => {
    const b = noTradeBoard();
    expect(Object.keys(b).sort()).toEqual(['asOf', 'global', 'globalLabel', 'omittedTrades', 'rows', 'ttlMs', 'windowMs']);
    expect(b.rows).toEqual([]); expect(b.globalLabel).toBe('known blockers, not execution clearance');
    expect(b.global.map((g) => g.code)).toEqual(['MODE_OBSERVE', 'NO_POLICY', 'UNFUNDED', 'STALE_DATA']);
  });

  it('global blockers follow existing state; emergency stays separate from pause', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000); seedInstrument('BTCUSDT', { nowTs: T - 5_000 }); market.tickersFetchedAt = T - 5_000;
    expect(globalBlockers()).toEqual([]);
    updateControl('owner', { pausedNewOrders: true }); expect(globalBlockers().map((g) => g.code)).toEqual(['PAUSED']);
    updateControl('owner', { pausedNewOrders: false, emergency: true }); expect(globalBlockers().map((g) => g.code)).toEqual(['EMERGENCY']);
    market.tickersFetchedAt = T + 60_000; expect(globalBlockers().map((g) => g.code)).toContain('STALE_DATA');
  });

  it('a fresh batch of stale source quotes keeps STALE_DATA; receipt time alone does not clear it', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    seedInstrument('BTCUSDT', { nowTs: T - 5_000 }); market.tickersFetchedAt = T - 5_000;
    const q = market.tickers.get('crypto:binance:BTCUSDT')!; q.providerTs = T - 10 * MIN;
    expect(globalBlockers().map((g) => g.code)).toEqual(['STALE_DATA']);
    q.providerTs = T - 5_000; expect(globalBlockers()).toEqual([]);
    q.providerTs = T + 10 * MIN; expect(globalBlockers().map((g) => g.code)).toEqual(['STALE_DATA']);
  });

  it('reports missing position marks as a separate global blocker and keeps the equity guard', () => {
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    seedInstrument('BTCUSDT', { nowTs: T - 5_000 }); market.tickersFetchedAt = T - 5_000;
    run("INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,planned_risk) VALUES ('pos_nomark',?,'crypto:binance:GONEUSDT','crypto','LONG','trend_pullback',1,100,95,95,'{}','OPEN',?,0,0,5)", PAPER_ACCOUNT, T - 60 * MIN);
    const g = globalBlockers().find((x) => x.code === 'POSITION_MARKS_MISSING');
    expect(g).toMatchObject({ group: 'data' }); expect(g!.text).toContain('GONEUSDT');
    expect(globalBlockers().map((x) => x.code)).not.toContain('UNFUNDED');
  });

  it('shows a decision awaiting owner confirmation, but not as pending once the order is cancelled or expired', () => {
    const order = (decisionId: string, status: string, n: number) => run("INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,decision_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      'ord_' + n, 'coid_' + n, PAPER_ACCOUNT, 'paper', 'crypto:binance:LINKUSDT', 'BUY', 'MARKET', 1, status, 'ENTRY', decisionId, T - MIN, T - MIN);
    const pending = decision('LINKUSDT', 'APPROVED_FOR_USER_CONFIRMATION', 5 * MIN); order(pending, 'PENDING_APPROVAL', 1);
    const cancelled = decision('MATICUSDT', 'APPROVED_FOR_USER_CONFIRMATION', 5 * MIN); order(cancelled, 'CANCELLED', 2);
    const expired = decision('DOTUSDT', 'APPROVED_FOR_USER_CONFIRMATION', 5 * MIN); order(expired, 'EXPIRED', 3);
    decision('ATOMUSDT', 'APPROVED_FOR_USER_CONFIRMATION', 5 * MIN);
    decision('NEARUSDT', 'PAPER_TRADE', 5 * MIN);
    expect(row('LINKUSDT')!.reasons[0]).toMatchObject({ code: 'AWAITING_OWNER_CONFIRMATION' });
    for (const s of ['MATICUSDT', 'DOTUSDT', 'ATOMUSDT']) expect(row(s)!.reasons[0].code).toBe('OWNER_APPROVAL_NOT_PENDING');
    expect(row('MATICUSDT')!.reasons[0].text).toContain('CANCELLED'); expect(row('DOTUSDT')!.reasons[0].text).toContain('EXPIRED');
    expect(row('NEARUSDT')).toBeUndefined(); expect(noTradeBoard().omittedTrades.map((o) => o.decision)).toEqual(['PAPER_TRADE']);
  });

  it('a future-dated trade never hides valid evidence; a valid latest trade still omits; future-only is UNKNOWN', () => {
    decision('SUIUSDT', 'REJECTED', MIN, { risk: { decision: 'DENY', reasonCodes: ['SPREAD 9bps > 8'], policyVersion: 1, ts: 'x' } });
    decision('SUIUSDT', 'PAPER_TRADE', -5 * MIN);
    decision('APTUSDT', 'REJECTED', 20 * MIN); decision('APTUSDT', 'PAPER_TRADE', MIN); decision('APTUSDT', 'REJECTED', -5 * MIN);
    decision('OPUSDT', 'PAPER_TRADE', -5 * MIN);
    const sui = row('SUIUSDT')!;
    expect(sui).toMatchObject({ evidence: 'RECENT', decision: 'REJECTED' });
    expect(sui.reasons.map((r) => r.code)).toEqual(['SPREAD', 'FUTURE_DATED_DECISION']);
    expect(row('APTUSDT')).toBeUndefined(); expect(noTradeBoard().omittedTrades.map((o) => o.instrumentId)).toContain('crypto:binance:APTUSDT');
    expect(row('OPUSDT')).toMatchObject({ evidence: 'UNKNOWN', ageMs: null });
  });

  it('a database failure while reading a selected report reaches the caller; malformed content still falls back', () => {
    decision('BADUSDT', 'REJECTED', MIN, '{not json');
    expect(row('BADUSDT')!.reasons[0].code).toBe('REPORT_UNREADABLE');
    const db = getDb(); db.exec('ALTER TABLE decisions RENAME COLUMN report TO report_x');
    try { expect(() => noTradeBoard()).toThrow(); } finally { db.exec('ALTER TABLE decisions RENAME COLUMN report_x TO report'); }
  });

  it('reading the board writes nothing, even across a day rollover with a funded account', () => {
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    decision('BTCUSDT', 'REJECTED', MIN, { risk: { decision: 'DENY', reasonCodes: ['NO_EQUITY (fund the paper bot allocation)'], policyVersion: null, ts: 'x' } });
    const snap = () => ({ control: getControl(), audit: get<{ n: number }>('SELECT COUNT(*) n FROM audit_log')!.n, orders: get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n,
      decisions: get<{ n: number }>('SELECT COUNT(*) n FROM decisions')!.n, settings: get<{ s: string | null }>("SELECT group_concat(key || '=' || value, ';') s FROM settings")!.s });
    const before = snap();
    getDb().exec('PRAGMA query_only=ON');
    try {
      noTradeBoard(); vi.setSystemTime(T + 86_400_000); expect(() => noTradeBoard()).not.toThrow();
    } finally { getDb().exec('PRAGMA query_only=OFF'); }
    expect(snap()).toEqual(before);
  });

  it('classifyRiskCode keeps unknown codes in the risk group', () => {
    expect(classifyRiskCode('DATA_QUALITY_FAIL:a|b')).toEqual({ group: 'data', code: 'DATA_QUALITY_FAIL', text: 'DATA_QUALITY_FAIL:a|b' });
    expect(classifyRiskCode('lowercase text')).toEqual({ group: 'risk', code: 'UNKNOWN', text: 'lowercase text' });
  });
});
