import { describe, expect, it } from 'vitest';
import { MONEY_TOLERANCE, MONEY_TOLERANCE_UNITS, USDT_SCALE, checkedUnits, fromUnits, toUnits } from '../src/portfolio/money.js';

describe('exact USDT units', () => {
  it('names the scale and tolerance', () => {
    expect(USDT_SCALE).toBe(8);
    expect(MONEY_TOLERANCE).toBe(1e-6);
    expect(MONEY_TOLERANCE_UNITS).toBe(100);
  });
  it('rounds half to even at the 8th decimal, computed exactly', () => {
    expect(toUnits(0.000000005)).toBe(0);   // tie -> even (0)
    expect(toUnits(0.000000015)).toBe(2);   // tie -> even (2)
    expect(toUnits(0.000000025)).toBe(2);   // tie -> even (2)
    expect(toUnits(0.000000035)).toBe(4);
    expect(toUnits(-0.000000005)).toBe(0);
    expect(toUnits(-0.000000015)).toBe(-2);
    expect(toUnits(-0.000000025)).toBe(-2);
    expect(toUnits(0.0000000051)).toBe(1);
    expect(toUnits(0.0000000049)).toBe(0);
    expect(Object.is(toUnits(-0.000000005), -0)).toBe(false);
  });
  it('is exact where float multiplication is not', () => {
    expect(toUnits(1.000000005)).toBe(100000000); // tie -> even
    expect(toUnits(1.000000015)).toBe(100000002);
    expect(toUnits(2.675e-8)).toBe(3);
    expect(toUnits(1.00000000500000001)).toBe(100000000); // text of the double is 1.000000005
    expect(toUnits(0.1 + 0.2)).toBe(30000000);   // 0.30000000000000004 rounds to 0.3
    expect(toUnits(1e-7)).toBe(10);
    expect(toUnits(1.5e-8)).toBe(2);
  });
  it('round-trips typical amounts', () => {
    for (const v of [0, 1, -1, 10000, 0.1, 123.45678912, -99.99999999, 0.00000001, 1e6, 5.5e-7]) expect(fromUnits(toUnits(v))).toBe(v);
    expect(toUnits(1000000)).toBe(100000000000000);
  });
  it('handles extreme magnitudes without -0 or float multiplication', () => {
    expect(toUnits(5e-324)).toBe(0);
    expect(Object.is(toUnits(-1.5e-9), -0)).toBe(false);
    expect(toUnits(-1.5e-9)).toBe(0);
    expect(toUnits(-1.5e-8)).toBe(-2);   // tie on the shortest decimal text -> even
    expect(() => toUnits(1e21)).toThrow('MONEY_OUT_OF_RANGE');
    expect(toUnits(50_000_000.12345678)).toBe(5_000_000_012_345_678);
  });
  it('throws on non-finite and out-of-range input', () => {
    for (const v of [NaN, Infinity, -Infinity]) expect(() => toUnits(v)).toThrow('MONEY_INVALID_AMOUNT');
    expect(() => toUnits(9.1e7)).toThrow('MONEY_OUT_OF_RANGE');
    expect(() => toUnits(-9.1e7)).toThrow('MONEY_OUT_OF_RANGE');
    expect(() => toUnits(1e300)).toThrow('MONEY_OUT_OF_RANGE');
    expect(toUnits(9e7)).toBe(9000000000000000);
    expect(() => fromUnits(1.5)).toThrow();
  });
  it('checkedUnits accepts only safe integers', () => {
    expect(checkedUnits(5)).toBe(5);
    expect(checkedUnits(-7n)).toBe(-7);
    for (const v of [1.5, '5', null, undefined, NaN, Number.MAX_SAFE_INTEGER + 1, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) expect(() => checkedUnits(v)).toThrow();
  });
});
