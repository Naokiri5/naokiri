import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { submitEntry, executeExit, monitorPositions } from '../src/exec/oms.js';
import { linkClosedTrades } from '../src/ditas/tradeOutcomes.js';
import { ACK_KEY, HASH_CHECK_KEY, LINK_GRACE_MS, acknowledgeEvidenceFindings, evaluateEvidenceIntegrity, refreshOutcomeHashCheck } from '../src/ditas/evidenceIntegrity.js';
import { setSetting } from '../src/core/settings.js';
import { all, get, getDb, run, J } from '../src/db/db.js';
import type { DecisionReport } from '../src/decision/engine.js';

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

function openTrade(id: string, last: number) {
  const r = report(id, last);
  run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    r.id, r.candidateId, id, 'crypto', 'LONG', r.strategy.id, r.decision, 70, 'ALLOW', 'q', Date.now(), J(r));
  const entry = submitEntry(r, 'bot');
  expect(entry, JSON.stringify(entry)).toMatchObject({ ok: true });
  return openPositions().find((p) => p.id === entry.positionId)!;
}
function closedTrade(id: string, last: number, { mismatch = false } = {}) {
  const position = openTrade(id, last);
  executeExit(position.id, position.qty, 'TEST');
  if (mismatch) {
    const exitOrder = get<{ id: string }>("SELECT id FROM orders WHERE position_id=? AND purpose LIKE 'EXIT_%'", position.id)!.id;
    ledger(PAPER_ACCOUNT, 'SELL', 25, exitOrder, 'unexplained credit', Date.now());
  }
  return position.id;
}
const integrityDenial = (id: string, last: number, nowTs = Date.now()) => evaluateRisk({ instrumentId: id, strategyId: 'trend_pullback', side: 'buy', entryPrice: last, stopPrice: last * 0.97,
  idempotencyKey: `k${Math.random()}`, traceId: 't' }, nowTs).reasonCodes.filter((r) => r.startsWith('EVIDENCE_INTEGRITY_FAILED'));

