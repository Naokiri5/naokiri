import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import { evaluateLiveReadiness, liveReadinessReport, type LiveReadinessFacts } from '../src/exec/liveReadiness.js';
import { executionAdapter } from '../src/exec/environment.js';
import { newVenueOrderProjection, reduceVenueOrder, toDeterministicVenueClientId, type VenueOrderScope } from '../src/exec/venueOrderState.js';

const SHA = 'a'.repeat(40);
const allGates = Array.from({ length: 14 }, (_, i) => ({
  id: 'G' + String(i + 1).padStart(2, '0'), status: 'PASS' as const,
}));
function allReady(): LiveReadinessFacts {
  return {
    gates: allGates, buildSha: SHA, liveBuildEnabled: true,
    liveAdapter: 'AVAILABLE',
    control: { mode: 'BOUNDED_LIVE', emergency: false, pausedNewOrders: false },
    signerCertified: true, venueCertified: true,
    reconciledAccount: true, protectionVerified: true,
    ownerReleaseGrantVerified: true, independentReleaseApprovalVerified: true,
  };
}
const scope: VenueOrderScope = {
  environment: 'TESTNET', accountId: 'test-acct',
  venueId: 'binance-spot-testnet', clientOrderId: 'mia-001',
};
const make = () => newVenueOrderProjection({
  scope, instrumentId: 'crypto:binance:BTCUSDT', side: 'BUY',
  requestedUnits: '1000', recordedAt: 1000,
});
const ev = (eventId: string, at: number) => ({ scope, eventId, at });

describe('read-only live release witness (G01–G14)', () => {
  it('cannot authorize or sign even if all injected evidence is PASS', () => {
    const r = evaluateLiveReadiness(allReady());
    expect(r).toMatchObject({
      environment: 'LIVE', permission: 'LOCKED', canAuthorizeTrade: false,
      canSignOrder: false, operationalReleaseCertified: false,
      gateSummary: { total: 14, passed: 14, blocked: 0 },
    });
    expect(r.blockers.some(x => x.code === 'READINESS_ONLY_NO_SIGNING_AUTHORITY')).toBe(true);
  });
  it('missing or duplicate gates are not treated as PASS', () => {
    const m = evaluateLiveReadiness({ ...allReady(), gates: allGates.slice(1) });
    expect(m.blockers).toContainEqual({ code: 'GATE_MISSING', gateId: 'G01' });
    const d = evaluateLiveReadiness({ ...allReady(), gates: [...allGates, allGates[0]!] });
    expect(d.blockers).toContainEqual({ code: 'GATE_DUPLICATED', gateId: 'G01' });
  });
  it('rejects absent build SHA, non-PASS gates, absent signer and missing owner grants', () => {
    const f = {
      ...allReady(), buildSha: 'untrusted', liveBuildEnabled: false,
      signerCertified: false, ownerReleaseGrantVerified: false,
      gates: allGates.map(x => x.id === 'G07' ? { ...x, status: 'NOT_IMPLEMENTED' as const } : x),
    };
    const reasons = evaluateLiveReadiness(f).blockers.map(x => x.code);
    expect(reasons).toContain('BUILD_SHA_UNVERIFIED');
    expect(reasons).toContain('GATE_NOT_PASSED');
    expect(reasons).toContain('LIVE_BUILD_DISABLED');
    expect(reasons).toContain('SIGNER_CERTIFICATION_ABSENT');
    expect(reasons).toContain('OWNER_RELEASE_GRANT_ABSENT');
  });
  it('emergency, pause or non-live mode always appear as explicit blockers', () => {
    const x = evaluateLiveReadiness({
      ...allReady(), control: {
        mode: 'PAPER', emergency: true, pausedNewOrders: true,
      },
    });
    const codes = x.blockers.map(b => b.code);
    for (const id of ['MODE_NOT_BOUNDED_LIVE', 'EMERGENCY_ACTIVE', 'NEW_ORDERS_PAUSED'])
      expect(codes).toContain(id);
  });
  it('the real MIA witness never unlocks the existing LIVE adapter', () => {
    const x = liveReadinessReport();
    expect(x.canAuthorizeTrade).toBe(false);
    expect(x.canSignOrder).toBe(false);
    expect(x.blockers).toContainEqual({ code: 'READINESS_ONLY_NO_SIGNING_AUTHORITY' });
    expect(executionAdapter('LIVE').availability().state).toBe('LOCKED');
  });
});

