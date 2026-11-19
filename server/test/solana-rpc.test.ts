import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { config } from '../src/config.js';
import { market } from '../src/market/store.js';
import { discover } from '../src/market/discover.js';
import { failureGate } from '../src/core/ratelimit.js';
import { buildApp } from '../src/index.js';
import { fetchProvider, registerProvider, provider, _resetProviderBlocks, ProviderError } from '../src/providers/http.js';
import { getMultipleAccountsParsed, solanaRpcUrl, decodeMultipleAccounts, isSolanaAddress, MAX_RPC_RESPONSE_BYTES, SOLANA_RPC } from '../src/providers/solanaRpc.js';
import { refreshMintChecks, mintCheckFor, mintCheckSummary, watchlistMints, _resetMintChecks, MINT_CHECK_TTL_MS, MINT_CHECK_MAX_AGE_MS, RETRY_AFTER_FAILURE_MS } from '../src/solana/mintChecks.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/solana/mint-audit.js';
import { refreshBackground } from '../src/market/fabric.js';
import type { DexPair } from '../src/providers/dexscreener.js';

/**
 * Omega PR-06: read-only Solana mint checks. fetch is stubbed (this sandbox cannot reach Solana); no network, no signer.
 * The live check against the owner's endpoint is in live.providers.test.ts (opt-in).
 */
const NOW = Date.UTC(2026, 10, 19, 12);
const RPC = 'https://rpc.example.com/?api-key=NOT-A-REAL-KEY-123';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_A = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const MINT_B = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const AUTH = '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj';

const mintAccount = (info: Record<string, unknown>) => ({
  owner: TOKEN_PROGRAM, executable: false, lamports: 1,
  data: { program: 'spl-token', space: 82, parsed: { type: 'mint', info: { decimals: 6, supply: '1000', isInitialized: true, ...info } } },
});
const revoked = mintAccount({ mintAuthority: null, freezeAuthority: null });
const activeMint = mintAccount({ mintAuthority: AUTH, freezeAuthority: null });

const realFetch = globalThis.fetch;
let requests: Array<{ url: string; init: RequestInit | undefined }> = [];
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const stub = (fn: (body: any) => Response) => {
  requests = [];
  globalThis.fetch = (async (u: any, init?: RequestInit) => { requests.push({ url: String(u), init }); return fn(JSON.parse(String(init?.body ?? 'null'))); }) as typeof fetch;
};
const okAccounts = (byMint: Record<string, unknown>, slot = 300_000_000) =>
  stub((body) => reply({ jsonrpc: '2.0', id: 1, result: { context: { slot }, value: (body.params[0] as string[]).map((m) => byMint[m] ?? null) } }));

const base = {
  chainId: 'solana', dexId: 'raydium', pairAddress: USDC, baseSymbol: 'TEST', baseName: 'Mock', priceUsd: 0.01, liquidityUsd: 100_000,
  fdv: 100_000, marketCap: 100_000, volume24h: 90_000, volume1h: 30_000, buys1h: 35, sells1h: 15, change1h: 4, pairCreatedAt: NOW - 60_000,
  url: '', quoteSymbol: 'USDC', quoteAddress: USDC, buys24h: 100, sells24h: 50, change24h: 5, hasSocials: false, hasWebsite: false,
};
const pair = (baseAddress: string, over: Partial<DexPair> = {}): DexPair => ({ ...base, baseAddress, ...over });

const offline = config.offline; const envUrl = process.env.MIA_SOLANA_RPC_URL;
beforeEach(() => { freshDb(); market.reset(); market.dexFetchedAt = 0; _resetProviderBlocks(); _resetMintChecks(); Object.assign(config, { offline: false }); process.env.MIA_SOLANA_RPC_URL = RPC; });
afterEach(() => {
  globalThis.fetch = realFetch; Object.assign(config, { offline }); _resetProviderBlocks(); _resetMintChecks();
  if (envUrl === undefined) delete process.env.MIA_SOLANA_RPC_URL; else process.env.MIA_SOLANA_RPC_URL = envUrl;
});