describe('evidence integrity pauses new entries, never exits', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  it('is clean with verified, linked evidence', () => {
    closedTrade(id, last); linkClosedTrades(Date.now() + 1); refreshOutcomeHashCheck();
    expect(evaluateEvidenceIntegrity()).toMatchObject({ ok: true, reasons: [], findings: { mismatched: [], unlinked: [], tampered: [] } });
    expect(integrityDenial(id, last)).toEqual([]);
  });

  it('denies on a settlement mismatch until the owner acknowledges the exact reviewed version', () => {
    const positionId = closedTrade(id, last, { mismatch: true });
    linkClosedTrades(Date.now() + 1);
    expect(integrityDenial(id, last)[0]).toMatch(/SETTLEMENT_MISMATCH: 1/);
    const [shown] = evaluateEvidenceIntegrity().findings.mismatched;
    expect(shown).toMatchObject({ positionId, kind: 'MISMATCH', storedHash: expect.any(String), contentHash: shown.storedHash });
    expect(() => acknowledgeEvidenceFindings('bot', [shown])).toThrow(/only the owner/);
    expect(() => acknowledgeEvidenceFindings('owner', [{ ...shown, positionId: 'pos_unknown' }])).toThrow(/not an open finding/);
    expect(() => acknowledgeEvidenceFindings('owner', [{ ...shown, contentHash: 'f'.repeat(64) }])).toThrow(/not an open finding/);
    expect(() => acknowledgeEvidenceFindings('owner', [{ ...shown, kind: 'TAMPERED' }])).toThrow(/not an open finding/);
    expect(acknowledgeEvidenceFindings('owner', [shown]).ok).toBe(true);
    expect(integrityDenial(id, last)).toEqual([]);
    const auditRow = get<{ detail: string }>("SELECT detail FROM audit_log WHERE action='evidence.integrity.acknowledge'");
    expect(auditRow?.detail).toContain(positionId);
    expect(auditRow?.detail).toContain('LEDGER_SELL_MISMATCH');
  });

  it('does not honour an acknowledgement bound to another hash', () => {
    const positionId = closedTrade(id, last, { mismatch: true });
    linkClosedTrades(Date.now() + 1);
    setSetting(ACK_KEY, [{ positionId, kind: 'MISMATCH', storedHash: 'not-the-stored-hash', contentHash: null, acknowledgedAt: 1 }]);
    expect(evaluateEvidenceIntegrity().findings.mismatched.map((f) => f.positionId)).toEqual([positionId]);
  });

  it('reopens an acknowledged mismatch when its content changes, even with the stored hash untouched', () => {
    const positionId = closedTrade(id, last, { mismatch: true }); linkClosedTrades(Date.now() + 1);
    acknowledgeEvidenceFindings('owner', evaluateEvidenceIntegrity().findings.mismatched);
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run('UPDATE ditas_trade_outcomes SET net_pnl=net_pnl+5 WHERE position_id=?', positionId);
    expect(evaluateEvidenceIntegrity().findings.mismatched.map((f) => f.positionId)).toEqual([positionId]);
  });

  it(`denies while a closed trade stays unlinked beyond ${LINK_GRACE_MS / 60_000} minutes, and that cannot be acknowledged`, () => {
    const positionId = closedTrade(id, last);
    const closedAt = get<{ closed_at: number }>('SELECT closed_at FROM positions WHERE id=?', positionId)!.closed_at;
    expect(integrityDenial(id, last, closedAt + LINK_GRACE_MS)).toEqual([]); // inside the grace window
    const late = closedAt + LINK_GRACE_MS + 1;
    expect(evaluateEvidenceIntegrity(late).findings.unlinked).toEqual([positionId]);
    expect(() => acknowledgeEvidenceFindings('owner', [{ positionId, kind: 'MISMATCH', storedHash: 'x', contentHash: 'a'.repeat(64) }], late)).toThrow(/not an open finding/);
    linkClosedTrades(late);
    expect(evaluateEvidenceIntegrity(late).ok).toBe(true);
  });

  it('denies on a closed position without a close time', () => {
    const positionId = closedTrade(id, last);
    run('UPDATE positions SET closed_at=NULL WHERE id=?', positionId);
    expect(evaluateEvidenceIntegrity().findings.unlinked).toEqual([positionId]);
  });

  it('denies on an altered record once the background hash check has seen it; a settlement acknowledgement never clears it', () => {
    const positionId = closedTrade(id, last, { mismatch: true }); linkClosedTrades(Date.now() + 1);
    acknowledgeEvidenceFindings('owner', evaluateEvidenceIntegrity().findings.mismatched);
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run("UPDATE ditas_trade_outcomes SET settlement='VERIFIED' WHERE position_id=?", positionId);
    expect(integrityDenial(id, last)).toEqual([]); // not detected until the background check runs (documented)
    expect(refreshOutcomeHashCheck()).toMatchObject({ checked: 1, tampered: [positionId], lastError: null });
    expect(integrityDenial(id, last)[0]).toMatch(/OUTCOME_RECORDS_ALTERED: 1/);
    const [shown] = evaluateEvidenceIntegrity().findings.tampered;
    expect(shown.contentHash).not.toBe(shown.storedHash);
    expect(acknowledgeEvidenceFindings('owner', [shown]).ok).toBe(true);
    // Any further edit, to content or to the stored hash, voids the acknowledgement immediately.
    run('UPDATE ditas_trade_outcomes SET net_pnl=net_pnl+1 WHERE position_id=?', positionId);
    expect(evaluateEvidenceIntegrity().findings.tampered.map((f) => f.positionId)).toEqual([positionId]);
  });

  it('flags a record whose payload cannot be parsed instead of failing the check', () => {
    const positionId = closedTrade(id, last); linkClosedTrades(Date.now() + 1);
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run("UPDATE ditas_trade_outcomes SET payload='{broken' WHERE position_id=?", positionId);
    expect(refreshOutcomeHashCheck()).toMatchObject({ tampered: [positionId], lastError: null });
    expect(evaluateEvidenceIntegrity().findings.tampered).toEqual([expect.objectContaining({ positionId, kind: 'TAMPERED' })]);
    expect(() => acknowledgeEvidenceFindings('owner', [{ positionId, kind: 'TAMPERED', storedHash: 'x', contentHash: null }])).toThrow(/without a content hash/);
  });

  it('keeps denying for a flagged record that no longer exists', () => {
    setSetting(HASH_CHECK_KEY, { checkedAt: 1, checked: 1, tampered: ['pos_gone'], lastAttemptAt: 1, lastError: null });
    expect(integrityDenial(id, last)[0]).toMatch(/TAMPERED_RECORD_MISSING: 1/);
  });

  it('denies when the last hash check could not run, keeping the last completed result', () => {
    closedTrade(id, last); linkClosedTrades(Date.now() + 1);
    expect(refreshOutcomeHashCheck(1_000).lastError).toBeNull();
    run('ALTER TABLE ditas_trade_outcomes RENAME TO ditas_trade_outcomes_moved');
    const failed = refreshOutcomeHashCheck(2_000);
    run('ALTER TABLE ditas_trade_outcomes_moved RENAME TO ditas_trade_outcomes');
    expect(failed).toMatchObject({ checkedAt: 1_000, lastAttemptAt: 2_000, lastError: expect.stringMatching(/no such table/) });
    expect(integrityDenial(id, last)[0]).toMatch(/HASH_CHECK_FAILED/);
    expect(refreshOutcomeHashCheck(3_000).lastError).toBeNull();
    expect(integrityDenial(id, last)).toEqual([]);
  });

  it('writes the hash check only with the engine lease', () => {
    expect(() => refreshOutcomeHashCheck(Date.now(), { name: 'engine', holder: 'not-the-leader', acquired_at: 1 } as any)).toThrow();
    expect(get('SELECT 1 FROM settings WHERE key=?', HASH_CHECK_KEY)).toBeUndefined();
  });

  it.each([ACK_KEY, HASH_CHECK_KEY])('fails closed when %s is malformed', (key) => {
    run('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?)', key, '{not json', Date.now());
    expect(integrityDenial(id, last)[0]).toMatch(/EVIDENCE_INTEGRITY_INVALID/);
    run('UPDATE settings SET value=? WHERE key=?', J({ unexpected: true }), key);
    expect(integrityDenial(id, last)[0]).toMatch(/EVIDENCE_INTEGRITY_INVALID/);
  });

  it('keeps protecting an open position while integrity is broken', () => {
    const { inst: { id: other }, last: otherLast } = seedInstrument('BTCUSDT', { seed: 3 }) as any;
    const held = openTrade(other, otherLast);
    closedTrade(id, last, { mismatch: true }); linkClosedTrades(Date.now() + 1);
    expect(integrityDenial(id, last)).toHaveLength(1);
    setBook(other, held.stop_price * 0.995);
    monitorPositions();
    expect(get<{ status: string }>('SELECT status FROM positions WHERE id=?', held.id)!.status).toBe('CLOSED');
  });

  it('links the other positions when one fails, and reports the failure', () => {
    const bad = closedTrade(id, last); const good = closedTrade(id, last);
    getDb().exec(`CREATE TRIGGER fail_one BEFORE INSERT ON ditas_trade_outcomes WHEN NEW.position_id='${bad}' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    expect(linkClosedTrades(Date.now() + 1)).toMatchObject({ linked: 1, failed: [bad] });
    expect(all<{ position_id: string }>('SELECT position_id FROM ditas_trade_outcomes').map((r) => r.position_id)).toEqual([good]);
  });
});
