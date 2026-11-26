/**
 * Venue-aware entry quantity normalization, shared by the risk gate and the session simulator.
 *
 * Quantities are floored to the instrument's lot step in exact decimal arithmetic (BigInt atomic units), never rounded
 * up, and checked against the venue limits after rounding. A quantity is never increased to meet a venue minimum.
 * Invalid instrument rules fail closed rather than skipping the rounding.
 */
import type { Instrument } from '../market/types.js';

/** Venue floor applied on top of the instrument's own minimum notional (Binance spot minimums sit at or above it). */
export const MIN_ENTRY_NOTIONAL_USD = 5;
const MAX_STEP_DECIMALS = 12;

export type QuantityRules = Pick<Instrument, 'stepSize' | 'minQty' | 'minNotional'> & { maxQty?: number };
export type QuantityResult =
  | { ok: true; qty: number; units: bigint; scale: number }
  | { ok: false; qty: 0; reason: string };

/** Exact decimal digits of a finite positive number written in plain or exponent notation; null beyond the limit. */
function decimalParts(value: number): { digits: bigint; scale: number } | null {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(text);
  if (!match) return null;
  const [, int, frac = '', exp = '0'] = match;
  const scale = frac.length - Number(exp);
  const digits = BigInt(int + frac);
  return scale >= 0 ? { digits, scale } : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

/** Value expressed in units of 10^-scale, truncated toward zero (never rounds up). */
function toUnits(value: number, scale: number): bigint | null {
  const parts = decimalParts(value);
  if (!parts) return null;
  return parts.scale <= scale
    ? parts.digits * 10n ** BigInt(scale - parts.scale)
    : parts.digits / 10n ** BigInt(parts.scale - scale);
}

function fromUnits(units: bigint, scale: number): number {
  if (scale === 0) return Number(units);
  const text = units.toString().padStart(scale + 1, '0');
  return Number(`${text.slice(0, -scale)}.${text.slice(-scale)}`);
}

const nonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Reason the rules cannot be used for sizing, or null when they are valid. */
export function quantityRulesDenial(rules: QuantityRules): string | null {
  if (!(typeof rules.stepSize === 'number' && Number.isFinite(rules.stepSize) && rules.stepSize > 0)) return 'INSTRUMENT_RULES_INVALID: lot step must be positive';
  const step = decimalParts(rules.stepSize);
  if (!step || step.scale > MAX_STEP_DECIMALS) return 'INSTRUMENT_RULES_INVALID: lot step is not an exact decimal';
  if (!nonNegative(rules.minQty) || !nonNegative(rules.minNotional)) return 'INSTRUMENT_RULES_INVALID: venue minimums must be finite and non-negative';
  if (rules.maxQty !== undefined && !(Number.isFinite(rules.maxQty) && rules.maxQty > 0)) return 'INSTRUMENT_RULES_INVALID: maximum quantity must be positive';
  return null;
}

/**
 * Floor `rawQty` to the lot step and validate it against the venue limits. `refPrice` prices the minimum-notional
 * check; callers pass the best ask, the lowest price an entry can fill at, so the minimum is never overstated.
 */
export function normalizeEntryQty(rawQty: number, rules: QuantityRules, refPrice: number): QuantityResult {
  const invalid = quantityRulesDenial(rules);
  if (invalid) return { ok: false, qty: 0, reason: invalid };
  if (!(Number.isFinite(rawQty) && rawQty >= 0)) return { ok: false, qty: 0, reason: 'QTY_INVALID: requested quantity is not finite' };
  if (!(Number.isFinite(refPrice) && refPrice > 0)) return { ok: false, qty: 0, reason: 'QTY_INVALID: reference price is not positive' };
  const scale = decimalParts(rules.stepSize)!.scale;
  const stepUnits = toUnits(rules.stepSize, scale)!;
  const rawUnits = toUnits(rawQty, scale);
  if (rawUnits === null) return { ok: false, qty: 0, reason: 'QTY_INVALID: requested quantity is not a decimal' };
  const units = (rawUnits / stepUnits) * stepUnits;
  const qty = fromUnits(units, scale);
  const below = (detail: string) => ({ ok: false as const, qty: 0 as const, reason: `SIZE_BELOW_VENUE_MINIMUM ${detail}` });
  if (units <= 0n) return below(`qty=0 after rounding to step ${rules.stepSize}`);
  // Compare in exact units so a minimum equal to the rounded quantity is accepted.
  const minUnits = toUnits(rules.minQty, scale);
  if (minUnits === null || units < minUnits || qty < rules.minQty) return below(`qty=${qty} < minQty ${rules.minQty}`);
  if (rules.maxQty !== undefined && qty > rules.maxQty) return { ok: false, qty: 0, reason: `SIZE_ABOVE_VENUE_MAXIMUM qty=${qty} > maxQty ${rules.maxQty}` };
  const notional = qty * refPrice;
  const minNotional = Math.max(rules.minNotional, MIN_ENTRY_NOTIONAL_USD);
  if (!(notional >= minNotional)) return below(`qty=${qty} notional=${notional.toFixed(2)} < ${minNotional}`);
  return { ok: true, qty, units, scale };
}
