/**
 * Narrow GMGN OpenAPI read-only adapter. API contract derived from GMGNAI/gmgn-skills
 * MIT-licensed OpenApiClient.ts. No transaction signing, account management or swapping.
 * All returned data are untrusted/unverified until parsed by a schema-specific normalizer.
 */
const GMGN_HOST = 'https://openapi.gmgn.ai';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTERVAL = new Set(['1m', '5m', '1h', '6h', '24h']);
export class GmgnReadClient {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!apiKey || !apiKey.trim()) throw new Error('GMGN_API_KEY_REQUIRED');
  }

  private async get(path: string, query: Record<string, string | number>): Promise<unknown> {
    // Only hard-coded, reviewed paths can reach this method. Never pass user/metadata-supplied URLs.
    const url = new URL(path, GMGN_HOST);
    for (const [key, value] of Object.entries({ ...query, timestamp: Math.floor(Date.now() / 1000), client_id: crypto.randomUUID() })) {
      url.searchParams.set(key, String(value));
    }
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 4500);
    try {
      const res = await this.fetchImpl(url.toString(), {
        method: 'GET', signal: abort.signal, redirect: 'error',
        headers: { 'X-APIKEY': this.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'MIA-Solana-Hunter/1.0' },
      });
      if (!res.ok) throw new Error(`GMGN_HTTP_${res.status}`);
      const envelope = await res.json() as { code?: unknown; data?: unknown };
      if (!envelope || envelope.code !== 0 || envelope.data === undefined) throw new Error('GMGN_BAD_ENVELOPE');
      return envelope.data;
    } finally { clearTimeout(timeout); }
  }

  /** Exact GMGN route, response is unknown until external schema is verified. */
  tokenSecurity(mint: string) {
    if (!ADDRESS.test(mint)) throw new Error('INVALID_SOLANA_MINT_FORMAT');
    return this.get('/v1/token/security', { chain: 'sol', address: mint });
  }
  tokenInfo(mint: string) {
    if (!ADDRESS.test(mint)) throw new Error('INVALID_SOLANA_MINT_FORMAT');
    return this.get('/v1/token/info', { chain: 'sol', address: mint });
  }
  topHolders(mint: string, limit = 20) {
    if (!ADDRESS.test(mint)) throw new Error('INVALID_SOLANA_MINT_FORMAT');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_LIMIT');
    return this.get('/v1/market/token_top_holders', { chain: 'sol', address: mint, limit });
  }
  trending(interval: '1m' | '5m' | '1h' | '6h' | '24h' = '5m') {
    if (!INTERVAL.has(interval)) throw new Error('INVALID_INTERVAL');
    return this.get('/v1/market/rank', { chain: 'sol', interval });
  }
  smartMoney(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_LIMIT');
    return this.get('/v1/user/smartmoney', { chain: 'sol', limit });
  }
}
