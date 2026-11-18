import { describe, it, expect, beforeEach } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, currentPolicy, exitPolicy, validatePolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, closeAllPositions } from '../src/exec/oms.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { releaseGates } from '../src/qa/gates.js';
import { run, get, J } from '../src/db/db.js';

/**
 * MA-01 / MA-02 / MA-16 (master audit 2026-11-18): an invalid STORED risk policy must deny new entries but must never
 * block, or silently corrupt, the exit of an existing paper position.
 */
let seq = 0;
const report = (id: string, last: number): any => {
  const cid = `cand_${++seq}`; // deterministic ids (CodeRabbit PR #18); expiry below is relative to the same clock submitEntry uses
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } };
};
const storeRaw = (pol: object, version = 99) => run('INSERT INTO risk_policy_versions(version, policy, created_at, accepted_by) VALUES (?,?,?,?)', version, J(pol), Date.now(), 'owner');
const lastExitFee = () => get<{ fees: number }>("SELECT fees FROM orders WHERE purpose LIKE 'EXIT_%' ORDER BY rowid DESC LIMIT 1")?.fees;

describe('invalid stored risk policy vs. exits (MA-01/MA-02)', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: true });
  });

  for (const [label, mutate] of [
    ['missing feeRate', (p: any) => { delete p.feeRate; }],
    ['null feeRate', (p: any) => { p.feeRate = null; }],
    ['negative feeRate', (p: any) => { p.feeRate = -0.001; }],
    ['out-of-range feeRate', (p: any) => { p.feeRate = 0.5; }],
  ] as const) {
    it(`${label}: the stop still executes, with the last valid fee rate`, () => {
      const pol: any = { ...DEFAULT_POLICY }; mutate(pol); storeRaw(pol);
      expect(currentPolicy()!.invalid).toBeTruthy();
      expect(exitPolicy().feeRate).toBe(DEFAULT_POLICY.feeRate); // newest VALID version, never the corrupt row
      setBook(id, last * 0.96); monitorPositions();
      expect(openPositions()).toHaveLength(0);
      const fee = lastExitFee()!;
      expect(Number.isFinite(fee) && fee > 0).toBe(true);
      const pos = get<any>('SELECT realized_pnl, fees FROM positions ORDER BY rowid DESC LIMIT 1');
      expect(Number.isFinite(pos.realized_pnl) && Number.isFinite(pos.fees)).toBe(true);
    });
  }

  it('new entries stay denied while the stored policy is invalid', () => {
    const pol: any = { ...DEFAULT_POLICY }; delete pol.feeRate; storeRaw(pol);
    const r = evaluateRisk({ instrumentId: id, strategyId: 'trend_pullback', side: 'buy', entryPrice: last, stopPrice: last * 0.97, idempotencyKey: 'k', traceId: 't' });
    expect(r.decision).toBe('DENY'); expect(r.reasonCodes.join()).toMatch(/POLICY_INVALID/);
  });

  it('with no valid version at all, exits fall back to the built-in default (never NaN)', () => {
    run('DELETE FROM risk_policy_versions'); storeRaw({ ...DEFAULT_POLICY, feeRate: 'x' }, 1);
    expect(exitPolicy()).toEqual(DEFAULT_POLICY);
  });

  it('close-all keeps going after one position fails', () => {
    const { inst: { id: id2 }, last: l2 } = seedInstrument('SOLUSDT', { seed: 5 }) as any;
    expect(submitEntry(report(id2, l2), 'bot')).toMatchObject({ ok: true });
    market.deep.get(id)!.book = null; // first position cannot be exited (no executable book)
    const r = closeAllPositions('owner', 'CLOSE ALL');
    expect(r.state).toBe('PARTIALLY_COMPLETED');
    expect(openPositions().map((p) => p.instrument)).toEqual([id]); // the second was still closed
  });
});

describe('one validator for accepted and stored policies (MA-16)', () => {
  beforeEach(() => { freshDb(); });
  it('relational rules apply to stored policies too', () => {
    acceptPolicy('owner', DEFAULT_POLICY);
    storeRaw({ ...DEFAULT_POLICY, drawdownWarnPct: 9, drawdownHaltPct: 8 });
    expect(currentPolicy()!.invalid).toMatch(/drawdownHaltPct/);
    expect(() => validatePolicy({ ...DEFAULT_POLICY, weeklyLossPct: 1, dailyLossPct: 2 })).toThrow(/weeklyLossPct/);
  });
  it('release gate G11 reports an invalid stored policy as FAIL, not PASS', () => {
    acceptPolicy('owner', DEFAULT_POLICY);
    expect(releaseGates().gates.find((g) => g.id === 'G11')!.status).toBe('PASS');
    storeRaw({ ...DEFAULT_POLICY, maxOpenRiskPct: 0.1, riskPerTradePct: 1 });
    const g = releaseGates().gates.find((g) => g.id === 'G11')!;
    expect(g.status).toBe('FAIL'); expect(g.evidence).toMatch(/invalid/);
  });
});
