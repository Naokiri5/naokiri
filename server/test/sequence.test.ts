import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb } from './helpers.js';
import { closeDb, get, run } from '../src/db/db.js';
import { recentSequences, sequenceForDecision } from '../src/sequence/projection.js';

const putDecision = (id: string, report = '{"traceId":"trace-fixture"}') => {
  run(
    \`INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)\`,
    id, 'candidate-fixture', 'crypto:binance:TESTUSDT', 'crypto', 'LONG',
    'trend_pullback', 'PAPER_TRADE', 80, 'ALLOW', null, Date.now(), report,
  );
};

const putEntryOrder = (status: string) => {
  run(
    \`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,
       status,purpose,decision_id,created_at,updated_at,filled_qty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`,
    'entry-order', 'entry-candidate-fixture', 'paper-bot', 'binance',
    'crypto:binance:TESTUSDT', 'BUY', 'MARKET', 2,
    status, 'ENTRY', 'decision-fixture', Date.now(), Date.now(),
    status === 'FILLED' ? 2 : 0,
  );
};

const putPositionAndProtection = () => {
  run(
    \`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,
       entry_price,stop_price,initial_stop,targets,status,opened_at,planned_risk,decision_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`,
    'position-fixture', 'paper-bot', 'crypto:binance:TESTUSDT',
    'crypto', 'LONG', 'trend_pullback', 2, 100, 95, 95, '{}',
    'OPEN', Date.now(), 10, 'decision-fixture',
  );
  run(
    \`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,
       stop_price,status,purpose,position_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`,
    'stop-order', 'stop-position-fixture', 'paper-bot', 'binance',
    'crypto:binance:TESTUSDT', 'SELL', 'STOP_MARKET', 2, 95,
    'ACTIVE', 'PROTECTIVE_STOP', 'position-fixture', Date.now(), Date.now(),
  );
  run(
    'INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)',
    'entry-fill', 'entry-order', 2, 100, 0.2, 'TAKER', Date.now(),
  );
};

describe('sequence read-only projection (canonical records only)', () => {
  beforeEach(() => freshDb(false));
  afterEach(() => closeDb());

  it('does not invent orders for decisions and returns only committed facts', () => {
    putDecision('decision-fixture');
    const initial = get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n;
    const x = sequenceForDecision('decision-fixture')!;
    expect(x).toMatchObject({
      source: 'EXISTING_MIA_RECORDS', advisoryOnly: true,
      decisionId: 'decision-fixture', traceId: 'trace-fixture', stage: 'DECISION_ONLY',
    });
    expect(x.orders).toHaveLength(0);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n).toBe(initial);
  });

  it('shows existing owner approval without submitting an order', () => {
    putDecision('decision-fixture');
    putEntryOrder('PENDING_APPROVAL');
    expect(sequenceForDecision('decision-fixture')?.stage).toBe('AWAITING_APPROVAL');
    expect(get<{ status: string }>('SELECT status FROM orders WHERE id=?', 'entry-order')?.status).toBe('PENDING_APPROVAL');
  });

  it('requires real fill evidence for a FILLED order', () => {
    putDecision('decision-fixture');
    putEntryOrder('FILLED');
    const x = sequenceForDecision('decision-fixture')!;
    expect(x.stage).toBe('REVIEW_REQUIRED');
    expect(x.anomalies).toContain('FILLED_ORDER_WITHOUT_RECORDED_FILL:entry-order');
    expect(x.fills).toHaveLength(0);
  });

  it('reconstructs an open position without duplicate accounting', () => {
    putDecision('decision-fixture');
    putEntryOrder('FILLED');
    putPositionAndProtection();
    const beforeFills = get<{ n: number }>('SELECT COUNT(*) n FROM fills')!.n;
    const x = sequenceForDecision('decision-fixture')!;
    expect(x.stage).toBe('POSITION_OPEN');
    expect(x.anomalies).toHaveLength(0);
    expect(x.positions).toHaveLength(1);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM fills')!.n).toBe(beforeFills);
  });

  it('exposes persistent protection incidents but does not close the position', () => {
    putDecision('decision-fixture');
    putEntryOrder('FILLED');
    putPositionAndProtection();
    run(
      \`INSERT INTO protection_incidents(id,position_id,instrument,status,reason,opened_at,last_seen_at,last_notified_at,occurrences)
         VALUES (?,?,?,?,?,?,?,?,?)\`,
      'incident-fixture', 'position-fixture', 'crypto:binance:TESTUSDT',
      'OPEN', 'stale executable book', Date.now(), Date.now(), Date.now(), 1,
    );
    const x = sequenceForDecision('decision-fixture')!;
    expect(x.stage).toBe('PROTECTION_UNVERIFIED');
    expect(x.anomalies).toContain('OPEN_PROTECTION_INCIDENT');
    expect(get<{ status: string }>('SELECT status FROM positions WHERE id=?', 'position-fixture')?.status).toBe('OPEN');
  });

  it('provides a bounded recent list and missing-id behavior', () => {
    expect(sequenceForDecision('absent')).toBeNull();
    putDecision('decision-fixture', '{broken json');
    const items = recentSequences(10000);
    expect(items).toHaveLength(1);
    expect(items[0].traceId).toBeNull();
  });
});