describe('fetchProvider maxBytes (opt-in response size cap)', () => {
  registerProvider({ id: 'test_maxbytes', name: 'test', sourceClass: 'onchain', markets: [], license: '', realtime: 'NEAR_REALTIME', requiresCredentials: false });
  it('refuses a body whose Content-Length is over the cap, and one that streams past it', async () => {
    globalThis.fetch = (async () => new Response('{"a":1}', { status: 200, headers: { 'content-length': '999999' } })) as typeof fetch;
    await expect(fetchProvider('test_maxbytes', 'https://x.example', { maxBytes: 100 })).rejects.toThrow(/exceeds 100 bytes/);
    globalThis.fetch = (async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode('x'.repeat(40))); c.close(); } }), { status: 200 })) as typeof fetch;
    await expect(fetchProvider('test_maxbytes', 'https://x.example', { maxBytes: 100, as: 'text' })).rejects.toThrow(/exceeds 100 bytes/);
  });
  it('parses a body under the cap exactly as before', async () => {
    globalThis.fetch = (async () => reply({ ok: true })) as typeof fetch;
    await expect(fetchProvider('test_maxbytes', 'https://x.example', { maxBytes: 100 })).resolves.toEqual({ ok: true });
  });
});

describe('Solana RPC transport (read-only)', () => {
  it('reads the endpoint only from MIA_SOLANA_RPC_URL and refuses unusable values', () => {
    expect(solanaRpcUrl()).toBe(RPC);
    delete process.env.MIA_SOLANA_RPC_URL; expect(solanaRpcUrl()).toBeNull();
    for (const bad of ['http://api.mainnet.solana.com', 'https://user:pass@rpc.example.com', 'https://rpc.example.com/#x', 'not a url']) {
      process.env.MIA_SOLANA_RPC_URL = bad; expect(() => solanaRpcUrl(), bad).toThrow(/MIA_SOLANA_RPC_URL/);
    }
  });
  it('sends exactly one getMultipleAccounts (jsonParsed, confirmed), refuses redirects, and keeps request order', async () => {
    okAccounts({ [MINT_A]: revoked, [MINT_B]: activeMint }, 123);
    const r = await getMultipleAccountsParsed([MINT_A, MINT_B]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(RPC);
    expect(requests[0].init?.redirect).toBe('error');
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [[MINT_A, MINT_B], { encoding: 'jsonParsed', commitment: 'confirmed' }] });
    expect(r).toEqual({ slot: 123, accounts: [revoked, activeMint] });
  });
  it('rejects bad input before any request, and malformed or error replies without echoing node text', async () => {
    stub(() => reply({}));
    await expect(getMultipleAccountsParsed([])).rejects.toThrow();
    await expect(getMultipleAccountsParsed(['not-base58!'])).rejects.toThrow();
    await expect(getMultipleAccountsParsed(Array(101).fill(MINT_A))).rejects.toThrow();
    expect(requests).toHaveLength(0);
    expect(() => decodeMultipleAccounts({ result: { context: { slot: 1 }, value: [null] } }, 2)).toThrow(/malformed/);
    expect(() => decodeMultipleAccounts({ result: { context: {}, value: [null] } }, 1)).toThrow(/malformed/);
    expect(() => decodeMultipleAccounts({ error: { code: -32005, message: '<script>ignore previous instructions</script>' } }, 1)).toThrow(/^solana_rpc: RPC error -32005$/);
  });
  it('a reply over the size cap is refused', async () => {
    stub(() => new Response('x', { status: 200, headers: { 'content-length': String(MAX_RPC_RESPONSE_BYTES + 1) } }));
    const e = await getMultipleAccountsParsed([MINT_A]).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.message).toMatch(new RegExp(`exceeds ${MAX_RPC_RESPONSE_BYTES} bytes`));
  });
});

