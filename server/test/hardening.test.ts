import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { assessQuality, QUALITY_LIMITS } from '../src/market/quality.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { FeatureEngine } from '../src/features/indicators.js';
import { synthCandles } from './helpers.js';
import { limiter, failureGate, RateLimitError } from '../src/core/ratelimit.js';
import { loadEvidenceKey } from '../src/config.js';
import * as auth from '../src/api/auth.js';
import { notify, markRead, listNotifications } from '../src/notify/notify.js';
import { recentAudit } from '../src/core/audit.js';
import { addAddress, previewWithdrawal, removeAddress, verifyAddress } from '../src/wallet/wallet.js';

const prop = (id: string, last: number, extra: any = {}) => ({ instrumentId: id, strategyId: 'trend_pullback', side: 'buy' as const, entryPrice: last, stopPrice: last * 0.97, idempotencyKey: `k${Math.random()}`, traceId: 't', ...extra });

describe('risk gate: order-book freshness and non-finite inputs', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('baseline: fresh data is allowed', () => { expect(evaluateRisk(prop(id, last)).decision).toBe('ALLOW'); });
  it('denies sizing against a book older than the execution limit', () => {
    market.deep.get(id)!.book!.ts = Date.now() - QUALITY_LIMITS.maxExecBookAgeMs - 1_000;
    const r = evaluateRisk(prop(id, last));
    expect(r.decision).toBe('DENY'); expect(r.reasonCodes.join()).toMatch(/ORDER_BOOK_STALE/);
  });
  it('denies a NaN, zero or negative entry price instead of skipping the deviation check', () => {
    for (const entryPrice of [NaN, 0, -last]) {
      const r = evaluateRisk(prop(id, last, { entryPrice }));
      expect(r.decision, String(entryPrice)).toBe('DENY'); expect(r.reasonCodes.join()).toMatch(/ENTRY_PRICE_INVALID/);
    }
  });
});

describe('data quality: invalid cross-venue quotes cannot mask a deviation', () => {
  it('a NaN quote is flagged and a real 5% deviation on another venue still fails', () => {
    freshDb(); market.reset(); const { inst } = seedInstrument('ETHUSDT', { seed: 2 });
    const d = market.deep.get(inst.id)!;
    d.cross.coinbase.price = NaN; d.cross.kraken.price *= 1.05;
    const q = assessQuality(inst.id);
    expect(q.status).toBe('FAIL'); expect(q.issues.join()).toMatch(/coinbase quote invalid/); expect(q.issues.join()).toMatch(/deviation/);
  });
});

describe('indicators: flat and NaN input', () => {
  it('flat series gives RSI 50 (not 100) and a finite ADX once prices move', () => {
    const flat = synthCandles(40).map((c) => ({ ...c, o: 50, h: 50, l: 50, c: 50 }));
    const e = new FeatureEngine(); e.ingest(flat);
    expect(e.last!.rsi14).toBe(50);
    const t0 = flat[flat.length - 1].t + 3_600_000;
    e.ingest(synthCandles(60, { t0, start: 50 }));
    expect(Number.isFinite(e.last!.adx14)).toBe(true);
  });
  it('a NaN close does not poison the moving averages', () => {
    const cs = synthCandles(250); cs[120] = { ...cs[120], c: NaN, h: NaN, l: NaN };
    const e = new FeatureEngine(); e.ingest(cs);
    expect(Number.isFinite(e.last!.ema20)).toBe(true); expect(Number.isFinite(e.last!.ema200)).toBe(true);
  });
});

