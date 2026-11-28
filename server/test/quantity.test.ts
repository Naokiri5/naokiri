import { describe, it, expect } from 'vitest';
import { normalizeEntryQty, quantityRulesDenial, type QuantityRules } from '../src/risk/quantity.js';

const RULES: QuantityRules = { stepSize: 0.001, minQty: 0.001, minNotional: 10 };
const PRICE = 3_000;

describe('entry quantity normalization', () => {
  it('accepts a quantity exactly on a step boundary unchanged', () => {
    expect(normalizeEntryQty(0.5, RULES, PRICE)).toMatchObject({ ok: true, qty: 0.5 });
    expect(normalizeEntryQty(0.123, RULES, PRICE)).toMatchObject({ ok: true, qty: 0.123 });
  });

  it('floors a quantity slightly above an increment and never rounds up', () => {
    expect(normalizeEntryQty(0.1239999, RULES, PRICE)).toMatchObject({ ok: true, qty: 0.123 });
    expect(normalizeEntryQty(0.12300000001, RULES, PRICE)).toMatchObject({ ok: true, qty: 0.123 });
    // The old epsilon floor turned 0.9999999999 into 1 for a step of 1.
    expect(normalizeEntryQty(0.9999999999 * 3, { stepSize: 1, minQty: 1, minNotional: 0 }, PRICE)).toMatchObject({ ok: true, qty: 2 });
  });

  it('handles binary floating-point sums and exponent notation exactly', () => {
    expect(normalizeEntryQty(0.1 + 0.2, { stepSize: 0.1, minQty: 0, minNotional: 0 }, PRICE)).toMatchObject({ ok: true, qty: 0.3 });
    expect(normalizeEntryQty(1.5e-7 + 0.01, { stepSize: 1e-8, minQty: 0, minNotional: 0 }, 1_000_000)).toMatchObject({ ok: true, qty: 0.01000015 });
    expect(normalizeEntryQty(2e21, { stepSize: 1, minQty: 0, minNotional: 0 }, 1)).toMatchObject({ ok: true, qty: 2e21 });
  });

  it('accepts a quantity equal to the venue minimum and rejects one below it without increasing it', () => {
    expect(normalizeEntryQty(0.004, { ...RULES, minQty: 0.004 }, PRICE)).toMatchObject({ ok: true, qty: 0.004 });
    const below = normalizeEntryQty(0.0039, { ...RULES, minQty: 0.004 }, PRICE);
    expect(below).toMatchObject({ ok: false, qty: 0 });
    expect(below.ok ? '' : below.reason).toMatch(/^SIZE_BELOW_VENUE_MINIMUM qty=0.003 < minQty 0.004/);
  });

  it('rejects a quantity that rounds to zero or misses the minimum notional', () => {
    expect(normalizeEntryQty(0.0009, RULES, PRICE)).toMatchObject({ ok: false, reason: expect.stringMatching(/qty=0 after rounding/) });
    expect(normalizeEntryQty(0.003, RULES, PRICE)).toMatchObject({ ok: false, reason: expect.stringMatching(/notional=9.00 < 10/) });
    // The $5 floor applies when the instrument minimum is lower.
    expect(normalizeEntryQty(0.001, { ...RULES, minNotional: 1 }, PRICE)).toMatchObject({ ok: false, reason: expect.stringMatching(/< 5$/) });
  });

  it('rejects a quantity above the venue maximum', () => {
    expect(normalizeEntryQty(12.5, { ...RULES, maxQty: 10 }, PRICE)).toMatchObject({ ok: false, reason: expect.stringMatching(/^SIZE_ABOVE_VENUE_MAXIMUM/) });
    expect(normalizeEntryQty(10, { ...RULES, maxQty: 10 }, PRICE)).toMatchObject({ ok: true, qty: 10 });
  });

  it.each([
    ['zero step', { stepSize: 0 }], ['negative step', { stepSize: -0.01 }], ['NaN step', { stepSize: Number.NaN }],
    ['step beyond 12 decimals', { stepSize: 1e-13 }], ['negative minQty', { minQty: -1 }], ['NaN minNotional', { minNotional: Number.NaN }],
    ['zero maxQty', { maxQty: 0 }],
  ] as const)('fails closed on invalid instrument rules: %s', (_label, change) => {
    const rules = { ...RULES, ...change } as QuantityRules;
    expect(quantityRulesDenial(rules)).toMatch(/^INSTRUMENT_RULES_INVALID/);
    expect(normalizeEntryQty(1, rules, PRICE)).toMatchObject({ ok: false, qty: 0, reason: expect.stringMatching(/^INSTRUMENT_RULES_INVALID/) });
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [-1]])('rejects a non-finite or negative requested quantity %s', (raw) => {
    expect(normalizeEntryQty(raw, RULES, PRICE)).toMatchObject({ ok: false, reason: expect.stringMatching(/^QTY_INVALID/) });
  });

  it('rejects a missing reference price', () => {
    expect(normalizeEntryQty(1, RULES, 0)).toMatchObject({ ok: false, reason: expect.stringMatching(/^QTY_INVALID: reference price/) });
  });

  it('is deterministic and idempotent', () => {
    const first = normalizeEntryQty(0.98765432, RULES, PRICE);
    expect(normalizeEntryQty(0.98765432, RULES, PRICE)).toEqual(first);
    expect(first.ok && normalizeEntryQty(first.qty, RULES, PRICE)).toEqual(first);
  });
});
