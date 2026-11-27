/**
 * Exact USDT cash units for the paper ledger.
 *
 * One unit is 1e-8 USDT (USDT_SCALE = 8). Amounts are converted from the shortest round-trip decimal text of the JS
 * number with BigInt arithmetic, never by `amount * 1e8`, and rounded half-to-even at the 8th decimal on write.
 * Units are stored and summed as SQLite INTEGERs. A unit value must be a safe JS integer, which bounds a single value
 * (and every SUM) to about 90 million USDT; larger values throw, so the ledger fails closed instead of losing precision.
 * The legacy REAL `amount` column is kept as written for audit history and is cross-checked against units by reconcile.
 */
export const USDT_SCALE = 8;
const UNITS_PER_USDT = 10 ** USDT_SCALE;
/** The one named float tolerance for money comparisons (1e-6 USDT = 100 units). */
export const MONEY_TOLERANCE = 1e-6;
export const MONEY_TOLERANCE_UNITS = 100;

/** Exact decimal digits and scale of a finite number's shortest round-trip text (plain or exponent notation). */
function decimalParts(value: number): { negative: boolean; digits: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error(`MONEY_INVALID_AMOUNT: ${String(value)}`);
  const [, sign, int, frac = '', exp = '0'] = match;
  const scale = frac.length - Number(exp);
  const digits = BigInt(int + frac);
  return scale >= 0 ? { negative: sign === '-', digits, scale } : { negative: sign === '-', digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

/** Round-half-to-even integer units of 1e-8 USDT. Throws on non-finite input or a value beyond the safe integer range. */
export function toUnits(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error(`MONEY_INVALID_AMOUNT: ${String(amount)}`);
  const { negative, digits, scale } = decimalParts(amount);
  let units: bigint;
  if (scale <= USDT_SCALE) units = digits * 10n ** BigInt(USDT_SCALE - scale);
  else {
    const div = 10n ** BigInt(scale - USDT_SCALE);
    const q = digits / div; const r = digits % div; const twice = r * 2n;
    units = twice > div || (twice === div && q % 2n === 1n) ? q + 1n : q;
  }
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`MONEY_OUT_OF_RANGE: ${String(amount)}`);
  const n = Number(units);
  return negative && n !== 0 ? -n : n;
}

/** Convert units back to a USDT number (nearest double of the exact decimal). */
export function fromUnits(units: number): number {
  if (!Number.isSafeInteger(units)) throw new Error(`MONEY_INVALID_UNITS: ${String(units)}`);
  const negative = units < 0;
  const text = String(Math.abs(units)).padStart(USDT_SCALE + 1, '0');
  const value = Number(`${text.slice(0, -USDT_SCALE)}.${text.slice(-USDT_SCALE)}`);
  return negative ? -value : value;
}

/** Validate a value read from the database as a safe integer of units (bigint accepted when in range). */
export function checkedUnits(v: unknown): number {
  if (typeof v === 'bigint') {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`MONEY_OUT_OF_RANGE: ${v}`);
    return Number(v);
  }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error(`MONEY_INVALID_UNITS: ${String(v)}`);
  return v;
}

export { UNITS_PER_USDT };