describe('Live readiness HTTP authority boundary', () => {
  it('is owner-session protected and never grants signing or order execution', async () => {
    freshDb();
    const app = await buildApp();
    try {
      const unauth = await app.inject({ method: 'GET', url: '/api/trading/live/readiness' });
      expect(unauth.statusCode).toBe(401);
      const setup = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { password: 'live readiness reporting only' },
      });
      expect(setup.statusCode).toBe(200);
      const cookie = String(setup.headers['set-cookie']).split(';')[0]!;
      const response = await app.inject({
        method: 'GET', url: '/api/trading/live/readiness', headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        environment: 'LIVE', permission: 'LOCKED',
        canAuthorizeTrade: false, canSignOrder: false,
        operationalReleaseCertified: false,
      });
      expect(JSON.stringify(response.json())).not.toMatch(/api[_-]?secret|private[_-]?key/i);
    } finally {
      await app.close();
    }
  });
});

describe('MIA exchange order observation reducer: no orders sent', () => {
  it('scopes TESTNET separately from PAPER/LIVE and keeps retry authority false', () => {
    const p = make();
    expect(p).toMatchObject({
      phase: 'INTENT_RECORDED', confirmedFillUnits: '0',
      canRetryOriginalOrder: false, canAuthorizeTrade: false,
    });
    expect(() => newVenueOrderProjection({
      ...p, scope: { ...scope, environment: 'PAPER' as never },
    })).toThrow('PAPER_OMS_MUST_NOT_USE_VENUE_TRACKER');
    expect(() => newVenueOrderProjection({
      ...p, requestedUnits: '0',
    })).toThrow('ZERO_ORDER_QUANTITY');
  });
  it('acknowledges a venue ID and tracks unique partial fills using atomic quantities', () => {
    const ack = reduceVenueOrder(make(), { ...ev('e1', 1001), kind: 'ACK', venueOrderId: '12345' });
    const partial = reduceVenueOrder(ack, {
      ...ev('e2', 1002), kind: 'FILL', venueTradeId: 'trade-A', quantityUnits: '350',
    });
    const full = reduceVenueOrder(partial, {
      ...ev('e3', 1003), kind: 'FILL', venueTradeId: 'trade-B', quantityUnits: '650',
    });
    expect(partial).toMatchObject({ phase: 'PARTIALLY_FILLED', confirmedFillUnits: '350' });
    expect(full).toMatchObject({ phase: 'FILLED', confirmedFillUnits: '1000' });
    expect(full.fillsByTradeId).toEqual({ 'trade-A': '350', 'trade-B': '650' });
    expect(ack.confirmedFillUnits).toBe('0'); // immutable
  });
  it('identical event replay is idempotent; conflicting event ID is rejected', () => {
    const e = { ...ev('e1', 1001), kind: 'ACK' as const, venueOrderId: '123' };
    const a = reduceVenueOrder(make(), e);
    expect(reduceVenueOrder(a, e)).toBe(a);
    expect(() => reduceVenueOrder(a, { ...e, venueOrderId: '456' }))
      .toThrow('EVENT_ID_COLLISION');
  });
  it('duplicate venue trade IDs never increase fills again', () => {
    let state = reduceVenueOrder(make(), {
      ...ev('a', 1001), kind: 'ACK', venueOrderId: '123',
    });
    state = reduceVenueOrder(state, {
      ...ev('b', 1002), kind: 'FILL', venueTradeId: 'T1', quantityUnits: '300',
    });
    state = reduceVenueOrder(state, {
      ...ev('c', 1003), kind: 'FILL', venueTradeId: 'T1', quantityUnits: '300',
    });
    expect(state.confirmedFillUnits).toBe('300');
    expect(() => reduceVenueOrder(state, {
      ...ev('d', 1004), kind: 'FILL', venueTradeId: 'T1', quantityUnits: '301',
    })).toThrow('TRADE_ID_CONFLICT');
  });
  it('overfills and cross-account events are rejected', () => {
    expect(() => reduceVenueOrder(make(), {
      ...ev('e1', 1001), kind: 'FILL', venueTradeId: 'T1', quantityUnits: '1001',
    })).toThrow('OVERFILL_DETECTED');
    expect(() => reduceVenueOrder(make(), {
      ...ev('e2', 1001), scope: { ...scope, accountId: 'live-account' },
      kind: 'ACK', venueOrderId: '1',
    })).toThrow('ORDER_SCOPE_MISMATCH');
  });
  it('timeout remains UNKNOWN until authoritative REST + trades reconciliation', () => {
    const unknown = reduceVenueOrder(make(), {
      ...ev('e1', 1001), kind: 'UNCERTAIN', reason: 'TIMEOUT',
    });
    const ack = reduceVenueOrder(unknown, {
      ...ev('e2', 1002), kind: 'ACK', venueOrderId: '101',
    });
    expect(ack.phase).toBe('UNKNOWN');
    expect(ack.reconciliationRequired).toBe(true);
    const stream = reduceVenueOrder(ack, {
      ...ev('e3', 1003), kind: 'STATUS', venueOrderId: '101',
      venueStatus: 'NEW', cumulativeUnits: '0', source: 'STREAM',
    });
    expect(stream.phase).toBe('UNKNOWN');
    const rec = reduceVenueOrder(stream, {
      ...ev('e4', 1004), kind: 'STATUS', venueOrderId: '101',
      venueStatus: 'NEW', cumulativeUnits: '0', source: 'REST_AND_TRADES',
    });
    expect(rec.phase).toBe('ACKNOWLEDGED');
    expect(rec.reconciliationRequired).toBe(false);
    expect(rec.canRetryOriginalOrder).toBe(false);
  });
  it('missing trade receipts never become synthetic fills, even if venue says FILLED', () => {
    const x = reduceVenueOrder(make(), {
      ...ev('a', 1001), kind: 'STATUS', source: 'REST_AND_TRADES',
      venueOrderId: '9', venueStatus: 'FILLED', cumulativeUnits: '1000',
    });
    expect(x).toMatchObject({
      phase: 'UNKNOWN', confirmedFillUnits: '0', reconciliationRequired: true,
    });
  });
  it('cancelled orders retain executed partial quantity', () => {
    let x = reduceVenueOrder(make(), { ...ev('a', 1001), kind: 'ACK', venueOrderId: '7' });
    x = reduceVenueOrder(x, {
      ...ev('b', 1002), kind: 'FILL', venueTradeId: 'T1', quantityUnits: '400',
    });
    x = reduceVenueOrder(x, {
      ...ev('c', 1003), kind: 'STATUS', source: 'REST_AND_TRADES',
      venueOrderId: '7', venueStatus: 'CANCELED', cumulativeUnits: '400',
    });
    expect(x).toMatchObject({ phase: 'CANCELED', confirmedFillUnits: '400' });
  });
  it('rejects impossible negative, zero, stale or overly long atomic values', () => {
    for (const bad of ['-1', '0', '1.5', '9'.repeat(41), '1e6'])
      expect(() => reduceVenueOrder(make(), {
        ...ev('bad1', 1001), kind: 'FILL', venueTradeId: 'T1', quantityUnits: bad,
      })).toThrow();
    expect(() => reduceVenueOrder(make(), {
      ...ev('old', 999), kind: 'ACK', venueOrderId: '7',
    })).toThrow('INVALID_EVENT_TIME');
  });
  it('does not double-count replayed fill trade IDs after FILLED status', () => {
    let x = reduceVenueOrder(make(), {
      ...ev('ack', 1001), kind: 'ACK', venueOrderId: '7',
    });
    x = reduceVenueOrder(x, {
      ...ev('fill1', 1002), kind: 'FILL',
      venueTradeId: 'T1', quantityUnits: '1000',
    });
    expect(x.phase).toBe('FILLED');
    const replay = reduceVenueOrder(x, {
      ...ev('fill2', 1003), kind: 'FILL',
      venueTradeId: 'T1', quantityUnits: '1000',
    });
    expect(replay.confirmedFillUnits).toBe('1000');
    expect(replay.version).toBe(x.version + 1);
    expect(() => reduceVenueOrder(replay, {
      ...ev('fill3', 1004), kind: 'FILL',
      venueTradeId: 'T1', quantityUnits: '999',
    })).toThrow('TRADE_ID_CONFLICT');
  });
  it('does not reopen terminal orders from contradictory venue statuses', () => {
    let x = reduceVenueOrder(make(), {
      ...ev('ack', 1001), kind: 'ACK', venueOrderId: '7',
    });
    x = reduceVenueOrder(x, {
      ...ev('fill', 1002), kind: 'FILL', venueTradeId: 'T1',
      quantityUnits: '1000',
    });
    expect(() => reduceVenueOrder(x, {
      ...ev('stale', 1003), kind: 'STATUS', source: 'REST_AND_TRADES',
      venueOrderId: '7', venueStatus: 'NEW', cumulativeUnits: '1000',
    })).toThrow('TERMINAL_STATUS_CONFLICT_REQUIRES_MANUAL_RECONCILIATION');
  });
  it('does not treat fill-less PARTIALLY_FILLED reports as verified', () => {
    const state = reduceVenueOrder(make(), {
      ...ev('e1', 1001), kind: 'STATUS',
      source: 'REST_AND_TRADES', venueStatus: 'PARTIALLY_FILLED',
      venueOrderId: '7', cumulativeUnits: '0',
    });
    expect(state).toMatchObject({
      phase: 'UNKNOWN', confirmedFillUnits: '0', reconciliationRequired: true,
    });
  });
  it('never imports a live signer or network client from the reducer', () => {
    const a = make();
    expect(a.canAuthorizeTrade).toBe(false);
    expect(a.canRetryOriginalOrder).toBe(false);
  });

  it('rejects malformed source event types instead of silently recording them', () => {
    const start = make();
    const invalid = [
      { ...ev('x1', 1001), kind: 'RETRY_APPROVED' },
      { ...ev('x2', 1001), kind: 'UNCERTAIN', reason: 'NOT_SURE' },
      { ...ev('x3', 1001), kind: 'STATUS', source: 'UNVERIFIED',
        venueStatus: 'NEW', cumulativeUnits: '0', venueOrderId: '123' },
      { ...ev('x4', 1001), kind: 'STATUS', source: 'REST_AND_TRADES',
        venueStatus: 'SETTLED_AND_AUTHORIZED', cumulativeUnits: '0', venueOrderId: '123' },
    ];
    for (const record of invalid)
      expect(() => reduceVenueOrder(start, record as never)).toThrow();
    expect(start).toMatchObject({
      phase: 'INTENT_RECORDED', version: 0,
      confirmedFillUnits: '0', canAuthorizeTrade: false,
    });
  });

  it('rejects unsafe dictionary keys and invalid order sides', () => {
    expect(() => newVenueOrderProjection({
      scope, instrumentId: 'crypto:binance:BTCUSDT',
      requestedUnits: '10', recordedAt: 1000, side: 'WITHDRAW' as never,
    })).toThrow('INVALID_ORDER_SIDE');
    expect(() => reduceVenueOrder(make(), {
      ...ev('__proto__', 1001), kind: 'ACK', venueOrderId: '123',
    })).toThrow('INVALID_EVENT_ID');
    expect(() => reduceVenueOrder(make(), {
      ...ev('trade-evil', 1001), kind: 'FILL',
      venueTradeId: 'constructor', quantityUnits: '1',
    })).toThrow('INVALID_VENUE_TRADE_ID');
  });
});