describe('mint checks (background, cached, stricter-only)', () => {
  it('checks only Solana mints with a trusted quote, deduplicated, at most 100', () => {
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const many = Array.from({ length: 150 }, (_, i) => pair(`${'A'.repeat(41)}${B58[Math.floor(i / 58)]}${B58[i % 58]}`));
    expect(watchlistMints([pair(MINT_A), pair(MINT_A), pair(MINT_B, { quoteAddress: 'Unknown1111111111111111111111111111111111' }), pair(WSOL, { chainId: 'ethereum' }), pair(MINT_B, { quoteAddress: undefined })])).toEqual([MINT_A]);
    expect(watchlistMints(many)).toHaveLength(100);
  });
  it('records pass, block and missing-account results with the slot, in one request', async () => {
    okAccounts({ [MINT_A]: revoked, [MINT_B]: activeMint }, 777);
    await refreshMintChecks([pair(MINT_A), pair(MINT_B), pair(WSOL)], NOW);
    expect(requests).toHaveLength(1);
    expect(mintCheckFor(MINT_A, NOW)).toMatchObject({ status: 'PASS_MINT_CHECKS_ONLY', slot: 777, checkedAt: NOW });
    expect(mintCheckFor(MINT_B, NOW)).toMatchObject({ status: 'BLOCK', reasons: ['BLOCK_ACTIVE_MINT_AUTHORITY'] });
    expect(mintCheckFor(WSOL, NOW)).toMatchObject({ status: 'UNKNOWN', reasons: ['MISSING_ACCOUNT'] }); // null account: never a pass
    expect(mintCheckSummary()).toEqual({ configured: true, lastRunAt: NOW, lastError: null, checked: 3 });
  });
  it('does not re-read within the TTL, re-reads after it, and drops mints that left the sample', async () => {
    okAccounts({ [MINT_A]: revoked, [MINT_B]: revoked });
    await refreshMintChecks([pair(MINT_A), pair(MINT_B)], NOW);
    expect(requests).toHaveLength(1);
    await refreshMintChecks([pair(MINT_A)], NOW + 60_000);
    expect(requests).toHaveLength(1); // within the TTL: no new request
    expect(mintCheckSummary().checked).toBe(1); // MINT_B left the sample and was dropped
    await refreshMintChecks([pair(MINT_A)], NOW + MINT_CHECK_TTL_MS);
    expect(requests).toHaveLength(2);
  });
  it('an RPC failure becomes a short code (never the URL); a stale pass stops counting, a stale block still blocks', async () => {
    stub(() => reply({}, 429, { 'retry-after': '1' }));
    await refreshMintChecks([pair(MINT_A)], NOW);
    expect(mintCheckSummary()).toMatchObject({ configured: true, lastError: 'HTTP_429' });
    expect(JSON.stringify(mintCheckSummary())).not.toContain('NOT-A-REAL-KEY');
    expect(mintCheckFor(MINT_A, NOW).status).toBe('NOT_CHECKED');
    _resetProviderBlocks(); _resetMintChecks();
    okAccounts({ [MINT_A]: revoked, [MINT_B]: activeMint });
    await refreshMintChecks([pair(MINT_A), pair(MINT_B)], NOW);
    const later = NOW + MINT_CHECK_MAX_AGE_MS + 1;
    expect(mintCheckFor(MINT_A, later)).toMatchObject({ status: 'NOT_CHECKED', reasons: ['STALE_CHECK'] });
    expect(mintCheckFor(MINT_B, later).status).toBe('BLOCK');
    expect(mintCheckFor(MINT_A, NOW - 1).status).toBe('NOT_CHECKED'); // checked "in the future" (clock jump): does not count
  });
  it('does nothing without MIA_SOLANA_RPC_URL, and runs one request at a time', async () => {
    delete process.env.MIA_SOLANA_RPC_URL;
    okAccounts({ [MINT_A]: revoked });
    await refreshMintChecks([pair(MINT_A)], NOW);
    expect(requests).toHaveLength(0);
    expect(mintCheckSummary()).toEqual({ configured: false, lastRunAt: null, lastError: null, checked: 0 });
    process.env.MIA_SOLANA_RPC_URL = RPC;
    let release!: () => void;
    requests = [];
    globalThis.fetch = (async (u: any, init?: RequestInit) => { requests.push({ url: String(u), init }); await new Promise<void>((r) => { release = r; });
      return reply({ result: { context: { slot: 1 }, value: [revoked] } }); }) as typeof fetch;
    const first = refreshMintChecks([pair(MINT_A)], NOW);
    await new Promise((r) => setTimeout(r, 10));
    await refreshMintChecks([pair(MINT_A)], NOW); // in flight: skipped
    release(); await first;
    expect(requests).toHaveLength(1);
  });
});

describe('watchlist join (discover)', () => {
  it('a BLOCK turns a WATCH row into REJECT and sorts it last; a pass keeps WATCH and adds a note; nothing becomes tradable', async () => {
    okAccounts({ [MINT_A]: revoked, [MINT_B]: activeMint }, 999);
    market.dex = [pair(MINT_A, { liquidityUsd: 100_000 }), pair(MINT_B, { liquidityUsd: 900_000, volume1h: 90_000 })];
    market.dexFetchedAt = NOW - 30_000;
    await refreshMintChecks(market.dex, NOW);
    const s = discover(1e6, NOW).solanaHunter;
    expect(s.candidates.map((c) => [c.mint, c.status])).toEqual([[MINT_A, 'WATCH'], [MINT_B, 'REJECT']]);
    expect(s.candidates[1].blockers).toContain('BLOCK_ACTIVE_MINT_AUTHORITY');
    expect(s.candidates[0].notes.at(-1)).toMatch(/revoked on-chain \(slot 999\)/);
    expect(s.candidates.every((c) => c.tradingEligible === false)).toBe(true);
    expect(s.executionReady).toBe(false);
    expect(s.mintChecks).toMatchObject({ configured: true, lastError: null, checked: 2 });
  });
  it('without checks every row is NOT_CHECKED and statuses are exactly the ranker\'s', () => {
    market.dex = [pair(MINT_A)]; market.dexFetchedAt = NOW - 30_000;
    const s = discover(1e6, NOW).solanaHunter;
    expect(s.candidates[0]).toMatchObject({ status: 'WATCH', mintCheck: { status: 'NOT_CHECKED' } });
  });
  it('/api/discover never reveals the RPC address or its key', async () => {
    failureGate.reset();
    const app = await buildApp();
    try {
      const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('solana rpc owner') })).headers['set-cookie']).split(';')[0];
      const res = await app.inject({ url: '/api/discover', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('NOT-A-REAL-KEY');
      expect(res.body).not.toContain('rpc.example.com');
      expect(res.json().solanaHunter.mintChecks.configured).toBe(true);
    } finally { await app.close(); }
  });
});