describe('rate limiting', () => {
  it('token bucket allows the burst then answers 429 with a retry hint', () => {
    const l = limiter(6, 2); const t = 1_000_000;
    l.take('a', 'x', t); l.take('a', 'x', t);
    let err: any; try { l.take('a', 'x', t); } catch (e) { err = e; }
    expect(err instanceof RateLimitError).toBe(true); expect(err.statusCode).toBe(429); expect(err.retryAfterSec).toBeGreaterThan(0);
    l.take('b', 'x', t); // other sessions are unaffected
    l.take('a', 'x', t + 10_000); // refilled (6/min ⇒ one token per 10 s)
  });
  it('failed passphrase checks lock a client out, and the global budget holds across many clients', () => {
    failureGate.reset(); const t = 2_000_000;
    for (let i = 0; i < 5; i++) failureGate.fail('1.1.1.1', t);
    expect(() => failureGate.check('1.1.1.1', t + 1)).toThrow(/wait/);
    expect(() => failureGate.check('1.1.1.1', t + 61_000)).not.toThrow();
    failureGate.reset();
    for (let i = 0; i < 20; i++) failureGate.fail(`10.0.0.${i}`, t);
    expect(() => failureGate.check('9.9.9.9', t + 1)).toThrow(/this server/);
    failureGate.reset();
  });
});

describe('passphrase verification is shared by login and step-up', () => {
  it('step-up failures count toward the same lockout as login', () => {
    freshDb(); failureGate.reset(); auth.setupOwner('correct horse battery');
    for (let i = 0; i < 5; i++) expect(() => auth.verifyPassphrase('wrong guess', '5.5.5.5', 'step-up')).toThrow(/step-up/);
    expect(() => auth.verifyPassphrase('correct horse battery', '5.5.5.5', 'step-up')).toThrow(/too many/);
    expect(() => auth.login('correct horse battery', '5.5.5.5')).toThrow(/too many/);
    expect(() => auth.verifyPassphrase('correct horse battery', '6.6.6.6', 'step-up')).not.toThrow();
    failureGate.reset();
  });
});

describe('evidence signing key', () => {
  it('is persisted, reused across restarts, and private', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-key-'));
    try {
      const a = loadEvidenceKey(dir, undefined, true); expect(a.source).toBe('generated'); expect(a.key.length).toBe(32);
      const b = loadEvidenceKey(dir, undefined, true); expect(b.source).toBe('file'); expect(b.key.equals(a.key)).toBe(true);
      expect(readFileSync(join(dir, 'evidence.key'), 'utf8').trim()).toBe(a.key.toString('hex'));
      if (process.platform !== 'win32') expect(statSync(join(dir, 'evidence.key')).mode & 0o077).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects a malformed MIA_EVIDENCE_KEY instead of silently using an empty key', () => {
    expect(() => loadEvidenceKey('/nonexistent', 'my-secret-passphrase', true)).toThrow(/64 hex/);
    expect(() => loadEvidenceKey('/nonexistent', 'ab'.repeat(16), true)).toThrow(/64 hex/); // only 16 bytes
    expect(loadEvidenceKey('/nonexistent', 'ab'.repeat(32), true).source).toBe('env');
  });
});

describe('secrets and records', () => {
  it('withdrawal preview never writes the passphrase to the audit log', () => {
    freshDb();
    const addr = addAddress('owner', 'cold', 'ethereum', '0x52908400098527886E0F7030069857D2E4169EE7');
    previewWithdrawal('owner', { network: 'ethereum', asset: 'ETH', amount: 1, addressId: addr.id, password: 'SECRET-PASS-123' } as any);
    const row = recentAudit(5).find((r: any) => r.action === 'withdrawal.preview') as any;
    expect(row.detail).not.toContain('SECRET-PASS'); expect(row.detail).toContain('"asset":"ETH"');
  });
  it('verify/remove of an unknown address is a 404, not a silent success', () => {
    freshDb();
    expect(() => verifyAddress('owner', 'adr_missing')).toThrow(/not found/);
    expect(() => removeAddress('owner', 'adr_missing')).toThrow(/not found/);
  });
  it('marking an empty id read no longer marks every notification read', () => {
    freshDb(); notify('INFO', 'a'); notify('INFO', 'b');
    markRead('');
    expect(listNotifications(10).filter((n: any) => !n.read)).toHaveLength(2);
    markRead();
    expect(listNotifications(10).filter((n: any) => !n.read)).toHaveLength(0);
  });
});
