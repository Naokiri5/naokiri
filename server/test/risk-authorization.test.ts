/**
 * Risk authorization hardening: the paper OMS may book an entry only for the exact order an allowed gate decision
 * sized, under the exact policy it evaluated. Seams count execution-adapter calls (the entry depth walk) and change
 * the policy after the gate has run, so each refusal is shown to happen before any fill is simulated or booked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RiskDecision, Sizing } from '../src/risk/gate.js';
import type { PolicyVersion } from '../src/risk/policy.js';

const seam = vi.hoisted(() => ({
  walkBookBuys: 0,
  gateRan: false,
  /** Applied to currentPolicy() once the gate has returned: 'remove' or a version offset. */
  afterGate: null as null | 'remove' | number,
  /** Applied once the entry depth walk has run (i.e. during execution). */
  afterFill: null as null | number,
  filled: false,
}));

vi.mock('../src/market/quality.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/market/quality.js')>();
  return { ...real, walkBook: (...args: Parameters<typeof real.walkBook>) => {
    if (args[1] === 'buy') { seam.walkBookBuys++; seam.filled = true; }
    return real.walkBook(...args);
  } };
});
vi.mock('../src/risk/gate.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/risk/gate.js')>();
  return { ...real, evaluateRisk: (...args: Parameters<typeof real.evaluateRisk>) => {
    const decision = real.evaluateRisk(...args); seam.gateRan = true; return decision;
  } };
});
vi.mock('../src/risk/policy.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/risk/policy.js')>();
  return { ...real, currentPolicy: (): PolicyVersion | null => {
    const pv = real.currentPolicy();
    if (!pv) return pv;
    if (seam.filled && seam.afterFill !== null) return { ...pv, version: pv.version + seam.afterFill };
    if (seam.gateRan && seam.afterGate === 'remove') return null;
    if (seam.gateRan && typeof seam.afterGate === 'number') return { ...pv, version: pv.version + seam.afterGate };
    return pv;
  } };
});

const { freshDb, seedInstrument } = await import('./helpers.js');
const { acceptPolicy, DEFAULT_POLICY } = await import('../src/risk/policy.js');
const { updateControl } = await import('../src/core/mode.js');
const { ledger, PAPER_ACCOUNT, accountState, openPositions } = await import('../src/portfolio/ledger.js');
const { submitEntry } = await import('../src/exec/oms.js');
const { market } = await import('../src/market/store.js');
const { all, run } = await import('../src/db/db.js');
const { issueEntryAuthorization, entryExecutionDenial } = await import('../src/exec/authorization.js');
const { quantityRules } = await import('../src/providers/binance.js');

function report(id: string, last: number, over: Record<string, unknown> = {}) {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2],
    instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] }, ...over } as never;
}

/**
 * Nothing was simulated or booked: no depth walk, no fill, position or non-deposit ledger row. The only order row is
 * the zero-quantity REJECTED record that carries the refusal reason.
 */
function expectNothingExecuted() {
  expect(seam.walkBookBuys).toBe(0);
  const orders = all<{ status: string; qty: number; filled_qty: number | null; reject_reason: string | null }>('SELECT status, qty, filled_qty, reject_reason FROM orders');
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: 'REJECTED', qty: 0 });
  expect(orders[0].filled_qty ?? 0).toBe(0);
  expect(orders[0].reject_reason).toBeTruthy();
  expect(all('SELECT id FROM fills')).toHaveLength(0);
  expect(openPositions()).toHaveLength(0);
  expect(all("SELECT id FROM ledger_entries WHERE kind != 'DEPOSIT'")).toHaveLength(0);
  expect(accountState().cash).toBe(10_000);
}