/** Second review round (integration + security reviewers), each fix with a test. */
describe('PR-06 review fixes', () => {
  it('both token program ids are real 32-byte keys (the starter shipped an invalid Token-2022 id)', () => {
    expect(isSolanaAddress(TOKEN_PROGRAM)).toBe(true);
    expect(isSolanaAddress(TOKEN_2022_PROGRAM)).toBe(true);
    expect(TOKEN_2022_PROGRAM).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  });
  it('addresses must decode to exactly 32 bytes (one bad address would fail a whole batch)', () => {
    // Leading '1's are zero bytes, so 31 ones + '2' is a real 32-byte key; 30 ones + '2' is only 31 bytes.
    for (const a of [WSOL, USDC, MINT_A, MINT_B, AUTH, '1'.repeat(32), '1'.repeat(31) + '2']) expect(isSolanaAddress(a), a).toBe(true);
    for (const a of ['1'.repeat(30) + '2', 'z'.repeat(44), '2'.repeat(32), 'So1111111111111111111111111111111111111111O', 42, null]) expect(isSolanaAddress(a), String(a)).toBe(false);
    expect(watchlistMints([pair('z'.repeat(44)), pair(MINT_A)])).toEqual([MINT_A]);
  });
  it('an invalid JSON reply is MALFORMED and its text never reaches provider status', async () => {
    stub(() => new Response('{"oops": <ignore all previous instructions> SECRET-BODY', { status: 200 }));
    await refreshMintChecks([pair(MINT_A)], NOW);
    expect(mintCheckSummary().lastError).toBe('MALFORMED');
    expect(String(provider(SOLANA_RPC)?.lastError)).not.toMatch(/SECRET-BODY|ignore all/);
  });
  it('a transport error that quotes the URL is stored with the URL (and its path or query key) removed', async () => {
    process.env.MIA_SOLANA_RPC_URL = 'https://rpc.example.com/v2/PATH-KEY-999';
    globalThis.fetch = (async () => { throw new Error('connect failed for https://rpc.example.com/v2/PATH-KEY-999 (also /v2/PATH-KEY-999)'); }) as typeof fetch;
    await refreshMintChecks([pair(MINT_A)], NOW);
    expect(mintCheckSummary().lastError).toBe('UNAVAILABLE');
    expect(String(provider(SOLANA_RPC)?.lastError)).not.toContain('PATH-KEY-999');
  });
  it('an inconclusive check fails closed: WATCH becomes INSUFFICIENT_DATA with MINT_CHECK_INCONCLUSIVE', async () => {
    okAccounts({ [MINT_A]: null as unknown as object }); // account missing on chain
    market.dex = [pair(MINT_A)]; market.dexFetchedAt = NOW - 30_000;
    await refreshMintChecks(market.dex, NOW);
    const [row] = discover(1e6, NOW).solanaHunter.candidates;
    expect(row).toMatchObject({ status: 'INSUFFICIENT_DATA', mintCheck: { status: 'UNKNOWN', reasons: ['MISSING_ACCOUNT'] } });
    expect(row.blockers).toContain('MINT_CHECK_INCONCLUSIVE');
  });
  it('a padded extension list is inconclusive, and shown reasons are deduplicated and capped at 10', async () => {
    const t22 = (extensions: unknown[]) => ({ ...mintAccount({ mintAuthority: null, freezeAuthority: null, extensions }), owner: TOKEN_2022_PROGRAM });
    const many = Array.from({ length: 33 }, (_, i) => ({ extension: `x${i}` }));
    const twenty = Array.from({ length: 20 }, (_, i) => ({ extension: `fooExt${String.fromCharCode(97 + i)}` }));
    okAccounts({ [MINT_A]: t22(many), [MINT_B]: t22([...twenty, ...twenty.slice(0, 10)]) }); // 30 entries, 20 distinct
    await refreshMintChecks([pair(MINT_A), pair(MINT_B)], NOW);
    expect(mintCheckFor(MINT_A, NOW)).toMatchObject({ status: 'UNKNOWN', reasons: ['EXTENSION_LIST_TOO_LONG'] });
    const b = mintCheckFor(MINT_B, NOW);
    expect(b.reasons).toHaveLength(11);
    expect(b.reasons.at(-1)).toBe('+10 more');
  });
  it('after a failure it waits before asking again (no retry storm against the public endpoint)', async () => {
    stub(() => { throw new TypeError('fetch failed'); });
    await refreshMintChecks([pair(MINT_A)], NOW);
    await refreshMintChecks([pair(MINT_A)], NOW + 30_000);
    expect(requests).toHaveLength(1);
    okAccounts({ [MINT_A]: revoked });
    await refreshMintChecks([pair(MINT_A)], NOW + RETRY_AFTER_FAILURE_MS);
    expect(requests).toHaveLength(1);
    expect(mintCheckFor(MINT_A, NOW + RETRY_AFTER_FAILURE_MS).status).toBe('PASS_MINT_CHECKS_ONLY');
  });
  it('bad pair data can never make the background call reject', async () => {
    await expect(refreshMintChecks([null as unknown as DexPair, pair(MINT_A)], NOW)).resolves.toBeUndefined();
    expect(mintCheckSummary().lastError).toBe('UNAVAILABLE');
  });
  it('fabric.refreshBackground starts exactly one batched mint check after a DEX refresh', async () => {
    const t = Date.now();
    market.cgFetchedAt = t; market.fxFetchedAt = t; market.dexFetchedAt = 0;
    const rpcBodies: unknown[] = [];
    globalThis.fetch = (async (u: any, init?: RequestInit) => {
      const url = String(u);
      if (url.includes('token-profiles')) return reply([{ chainId: 'solana', tokenAddress: MINT_A }]);
      if (url.includes('/tokens/v1/solana/')) return reply([{ chainId: 'solana', dexId: 'raydium', pairAddress: USDC, priceUsd: '1', liquidity: { usd: 100_000 },
        baseToken: { address: MINT_A, symbol: 'AAA', name: 'A' }, quoteToken: { address: USDC, symbol: 'USDC' } }]);
      if (url === RPC) { rpcBodies.push(JSON.parse(String(init?.body))); return reply({ result: { context: { slot: 5 }, value: [revoked] } }); }
      return reply({}, 404);
    }) as typeof fetch;
    await refreshBackground();
    await vi.waitFor(() => expect(rpcBodies).toHaveLength(1));
    expect((rpcBodies[0] as { method: string }).method).toBe('getMultipleAccounts');
    await vi.waitFor(() => expect(mintCheckFor(MINT_A).status).toBe('PASS_MINT_CHECKS_ONLY'));
  });
  it('the watchlist note matches the banner when checks are configured', () => {
    expect(discover(1e6, NOW).solanaHunter.note).toMatch(/with read-only on-chain mint checks/);
    delete process.env.MIA_SOLANA_RPC_URL;
    expect(discover(1e6, NOW).solanaHunter.note).toMatch(/Mint checks, holder data and an executable sell route are not yet verified/);
  });
  it('Copy Trading never shows Solana wallet activity as LIVE: it is not built', async () => {
    failureGate.reset();
    const app = await buildApp();
    try {
      const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('copy owner') })).headers['set-cookie']).split(';')[0];
      const c = (await app.inject({ url: '/api/copy', headers: { cookie } })).json();
      const sol = c.requirements.find((r: { providerId: string }) => r.providerId === 'solana_rpc');
      expect(c.status).toBe('BLOCKED');
      expect(sol.status).not.toBe('LIVE');
    } finally { await app.close(); }
  });
  it('an unusable MIA_SOLANA_RPC_URL registers the provider as DOWN, not IDLE', async () => {
    vi.resetModules();
    process.env.MIA_SOLANA_RPC_URL = 'http://plain-http.example.com';
    const http = await import('../src/providers/http.js');
    await import('../src/providers/solanaRpc.js');
    expect(http.provider('solana_rpc')).toMatchObject({ status: 'DOWN' });
    expect(String(http.provider('solana_rpc')?.note)).not.toContain('plain-http.example.com');
  });
});
