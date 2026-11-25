import { beforeEach, describe, expect, it } from 'vitest';
import { all, get, J, run } from '../src/db/db.js';
import { updateControl } from '../src/core/mode.js';
import type { DecisionReport } from '../src/decision/engine.js';
import { decideApproval, monitorPositions, queueForApproval, submitEntry } from '../src/exec/oms.js';
import { market } from '../src/market/store.js';
import { acquireOrRenewLease, type LeaseFence } from '../src/ops/lease.js';
import {
  buildMandate, classifyEntryScope, mandateEntryDenial, openPaperExposure, realizedNetSince, strategyConfigVersion,
  type MandateColumns,
} from '../src/ops/tradingMandate.js';
import { accountState, ledger, openPositions, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';

const DAY = 86_400_000;
const STRATEGY = { id: 'trend_pullback', version: '1.0.0' };

let candidates = 0;
function report(instrumentId: string, last: number, over: Partial<DecisionReport> = {}): DecisionReport {
  const candidateId = `cand_mandate_${++candidates}`;
  return {
    id: `dec_${candidateId}`, createdAt: new Date().toISOString(), candidateId, traceId: 'trace',
    asset: instrumentId.split(':')[2] ?? instrumentId, instrumentId, market: 'crypto', venue: 'binance',
    strategy: STRATEGY, regime: 'TREND_UP', entryRef: last, stopLoss: last * 0.97,
    takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] }, ...over,
  } as unknown as DecisionReport;
}

const futuresEntry = (last: number) => report('futures:binance-usdm:BTCUSDT', last,
  { market: 'CRYPTO_PERPETUAL_FUTURES', venue: 'binance-usdm', asset: 'BTCUSDT' });
const memecoinEntry = (last: number) => report('solana:MintAddress111:PairAddress111', last,
  { market: 'crypto-dex', venue: 'solana', asset: 'MEME' });

type Lane = 'SPOT_PAPER' | 'FAST' | 'DEEP';
const SCOPE: Record<Lane, string> = { SPOT_PAPER: 'BINANCE_SPOT', FAST: 'SOLANA_MEMECOIN', DEEP: 'FUTURES' };

function seedSession(fence: LeaseFence, opts: { mind?: Lane; environment?: string; ceiling?: number; startedAt?: number } = {}) {
  const startedAt = opts.startedAt ?? Date.now();
  const mind = opts.mind ?? 'SPOT_PAPER';
  run(`INSERT INTO brainos_sessions (session_id, version, state, environment, mind, lease_holder, lease_acquired_at,
    fence_epoch, suspend_reason, started_at, updated_at, market_scope, capital_ceiling, risk_policy_version, authorized_by,
    authorized_at, expires_at, strategy_config_version)
    VALUES ('brainos-autopilot', 1, 'RUNNING', ?, ?, ?, ?, 1, 'NONE', ?, ?, ?, ?, ?, 'owner:test', ?, ?, ?)`,
  opts.environment ?? 'PAPER', mind, fence.holder, fence.acquired_at, startedAt, startedAt, SCOPE[mind],
  opts.ceiling ?? 10_000, currentPolicy()!.version, startedAt, startedAt + DAY, strategyConfigVersion());
}

const T = Date.UTC(2026, 10, 25, 12, 0, 0);
type SessionView = MandateColumns & { environment: string; mind: string; started_at: number | null };
function mandate(over: Partial<SessionView> = {}, at = T): SessionView {
  const merged = {
    environment: 'PAPER', mind: 'SPOT_PAPER', market_scope: 'BINANCE_SPOT', capital_ceiling: 1_000,
    risk_policy_version: currentPolicy()!.version, authorized_by: 'owner:test', authorized_at: at - 1,
    expires_at: at + DAY, strategy_config_version: strategyConfigVersion(), ...over,
  } as SessionView;
  // A mandate is bound to the session start it was granted with unless a test overrides that start.
  return { ...merged, started_at: 'started_at' in over ? over.started_at ?? null : merged.authorized_at };
}

const financialRows = () => ({
  orders: all("SELECT id FROM orders WHERE status <> 'REJECTED'").length,
  fills: all('SELECT id FROM fills').length,
  positions: all('SELECT id FROM positions').length,
  ledger: all("SELECT id FROM ledger_entries WHERE kind <> 'DEPOSIT'").length,
});

