import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { setSetting } from '../src/core/settings.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { takeoverIntegrity } from '../src/ops/integrity.js';
import {
  refreshRuntimeIntegrity, runtimeIntegrityDue, runtimeIntegrityStatus, storeIntegrityResult,
  RUNTIME_INTEGRITY_INTERVAL_MS, RUNTIME_INTEGRITY_KEY, RUNTIME_INTEGRITY_MAX_AGE_MS,
} from '../src/ops/runtimeIntegrity.js';

const T0 = 1_800_000_000_000;
const pass = () => ({ ok: true, checks: [{ name: 'quick_check', ok: true, detail: 'ok' }] });
const fail = () => ({ ok: false, checks: [{ name: 'quick_check', ok: true, detail: 'ok' }, { name: 'ledger reconcile', ok: false, detail: 'drift 1.00' }] });

describe('runtime integrity latch', () => {
  beforeEach(() => freshDb());

  it('does not deny before any check has run, passes a clean result, and denies a failed one', () => {
    expect(runtimeIntegrityStatus(T0)).toMatchObject({ ok: true, record: null });
    storeIntegrityResult(pass(), 'takeover', T0);
    expect(runtimeIntegrityStatus(T0 + 1).ok).toBe(true);
    storeIntegrityResult(fail(), 'runtime', T0 + 2);
    const s = runtimeIntegrityStatus(T0 + 3);
    expect(s.ok).toBe(false);
    expect(s.reasons[0]).toMatch(/^RUNTIME_INTEGRITY_FAILED: ledger reconcile \(drift 1.00\)/);
  });

  it('denies when the check stopped running, and when the stored result is malformed or future-dated', () => {
    storeIntegrityResult(pass(), 'runtime', T0);
    expect(runtimeIntegrityStatus(T0 + RUNTIME_INTEGRITY_MAX_AGE_MS).ok).toBe(true);
    expect(runtimeIntegrityStatus(T0 + RUNTIME_INTEGRITY_MAX_AGE_MS + 1).reasons[0]).toMatch(/^RUNTIME_INTEGRITY_STALE/);
    expect(runtimeIntegrityStatus(T0 - 1).reasons[0]).toMatch(/future/);
    for (const bad of [{ checkedAt: T0, ok: true, failed: [], source: 'other' }, { checkedAt: T0, ok: false, failed: [], source: 'runtime' }, { checkedAt: 'x', ok: true, failed: [], source: 'runtime' }, 'garbage']) {
      setSetting(RUNTIME_INTEGRITY_KEY, bad);
      expect(runtimeIntegrityStatus(T0).reasons[0]).toMatch(/^RUNTIME_INTEGRITY_INVALID/);
    }
  });

  it('re-runs only when due, and stores a check that throws as a failure', () => {
    let runs = 0;
    const counted = () => { runs++; return pass(); };
    expect(refreshRuntimeIntegrity(counted, T0)).not.toBeNull();
    expect(refreshRuntimeIntegrity(counted, T0 + RUNTIME_INTEGRITY_INTERVAL_MS - 1)).toBeNull();
    expect(runtimeIntegrityDue(T0 + RUNTIME_INTEGRITY_INTERVAL_MS)).toBe(true);
    expect(refreshRuntimeIntegrity(() => { throw new Error('disk I/O error'); }, T0 + RUNTIME_INTEGRITY_INTERVAL_MS)).toMatchObject({ ok: false });
    expect(runs).toBe(1);
    expect(runtimeIntegrityStatus(T0 + RUNTIME_INTEGRITY_INTERVAL_MS).reasons[0]).toMatch(/disk I\/O error/);
  });

  it('runs the real takeover checks cleanly on a fresh database', () => {
    const record = refreshRuntimeIntegrity(takeoverIntegrity, T0);
    expect(record).toMatchObject({ ok: true, failed: [], source: 'runtime' });
  });

  it('the risk gate denies new entries while integrity has failed and allows them again once it passes', () => {
    market.reset(); seedInstrument('BTCUSDT');
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 });
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const prop = (k: string) => ({ instrumentId: inst.id, strategyId: 'trend_pullback', side: 'buy' as const, entryPrice: last, stopPrice: last * 0.97, idempotencyKey: k, traceId: 't' });
    expect(evaluateRisk(prop('a')).decision).toBe('ALLOW');
    storeIntegrityResult(fail(), 'runtime', Date.now());
    const denied = evaluateRisk(prop('b'));
    expect(denied.decision).toBe('DENY');
    expect(denied.reasonCodes.some((c) => c.startsWith('RUNTIME_INTEGRITY_FAILED'))).toBe(true);
    storeIntegrityResult(pass(), 'runtime', Date.now());
    expect(evaluateRisk(prop('c')).decision).toBe('ALLOW');
  });
});