describe('OMS entry authorization', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    Object.assign(seam, { walkBookBuys: 0, gateRan: false, afterGate: null, afterFill: null, filled: false });
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as never);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    seam.gateRan = false;
  });

  it('books an allowed entry whose executed cost stays within the authorized maximum', () => {
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: true });
    expect(seam.walkBookBuys).toBe(1);
    const order = all<{ qty: number; avg_price: number; fees: number }>("SELECT qty, avg_price, fees FROM orders WHERE purpose='ENTRY'")[0];
    const limitPrice = market.price(id)!.ask * (1 + DEFAULT_POLICY.maxSlippageBps / 10_000);
    expect(order.avg_price).toBeLessThanOrEqual(limitPrice);
    expect(order.qty * order.avg_price + order.fees).toBeLessThanOrEqual(order.qty * limitPrice * (1 + DEFAULT_POLICY.feeRate) + 1e-9);
  });

  it('makes zero execution calls when the risk gate refuses', () => {
    updateControl('owner', { pausedNewOrders: true });
    const result = submitEntry(report(id, last), 'bot');
    expect(result.reason).toMatch(/^LAST_MOMENT_RISK_DENY: .*NEW_ORDERS_PAUSED/);
    expectNothingExecuted();
  });

  it('refuses an expired authorization (consensus expiry) before any execution call', () => {
    const result = submitEntry(report(id, last, { consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() - 1).toISOString() } }), 'bot');
    expect(result.reason).toMatch(/^CONSENSUS_EXPIRED/);
    expectNothingExecuted();
  });

  it('does not fall back to a default policy when the accepted policy disappears after the gate', () => {
    seam.afterGate = 'remove';
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/^POLICY_UNAVAILABLE/);
    expectNothingExecuted();
  });

  it('refuses when the policy version changes between the gate and execution', () => {
    seam.afterGate = 1;
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/^POLICY_VERSION_MISMATCH: authorized v1, current v2/);
    expectNothingExecuted();
  });

  it('refuses at verification, after the depth walk, when the policy changes during execution', () => {
    seam.afterFill = 1;
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/^POLICY_VERSION_MISMATCH/);
    expect(seam.walkBookBuys).toBe(1);
    expect(all('SELECT id FROM fills')).toHaveLength(0);
    expect(openPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });

  it('refuses a stored policy that no longer passes validation', () => {
    run('UPDATE risk_policy_versions SET policy=?', JSON.stringify({ ...DEFAULT_POLICY, maxSlippageBps: 5_000 }));
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/POLICY_INVALID/);
    expectNothingExecuted();
  });

  it('refuses an entry without a positive ask quote', () => {
    Object.assign(market.tickers.get(id)!, { ask: 0 });
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/NO_ASK_QUOTE/);
    expectNothingExecuted();
  });

  it.each([['a zero lot step', { stepSize: 0 }], ['a malformed lot step', { stepSize: Number.NaN }]])('refuses an instrument with %s instead of skipping rounding', (_label, change) => {
    Object.assign(market.instruments.get(id)!, change);
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/INSTRUMENT_RULES_INVALID/);
    expectNothingExecuted();
  });

  it('refuses a sized quantity above the venue maximum', () => {
    Object.assign(market.instruments.get(id)!, { maxQty: market.instruments.get(id)!.minQty || 0.0001 });
    expect(submitEntry(report(id, last), 'bot').reason).toMatch(/SIZE_ABOVE_VENUE_MAXIMUM/);
    expectNothingExecuted();
  });

  it('sizes a second concurrent-lane entry from the cash left after the first, so funds are never spent twice', () => {
    const other = seedInstrument('SOLUSDT', { seed: 3 }) as never as { inst: { id: string }; last: number };
    acceptPolicy('owner', { ...DEFAULT_POLICY, maxPositionNotionalPct: 50 });
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: true });
    const cashAfterFirst = accountState().cash;
    expect(submitEntry(report(other.inst.id, other.last), 'bot')).toMatchObject({ ok: true });
    const second = all<{ qty: number; avg_price: number; fees: number }>("SELECT qty, avg_price, fees FROM orders WHERE instrument=?", other.inst.id)[0];
    expect(second.qty * second.avg_price + second.fees).toBeLessThanOrEqual(cashAfterFirst);
    expect(accountState().cash).toBeGreaterThanOrEqual(0);
  });
});

