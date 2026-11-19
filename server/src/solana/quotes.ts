/**
 * Omega PR-01 (MIA review): quote tokens whose USD value is well established on Solana. DEX Screener's `liquidity.usd`
 * for a pool depends on how it values the pool's quote token; a pool quoted against an attacker-minted token could
 * report a large, meaningless liquidity figure. The watchlist therefore ranks only pools quoted against these mints and
 * reports how many it skipped. Read-only constants: no network I/O, no credentials.
 */
export const TRUSTED_SOLANA_QUOTE_MINTS: ReadonlyMap<string, string> = new Map([
  ['So11111111111111111111111111111111111111112', 'SOL'],   // wrapped SOL
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'], // Circle USDC (SPL)
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT'], // Tether USDT (SPL)
]);

/** A missing or unknown quote address is untrusted (fail closed). */
export const isTrustedSolanaQuote = (quoteAddress: unknown): boolean =>
  typeof quoteAddress === 'string' && TRUSTED_SOLANA_QUOTE_MINTS.has(quoteAddress);
