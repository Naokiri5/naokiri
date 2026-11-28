const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A Solana address is a case-sensitive base58 encoding of exactly 32 bytes. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE58_SHAPE.test(value)) return false;
  let decoded = 0n;
  for (const char of value) decoded = decoded * 58n + BigInt(BASE58.indexOf(char));
  let bytes = 0;
  for (; decoded > 0n; decoded >>= 8n) bytes++;
  for (const char of value) {
    if (char !== '1') break;
    bytes++;
  }
  return bytes === 32;
}

// Canonical Solana quotes from the watchlist in Omega PR #46. Ticker text cannot establish quote identity.
const knownQuotes = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);
export const isKnownSolanaQuote = (mint: string | undefined) => mint !== undefined && knownQuotes.has(mint);
