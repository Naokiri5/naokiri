import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RiskDecision } from '../src/risk/gate.js';

// The scan-level tests replace QCI and the decision step so the test controls the risk outcome; everything else in
// scanOnce (market data, regime, safety, dedupe, restart guard) is the real code.
const decideMock = vi.hoisted(() => vi.fn());
vi.mock('../src/qci/coordinator.js', () => ({ runConsensus: vi.fn(async () => ({ consensus_id: 'c', state: 'SUPPORTED', reason_codes: [] })) }));
vi.mock('../src/decision/engine.js', () => ({ decide: decideMock }));

import { freshDb, seedInstrument } from './helpers.js';
import { all, run, J } from '../src/db/db.js';
import { market } from '../src/market/store.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { scanOnce, waitingCandidates, _scanTest } from '../src/market/scanner.js';
import { ScanLedger, capacityEpoch, isCapacityOnlyDenial, storedDecisionsEndKey, MAX_WAITING } from '../src/market/scanLedger.js';
import { PAPER_ACCOUNT } from '../src/portfolio/ledger.js';

const risk = (decision: RiskDecision['decision'], reasonCodes: string[]): RiskDecision =>
  ({ decision, reasonCodes, evaluated: {}, sizing: null, policyVersion: 1, ts: '', traceId: 't' });
const meta = { instrumentId: 'crypto:binance:AUSDT', strategyId: 's1' };