describe('entry authorization record', () => {
  const sizing = { qty: 0.5, limitPrice: 100, maxCost: 0.5 * 100 * 1.001 } as Sizing;
  const decision = (kind: RiskDecision['decision'], over: Partial<RiskDecision> = {}): RiskDecision =>
    ({ decision: kind, reasonCodes: [], evaluated: {}, sizing, policyVersion: 3, ts: '', traceId: 't', ...over });
  const request = { account: 'paper-bot', instrumentId: 'crypto:binance:ETHUSDT', decisionId: 'dec', actor: 'bot' as const, mode: 'PAPER' as const, issuedAt: 1_000, expiresAt: 61_000 };
  const issued = issueEntryAuthorization(decision('ALLOW'), request);
  const auth = 'authorization' in issued ? issued.authorization : null;
  const fill = { account: 'paper-bot', instrumentId: 'crypto:binance:ETHUSDT', side: 'buy' as const, mode: 'PAPER' as const, qty: 0.5, price: 99.9, fee: 0.04995, policyVersion: 3, nowTs: 2_000 };

  it('issues only from the gate verdict, never from a caller flag', () => {
    expect(auth).toMatchObject({ qty: 0.5, limitPrice: 100, policyVersion: 3, environment: 'PAPER' });
    expect(Object.isFrozen(auth)).toBe(true);
    expect(issueEntryAuthorization(decision('DENY'), request)).toEqual({ reason: 'AUTHORIZATION_REFUSED: risk gate decision DENY' });
    expect(issueEntryAuthorization(decision('DENY'), { ...request, actor: 'owner' })).toMatchObject({ reason: expect.stringMatching(/DENY/) });
    expect(issueEntryAuthorization(decision('NEEDS_REVIEW'), request)).toMatchObject({ reason: expect.stringMatching(/NEEDS_REVIEW/) });
    expect(issueEntryAuthorization(decision('NEEDS_REVIEW'), { ...request, actor: 'owner' })).toHaveProperty('authorization');
  });

  it.each([
    ['missing sizing', decision('ALLOW', { sizing: null }), request],
    ['missing policy version', decision('ALLOW', { policyVersion: null }), request],
    ['non-finite cost', decision('ALLOW', { sizing: { ...sizing, maxCost: Number.NaN } }), request],
    ['already expired evidence', decision('ALLOW'), { ...request, expiresAt: 1_000 }],
    ['a non-paper environment', decision('ALLOW'), { ...request, mode: 'BOUNDED_LIVE' as const }],
    ['incomplete identity', decision('ALLOW'), { ...request, decisionId: '' }],
  ])('refuses to issue with %s', (_label, d, r) => {
    expect(issueEntryAuthorization(d, r)).toHaveProperty('reason');
  });

  it('accepts a fill exactly at the limit price and maximum cost', () => {
    expect(entryExecutionDenial(auth, { ...fill, price: 100, fee: 0.05 })).toBeNull();
    expect(entryExecutionDenial(auth, fill)).toBeNull();
  });

  it.each([
    ['no authorization', null, fill, /^AUTHORIZATION_MISSING/],
    ['a fill above the limit price', auth, { ...fill, price: 100.0000001 }, /^AUTHORIZATION_LIMIT_PRICE/],
    ['fees above the maximum cost', auth, { ...fill, price: 100, fee: 0.06 }, /^AUTHORIZATION_MAX_COST/],
    ['a different quantity', auth, { ...fill, qty: 0.6 }, /^AUTHORIZATION_QTY_MISMATCH/],
    ['another instrument', auth, { ...fill, instrumentId: 'crypto:binance:BTCUSDT' }, /^AUTHORIZATION_INSTRUMENT_MISMATCH/],
    ['another account', auth, { ...fill, account: 'live' }, /^AUTHORIZATION_ACCOUNT_MISMATCH/],
    ['a LIVE environment', auth, { ...fill, mode: 'BOUNDED_LIVE' as const }, /^AUTHORIZATION_ENVIRONMENT_MISMATCH/],
    ['no accepted policy', auth, { ...fill, policyVersion: null }, /^POLICY_UNAVAILABLE/],
    ['a changed policy', auth, { ...fill, policyVersion: 4 }, /^POLICY_VERSION_MISMATCH/],
    ['an expired window', auth, { ...fill, nowTs: 61_000 }, /^AUTHORIZATION_EXPIRED/],
    ['a time before issue', auth, { ...fill, nowTs: 999 }, /^AUTHORIZATION_EXPIRED/],
    ['a negative fee', auth, { ...fill, fee: -1 }, /^AUTHORIZATION_MAX_COST/],
  ])('refuses execution with %s', (_label, a, f, reason) => {
    expect(entryExecutionDenial(a, f)).toMatch(reason);
  });
});

describe('Binance quantity rules', () => {
  it('combines LOT_SIZE and MARKET_LOT_SIZE with the stricter limit of each', () => {
    expect(quantityRules([
      { filterType: 'LOT_SIZE', stepSize: '0.00010000', minQty: '0.00010000', maxQty: '9000.00000000' },
      { filterType: 'MARKET_LOT_SIZE', stepSize: '0.00000000', minQty: '0.00100000', maxQty: '120.50000000' },
    ])).toEqual({ stepSize: 0.0001, minQty: 0.001, maxQty: 120.5 });
  });
  it('fails closed on a missing or malformed lot step and treats a zero maximum as none', () => {
    expect(quantityRules([]).stepSize).toBeNaN();
    expect(quantityRules([{ filterType: 'LOT_SIZE', stepSize: 'abc', minQty: '0', maxQty: '0' }])).toMatchObject({ stepSize: Number.NaN });
    expect(quantityRules([{ filterType: 'LOT_SIZE', stepSize: '0.01', minQty: '0', maxQty: '0' }])).toEqual({ stepSize: 0.01, minQty: 0 });
    expect(quantityRules([{ filterType: 'LOT_SIZE', stepSize: '0.01', minQty: 'x' }]).minQty).toBeNaN();
  });
});