describe('deterministic account-scoped venue identity without execution', () => {
  const base = {
    environment: 'TESTNET' as const, accountId: 'acct-A',
    sleeve: 'stocks_etf' as const, idempotencyKey: 'decision:42',
  };
  it('is stable across retries and obeys venue formats without truncation', () => {
    const one = toDeterministicVenueClientId(base, 'okx');
    expect(toDeterministicVenueClientId({ ...base }, 'okx')).toEqual(one);
    expect(one.canonical).toMatch(/^mia_stocks_etf_[a-f0-9]{16}$/);
    expect(one.venueClientOrderId).toMatch(/^[A-Za-z0-9]{1,32}$/);
    for (const venue of ['binance', 'alpaca', 'solana'] as const) {
      const result = toDeterministicVenueClientId(base, venue);
      expect(result.canonical).toBe(one.canonical);
      expect(result.venueClientOrderId).toBe(one.canonical);
      expect(result.venueClientOrderId.length).toBeLessThanOrEqual(36);
    }
  });
  it('separates accounts, environments and sleeves; never reuses an unrelated intent', () => {
    const id = toDeterministicVenueClientId(base, 'binance').canonical;
    for (const variant of [
      { ...base, accountId: 'acct-B' },
      { ...base, environment: 'LIVE' as const },
      { ...base, sleeve: 'spot' as const },
      { ...base, idempotencyKey: 'decision:43' },
    ]) expect(toDeterministicVenueClientId(variant, 'binance').canonical).not.toBe(id);
    const ids = new Set(Array.from({ length: 100 }, (_, i) =>
      toDeterministicVenueClientId({ ...base, idempotencyKey: 'decision:' + i }, 'binance').canonical));
    expect(ids.size).toBe(100);
  });
  it('rejects malformed future venue/financial scope inputs', () => {
    expect(() => toDeterministicVenueClientId({ ...base, idempotencyKey: '' }, 'binance')).toThrow();
    expect(() => toDeterministicVenueClientId({ ...base, accountId: '' }, 'binance')).toThrow();
    expect(() => toDeterministicVenueClientId({ ...base, environment: 'PAPER' as never }, 'binance')).toThrow();
    expect(() => toDeterministicVenueClientId({ ...base, sleeve: 'unknown' as never }, 'binance')).toThrow();
    expect(() => toDeterministicVenueClientId(base, 'unsupported' as never)).toThrow();
  });
});