describe('capacity-only denial classification', () => {
  it('accepts only denials made entirely of capacity codes', () => {
    expect(isCapacityOnlyDenial(risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']))).toBe(true);
    expect(isCapacityOnlyDenial(risk('DENY', ['MAX_CONCURRENT_POSITIONS 4', 'CORRELATION_LIMIT 2 correlated open positions', 'INSUFFICIENT_BUYING_POWER: worst-case cost 10 > cash 1', 'CASH_RESERVE_FLOOR_REACHED', 'AGGREGATE_OPEN_RISK 3.00% > 2%']))).toBe(true);
    expect(isCapacityOnlyDenial(risk('DENY', ['MAX_CONCURRENT_POSITIONS 4', 'DAILY_LOSS_BREAKER 3.00%']))).toBe(false);
    expect(isCapacityOnlyDenial(risk('DENY', ['ASSET_POST_EXIT_COOLDOWN']))).toBe(false);
    expect(isCapacityOnlyDenial(risk('DENY', ['MAX_CONCURRENT_POSITIONSX']))).toBe(false);
    expect(isCapacityOnlyDenial(risk('DENY', []))).toBe(false);
    expect(isCapacityOnlyDenial(risk('ALLOW', ['MAX_CONCURRENT_POSITIONS 4']))).toBe(false);
    expect(isCapacityOnlyDenial(null)).toBe(false);
  });
});

describe('ScanLedger', () => {
  it('holds a capacity-blocked key until the capacity epoch changes, then lets it be evaluated once more', () => {
    const l = new ScanLedger();
    expect(l.verdict('k', 0, 0)).toBe('EVALUATE');
    expect(l.record('k', meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']), 0, 1000, 0)).toBe(true);
    expect(l.verdict('k', 10, 0)).toBe('WAITING_CAPACITY');
    expect(l.verdict('k', 10, 1)).toBe('EVALUATE');
    expect(l.record('k', meta, risk('ALLOW', []), 1, 1000, 20)).toBe(false);
    expect(l.verdict('k', 30, 2)).toBe('PROCESSED');
    expect(l.waitingList(30)).toEqual([]);
  });
  it('ends the key on any non-capacity denial or a missing risk decision', () => {
    const l = new ScanLedger();
    expect(l.record('a', meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4', 'NEW_ORDERS_PAUSED']), 0, 1000, 0)).toBe(false);
    expect(l.record('b', meta, null, 0, 1000, 0)).toBe(false);
    expect(l.verdict('a', 1, 5)).toBe('PROCESSED');
    expect(l.verdict('b', 1, 5)).toBe('PROCESSED');
  });
  it('expires a waiting key when its candle is superseded, even after a settlement', () => {
    const l = new ScanLedger();
    l.record('k', meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']), 0, 1000, 0);
    expect(l.verdict('k', 1000, 1)).toBe('EXPIRED');
    expect(l.verdict('k', 1001, 2)).toBe('PROCESSED');
    expect(l.record('late', meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']), 0, 1000, 1000)).toBe(false);
  });
  it('caps the waiting queue; overflow is treated as terminal rather than growing without bound', () => {
    const l = new ScanLedger();
    for (let i = 0; i < MAX_WAITING; i++) expect(l.record(`k${i}`, meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']), 0, 1000, 0)).toBe(true);
    expect(l.record('overflow', meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']), 0, 1000, 0)).toBe(false);
    expect(l.record('k0', meta, risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']), 1, 1000, 1)).toBe(true);
    expect(l.waitingList(1).find((w) => w.key === 'k0')?.evaluations).toBe(2);
  });
});

describe('restart guard and capacity epoch', () => {
  beforeEach(() => freshDb());
  const storeDecision = (riskDecision: string | null, report: unknown, at = 5000) =>
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      `d${Math.random()}`, 'c', 'I', 'crypto', 'long', 'S', 'REJECTED', 0, riskDecision, 'q', at, typeof report === 'string' ? report : J(report));

  it('ends a key only when a stored decision after the candle is not a capacity-only denial', () => {
    expect(storedDecisionsEndKey('I', 'S', 1000)).toBe(false);
    storeDecision('DENY', { risk: risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']) });
    expect(storedDecisionsEndKey('I', 'S', 1000)).toBe(false);
    expect(storedDecisionsEndKey('I', 'S', 9000)).toBe(false);
    storeDecision(null, { risk: null });
    expect(storedDecisionsEndKey('I', 'S', 1000)).toBe(true);
  });
  it('treats an unreadable stored report as terminal', () => {
    storeDecision('DENY', '{not json');
    expect(storedDecisionsEndKey('I', 'S', 1000)).toBe(true);
  });
  it('advances the capacity epoch when a paper position closes', () => {
    const before = capacityEpoch();
    run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,planned_risk)
      VALUES ('p1',?,'I','crypto','long','S',1,100,95,95,'[]','CLOSED',1,2,5)`, PAPER_ACCOUNT);
    expect(capacityEpoch()).toBe(before + 1);
  });
});

describe('scanOnce re-evaluates a capacity-blocked signal after a settlement (CT01-04)', () => {
  const strategy = STRATEGIES[0];
  const originals = STRATEGIES.map((s) => ({ s, generate: s.generate, regimes: s.suitableRegimes }));
  let id = '';
  beforeEach(() => {
    freshDb();
    market.universe.length = 0;
    id = seedInstrument('CAPUSDT').inst.id;
    _scanTest.reset();
    // Force a deterministic signal from one strategy; all others stay silent.
    for (const s of STRATEGIES) (s as any).generate = () => null;
    (strategy as any).generate = (f: any) => ({ entryRef: f.close, stop: f.close * 0.97, targets: [f.close * 1.05], reasons: ['test signal'] });
    (strategy as any).suitableRegimes = ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOL', 'LOW_VOL', 'CHOP', 'UNKNOWN'];
    decideMock.mockReset();
  });
  afterEach(() => {
    for (const o of originals) { (o.s as any).generate = o.generate; (o.s as any).suitableRegimes = o.regimes; }
  });
  const report = (r: RiskDecision | null) => ({ id: `rep${Math.random()}`, decision: r?.decision === 'ALLOW' ? 'PAPER_TRADE' : 'REJECTED', opportunity: { score: 1 }, risk: r });
  const settle = (pid: string) => run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,planned_risk)
    VALUES (?,?,'X','crypto','long','S',1,100,95,95,'[]','CLOSED',1,2,5)`, pid, PAPER_ACCOUNT);

  it('waits without re-running the pipeline, then re-evaluates once a position settles and ends on approval', async () => {
    decideMock.mockReturnValueOnce(report(risk('DENY', ['MAX_CONCURRENT_POSITIONS 4'])));
    const seen: string[] = [];
    await scanOnce((r) => seen.push(r.decision));
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(waitingCandidates().map((w) => w.instrumentId)).toEqual([id]);

    await scanOnce((r) => seen.push(r.decision));
    expect(decideMock).toHaveBeenCalledTimes(1); // no settlement: no re-evaluation, no decision spam

    settle('p-a');
    decideMock.mockReturnValueOnce(report(risk('ALLOW', [])));
    await scanOnce((r) => seen.push(r.decision));
    expect(decideMock).toHaveBeenCalledTimes(2);
    expect(decideMock.mock.calls[1][0].id).not.toBe(decideMock.mock.calls[0][0].id); // fresh candidate, never a reused one
    expect(seen).toEqual(['REJECTED', 'PAPER_TRADE']);
    expect(waitingCandidates()).toEqual([]);

    settle('p-b');
    await scanOnce();
    expect(decideMock).toHaveBeenCalledTimes(2); // approved key is done for this candle
  });

  it('does not re-evaluate a signal denied for a non-capacity reason, even after a settlement', async () => {
    decideMock.mockReturnValueOnce(report(risk('DENY', ['MAX_CONCURRENT_POSITIONS 4', 'ASSET_POST_EXIT_COOLDOWN'])));
    await scanOnce();
    settle('p-c');
    await scanOnce();
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(waitingCandidates()).toEqual([]);
  });

  it('after a restart, a stored capacity-only denial allows one fresh evaluation; a stored terminal decision does not', async () => {
    decideMock.mockImplementation((cand: any) => {
      const rep = report(risk('DENY', ['MAX_CONCURRENT_POSITIONS 4']));
      run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        rep.id, cand.id, cand.instrumentId, 'crypto', 'long', cand.strategyId, 'REJECTED', 1, 'DENY', 'q', Date.now(), J(rep));
      return rep;
    });
    await scanOnce();
    expect(decideMock).toHaveBeenCalledTimes(1);
    _scanTest.reset(); // simulated restart: in-memory state lost
    await scanOnce();
    expect(decideMock).toHaveBeenCalledTimes(2);
    await scanOnce();
    expect(decideMock).toHaveBeenCalledTimes(2); // waiting again, no settlement

    run("UPDATE decisions SET risk_decision=NULL");
    _scanTest.reset();
    await scanOnce();
    expect(decideMock).toHaveBeenCalledTimes(2);
    expect(all('SELECT 1 FROM decisions').length).toBe(2);
  });
});