describe('trading mandate scope classification', () => {
  beforeEach(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('classifies spot, Solana memecoin, futures and unsupported entries', () => {
    expect(classifyEntryScope({ instrumentId: 'crypto:binance:BTCUSDT', market: 'crypto', venue: 'binance' })).toBe('BINANCE_SPOT');
    expect(classifyEntryScope({ instrumentId: 'crypto:binance:UNKNOWN', market: 'crypto', venue: 'binance' })).toBe('UNSUPPORTED');
    expect(classifyEntryScope({ instrumentId: 'solana:mint:pair', market: 'crypto-dex', venue: 'raydium' })).toBe('SOLANA_MEMECOIN');
    expect(classifyEntryScope({ instrumentId: 'ethereum:token:pair', market: 'crypto-dex', venue: 'uniswap' })).toBe('UNSUPPORTED');
    expect(classifyEntryScope({ instrumentId: 'futures:binance-usdm:BTCUSDT', market: 'CRYPTO_PERPETUAL_FUTURES', venue: 'binance-usdm' })).toBe('FUTURES');
    expect(classifyEntryScope({ instrumentId: 'fx:EURUSD', market: 'forex', venue: 'frankfurter' })).toBe('UNSUPPORTED');
  });
});

describe('trading mandate entry verdicts', () => {
  beforeEach(() => { freshDb(); market.reset(); acceptPolicy('owner', DEFAULT_POLICY); });

  it('requires an accepted policy and validates capital and duration', () => {
    freshDb();
    expect(() => buildMandate('SPOT_PAPER', { capitalCeiling: 100, durationHours: 24 }, { at: 1, availableCash: 1_000, authorizedBy: 'owner' }))
      .toThrow('MANDATE_RISK_POLICY_REQUIRED');
    acceptPolicy('owner', DEFAULT_POLICY);
    expect(buildMandate('FAST', { capitalCeiling: 100, durationHours: 2 }, { at: 1_000, availableCash: 1_000, authorizedBy: 'owner' }))
      .toEqual({ market_scope: 'SOLANA_MEMECOIN', capital_ceiling: 100, risk_policy_version: 1, authorized_by: 'owner',
        authorized_at: 1_000, expires_at: 1_000 + 2 * 3_600_000, strategy_config_version: strategyConfigVersion() });
    expect(buildMandate('DEEP', { capitalCeiling: 100, durationHours: 2 }, { at: 1, availableCash: 1_000, authorizedBy: 'owner' }).market_scope).toBe('FUTURES');
    expect(() => buildMandate('SPOT_PAPER', { capitalCeiling: 1_001, durationHours: 24 }, { at: 1, availableCash: 1_000, authorizedBy: 'owner' }))
      .toThrow('MANDATE_CAPITAL_EXCEEDS_FUNDS');
    expect(() => buildMandate('SPOT_PAPER', { capitalCeiling: Infinity, durationHours: 24 }, { at: 1, availableCash: Infinity, authorizedBy: 'owner' }))
      .toThrow('MANDATE_CAPITAL_INVALID');
  });

  it('denies a FAST session a futures entry and a DEEP session a memecoin entry', () => {
    const fast = mandate({ mind: 'FAST', market_scope: 'SOLANA_MEMECOIN' });
    const deep = mandate({ mind: 'DEEP', market_scope: 'FUTURES' });
    const at = T;
    expect(mandateEntryDenial(fast, at, { scope: 'FUTURES', strategy: STRATEGY })).toBe('MARKET_OUTSIDE_SESSION_MANDATE: FUTURES entry in a SOLANA_MEMECOIN session');
    expect(mandateEntryDenial(fast, at, { scope: 'BINANCE_SPOT', strategy: STRATEGY })).toMatch(/^MARKET_OUTSIDE_SESSION_MANDATE/);
    expect(mandateEntryDenial(fast, at, { scope: 'SOLANA_MEMECOIN', strategy: STRATEGY })).toBeNull();
    expect(mandateEntryDenial(deep, at, { scope: 'SOLANA_MEMECOIN', strategy: STRATEGY })).toBe('MARKET_OUTSIDE_SESSION_MANDATE: SOLANA_MEMECOIN entry in a FUTURES session');
    expect(mandateEntryDenial(deep, at, { scope: 'FUTURES', strategy: STRATEGY })).toBeNull();
    // A mandate cannot be re-scoped away from its lane.
    expect(mandateEntryDenial(mandate({ mind: 'FAST', market_scope: 'FUTURES' }), at, { scope: 'FUTURES', strategy: STRATEGY })).toBe('SESSION_MANDATE_SCOPE_INVALID');
  });

  it('fails closed for LIVE, missing, malformed, expired and outdated mandates', () => {
    const at = T;
    expect(mandateEntryDenial(mandate({ environment: 'LIVE' }), at)).toBe('SESSION_ENVIRONMENT_NOT_PAPER');
    expect(mandateEntryDenial(mandate({ capital_ceiling: null }), at)).toBe('SESSION_MANDATE_MISSING');
    expect(mandateEntryDenial(mandate({ capital_ceiling: -5 }), at)).toBe('SESSION_MANDATE_MISSING');
    expect(mandateEntryDenial(mandate({ market_scope: 'ALL_MARKETS' as never }), at)).toBe('SESSION_MANDATE_MISSING');
    expect(mandateEntryDenial(mandate({ expires_at: at - 2 }), at)).toBe('SESSION_MANDATE_MISSING');
    expect(mandateEntryDenial(mandate({ expires_at: at }), at)).toBe('SESSION_MANDATE_EXPIRED');
    expect(mandateEntryDenial(mandate({ authorized_at: at + 1, expires_at: at + DAY }), at)).toBe('SESSION_MANDATE_CLOCK_INVALID');
    expect(mandateEntryDenial(mandate({ risk_policy_version: 99 }), at)).toBe('SESSION_RISK_POLICY_CHANGED');
    expect(mandateEntryDenial(mandate({ strategy_config_version: 'trend_pullback@0.9.0' }), at)).toBe('SESSION_STRATEGY_CONFIG_CHANGED');
    expect(mandateEntryDenial(mandate(), at, { scope: 'BINANCE_SPOT', strategy: { id: 'trend_pullback', version: '9.9.9' } }))
      .toBe('SESSION_STRATEGY_OUTSIDE_MANDATE');
    expect(mandateEntryDenial(mandate(), at, { scope: 'BINANCE_SPOT', strategy: undefined })).toBe('SESSION_STRATEGY_OUTSIDE_MANDATE');
    expect(mandateEntryDenial(mandate(), at, { scope: 'BINANCE_SPOT', strategy: STRATEGY })).toBeNull();
  });

  it('binds a mandate to the session start it was granted with', () => {
    // A reopen by any code version sets a new start, so a surviving mandate cannot authorize the new session.
    expect(mandateEntryDenial(mandate({ started_at: T + 5 }), T + 10)).toBe('SESSION_MANDATE_NOT_BOUND');
    expect(mandateEntryDenial(mandate({ started_at: null }), T)).toBe('SESSION_MANDATE_NOT_BOUND');
    expect(mandateEntryDenial(mandate(), T)).toBeNull();
  });
});

describe('mandate enforcement at the paper OMS write boundary', () => {
  let id = ''; let last = 0; let engine: LeaseFence;
  let otherId = ''; let otherLast = 0;
  beforeEach(() => {
    freshDb(); market.reset();
    ({ inst: { id: otherId }, last: otherLast } = seedInstrument('BTCUSDT') as { inst: { id: string }; last: number });
    ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as { inst: { id: string }; last: number });
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    engine = acquireOrRenewLease('engine', 'worker', 60_000)!;
  });

  it('rejects an entry whose actual cost exceeds the authorized capital and writes no financial rows', () => {
    seedSession(engine, { ceiling: 50 });
    const result = submitEntry(report(id, last), 'bot', undefined, engine);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^MANDATE_CAPITAL_CEILING: open 0\.00 \+ realized loss 0\.00 \+ entry \d+\.\d{2} exceeds authorized 50\.00$/);
    expect(financialRows()).toEqual({ orders: 0, fills: 0, positions: 0, ledger: 0 });
    expect(get<{ reject_reason: string }>("SELECT reject_reason FROM orders WHERE status='REJECTED'")?.reject_reason).toMatch(/^MANDATE_CAPITAL_CEILING/);
    expect(accountState().cash).toBe(10_000);
  });

  it('counts open exposure toward the ceiling so successive entries cannot exceed it', () => {
    seedSession(engine, { ceiling: 10_000 });
    expect(submitEntry(report(id, last), 'bot', undefined, engine)).toMatchObject({ ok: true });
    const exposure = openPaperExposure();
    expect(exposure).toBeGreaterThan(0);
    run('UPDATE brainos_sessions SET capital_ceiling=?', exposure + 1);
    const second = submitEntry(report(otherId, otherLast), 'bot', undefined, engine);
    expect(second.ok).toBe(false);
    // The first entry's fee is a realized loss under the mandate, so it also counts toward the ceiling.
    expect(second.reason).toMatch(/^MANDATE_CAPITAL_CEILING: open \d+\.\d{2} \+ realized loss [1-9]\d*\.\d{2} \+ entry/);
    expect(openPositions()).toHaveLength(1);
  });

  it('counts net losses realized under the mandate, fees included, toward the ceiling', () => {
    seedSession(engine, { ceiling: 10_000 });
    expect(submitEntry(report(id, last), 'bot', undefined, engine)).toMatchObject({ ok: true });
    setBook(id, last * 0.96);
    monitorPositions(undefined, engine);
    expect(openPositions()).toHaveLength(0);
    const loss = -realizedNetSince(get<{ authorized_at: number }>('SELECT authorized_at FROM brainos_sessions')!.authorized_at);
    expect(loss).toBeGreaterThan(0);
    // A ceiling just above the realized loss leaves no room for another entry, although nothing is open.
    run('UPDATE brainos_sessions SET capital_ceiling=?', loss + 1);
    const next = submitEntry(report(otherId, otherLast), 'bot', undefined, engine);
    expect(next.ok).toBe(false);
    expect(next.reason).toMatch(/^MANDATE_CAPITAL_CEILING: open 0\.00 \+ realized loss \d+\.\d{2} \+ entry/);
    expect(openPositions()).toHaveLength(0);
  });

  it('applies the capital ceiling to owner-approved entries', () => {
    seedSession(engine, { ceiling: 50 });
    const pending = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)',
      pending.id, pending.candidateId, id, 'crypto', 'LONG', pending.strategy.id, pending.decision, 70, Date.now(), J(pending));
    const orderId = queueForApproval(pending, engine)!;
    expect(orderId).toBeTruthy();
    const decided = decideApproval(orderId, true, engine);
    expect(decided.ok).toBe(false);
    expect(decided.reason).toMatch(/^MANDATE_CAPITAL_CEILING/);
    expect(get<{ status: string }>('SELECT status FROM orders WHERE id=?', orderId)?.status).toBe('REJECTED');
    expect(financialRows()).toEqual({ orders: 0, fills: 0, positions: 0, ledger: 0 });
  });

  it.each(['FAST', 'DEEP'] as const)('a %s session cannot submit any entry through the spot paper OMS', (mind) => {
    seedSession(engine, { mind });
    const before = financialRows();
    for (const entry of [report(id, last), futuresEntry(last), memecoinEntry(last)]) {
      expect(submitEntry(entry, 'bot', undefined, engine)).toEqual({ ok: false, reason: 'SESSION_NOT_SPOT_PAPER' });
      expect(queueForApproval({ ...entry, decision: 'APPROVED_FOR_USER_CONFIRMATION' }, engine)).toBeNull();
    }
    expect(financialRows()).toEqual(before);
    expect(all('SELECT id FROM orders')).toHaveLength(0);
  });

  it('a spot session rejects futures and memecoin entries before any fill is simulated', () => {
    seedSession(engine);
    expect(submitEntry(futuresEntry(last), 'bot', undefined, engine)).toEqual({
      ok: false, reason: 'MARKET_OUTSIDE_SESSION_MANDATE: FUTURES entry in a BINANCE_SPOT session' });
    expect(submitEntry(memecoinEntry(last), 'bot', undefined, engine)).toEqual({
      ok: false, reason: 'MARKET_OUTSIDE_SESSION_MANDATE: SOLANA_MEMECOIN entry in a BINANCE_SPOT session' });
    expect(all('SELECT id FROM orders')).toHaveLength(0);
  });

  it('a session recorded as LIVE can never reach the paper fill path', () => {
    seedSession(engine, { environment: 'LIVE' });
    expect(submitEntry(report(id, last), 'bot', undefined, engine)).toEqual({ ok: false, reason: 'SESSION_NOT_SPOT_PAPER' });
    expect(financialRows()).toEqual({ orders: 0, fills: 0, positions: 0, ledger: 0 });
  });

  it('an expired mandate or changed risk policy blocks new entries', () => {
    seedSession(engine, { startedAt: Date.now() - DAY - 1 });
    run('UPDATE brainos_sessions SET expires_at=?', Date.now() - 1);
    expect(submitEntry(report(id, last), 'bot', undefined, engine)).toEqual({ ok: false, reason: 'SESSION_MANDATE_EXPIRED' });
    run('UPDATE brainos_sessions SET expires_at=?', Date.now() + DAY);
    acceptPolicy('owner', { ...DEFAULT_POLICY });
    expect(submitEntry(report(id, last), 'bot', undefined, engine)).toEqual({ ok: false, reason: 'SESSION_RISK_POLICY_CHANGED' });
    expect(openPositions()).toHaveLength(0);
  });
});
