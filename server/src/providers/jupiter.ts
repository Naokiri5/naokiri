/**
 * Jupiter Swap V2 read-only routing quote. GET /swap/v2/order WITHOUT a taker
 * returns a quote, not a transaction. Never call /execute, /build or /submit.
 * Returned prices are information; MIA's risk gate never uses these to grant
 * Solana trading permission. Solana execution remains disabled.
 */
import { fetchProvider, registerProvider, setRateLimit, ProviderError } from './http.js';
import { validSolanaMint } from './helius.js';

registerProvider({
  id: 'jupiter-quote', name: 'Jupiter Swap V2 (quote only)',
  sourceClass: 'aggregator', markets: ['solana'],
  license: 'Jupiter API terms; route and fee conditions may change.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false,
  note: 'GET without taker only. No unsigned transaction, signing, execution or wallet.',
});
setRateLimit('jupiter-quote', 20); // Conservative keyless traffic budget.

const AMOUNT = /^(?:[1-9][0-9]{0,10})$/;
export interface JupiterQuote {
  source: 'jupiter-quote';
  environment: 'READ_ONLY';
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  router: string | null;
  feeBps: number | null;
  transaction: null;
  executable: false;
  safetyVerified: false;
}
export async function jupiterQuote(
  inputMint: string, outputMint: string, amountAtomic: string,
): Promise<JupiterQuote> {
  if (!validSolanaMint(inputMint) || !validSolanaMint(outputMint) ||
    inputMint === outputMint || !AMOUNT.test(amountAtomic))
    throw new ProviderError('jupiter-quote', 'INVALID_QUOTE_INPUT');
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key && /[\r\n]/.test(key)) throw new ProviderError('jupiter-quote', 'INVALID_API_KEY');
  const query = new URLSearchParams({
    inputMint, outputMint, amount: amountAtomic,
  });
  const result = await fetchProvider('jupiter-quote',
    'https://api.jup.ag/swap/v2/order?' + query.toString(), {
      redirectMode: 'error', timeoutMs: 8_000,
      headers: key ? { 'x-api-key': key } : {},
    }) as Record<string, unknown>;
  // /order without taker MUST NOT return anything to sign. Fail closed
  // on an unexpected transaction even if the upstream API changes.
  if (result.transaction != null || result.inAmount !== amountAtomic ||
    typeof result.outAmount !== 'string' || !/^[0-9]+$/.test(result.outAmount) ||
    BigInt(result.outAmount) <= 0n)
    throw new ProviderError('jupiter-quote', 'UNSAFE_OR_INVALID_QUOTE');
  const fee = Number(result.feeBps);
  return {
    source: 'jupiter-quote', environment: 'READ_ONLY',
    inputMint, outputMint, inAmount: amountAtomic,
    outAmount: result.outAmount,
    router: typeof result.router === 'string' ? result.router.slice(0, 60) : null,
    feeBps: result.feeBps == null ? null :
      Number.isFinite(fee) && fee >= 0 && fee <= 10_000 ? fee : null,
    transaction: null, executable: false, safetyVerified: false,
  };
}
