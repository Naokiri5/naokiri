import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { encodeFunctionResult, parseAbi, toFunctionSelector } from 'viem';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import { config } from '../src/config.js';
import { failureGate } from '../src/core/ratelimit.js';
import { _resetProviderBlocks } from '../src/providers/http.js';
import * as llama from '../src/research/defillama.js';
import * as aave from '../src/research/aave.js';

/** DefiLlama + Aave research, offline: global fetch is stubbed with fixture payloads and an encoded fake Ethereum node. */
const realFetch = globalThis.fetch; const flags = { offline: config.offline };
type Handler = (url: string, init: any) => unknown;
let sent: { url: string; body: any }[] = [];
const stub = (h: Handler, status = 200) => { sent = []; globalThis.fetch = (async (u: any, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : undefined; sent.push({ url: String(u), body });
  return new Response(JSON.stringify(h(String(u), body)), { status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch; };
const online = () => Object.assign(config, { offline: false });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, flags); _resetProviderBlocks(); llama._resetDefiCacheForTests(); aave._resetAaveForTests(); delete process.env.MIA_ETH_RPC_URL; });

const POOLS = { status: 'success', data: [
  { pool: 'p-stable', chain: 'Ethereum', project: 'aave-v3', symbol: 'USDC', tvlUsd: 5e8, apy: 4.2, apyBase: 4.2, apyReward: null, stablecoin: true, ilRisk: 'no', exposure: 'single' },
  { pool: 'p-farm', chain: 'Arbitrum', project: 'farmx', symbol: 'ABC-WETH', tvlUsd: 2e6, apy: 380, apyBase: 20, apyReward: 360, stablecoin: false, ilRisk: 'yes', exposure: 'multi' },
  { pool: 'p-small', chain: 'Base', project: 'tiny', symbol: 'USDC', tvlUsd: 5e5, apy: 9, stablecoin: true },
  { pool: 'p-bad-tvl', chain: 'Ethereum', project: 'x', symbol: 'Y', tvlUsd: 'lots', apy: 3 },
  { chain: 'Ethereum', tvlUsd: 1e9, apy: 2 }, // no pool id
  null,
] };

describe('DefiLlama yields', () => {
  it('validates rows, flags risky yields and labels everything research-only', async () => {
    online(); stub(() => POOLS);
    const r = await llama.yieldPools({ minTvlUsd: 0, sort: 'apy' });
    expect(r).toMatchObject({ kind: 'RESEARCH_ONLY', tradeEligible: false, universe: 3, droppedInvalidRows: 3 });
    expect(r.data.map((p) => p.pool)).toEqual(['p-farm', 'p-small', 'p-stable']);
    expect(r.data[0].flags).toEqual(expect.arrayContaining(['APY_OUTLIER', 'REWARD_DEPENDENT', 'IMPERMANENT_LOSS']));
    expect(r.data.find((p) => p.pool === 'p-small')!.flags).toContain('LOW_TVL');
    expect(r.data.find((p) => p.pool === 'p-stable')!.flags).toEqual([]);
  });
  it('filters (min TVL default $1M, chain, stablecoin, excludeFlagged) and caches one fetch', async () => {
    online(); stub(() => POOLS);
    expect((await llama.yieldPools()).data.map((p) => p.pool)).toEqual(['p-stable', 'p-farm']);
    expect((await llama.yieldPools({ chain: 'arbitrum' })).data.map((p) => p.pool)).toEqual(['p-farm']);
    expect((await llama.yieldPools({ stablecoin: true, minTvlUsd: 0 })).data).toHaveLength(2);
    expect((await llama.yieldPools({ excludeFlagged: true, minTvlUsd: 0 })).data.map((p) => p.pool)).toEqual(['p-stable']);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://yields.llama.fi/pools');
  });
  it('rejects an unexpected response shape instead of returning an empty "no yields" answer', async () => {
    online(); stub(() => ({ status: 'error' }));
    await expect(llama.yieldPools()).rejects.toThrow(/unexpected DefiLlama yields response/);
  });
  it('protocol TVL: slug validated, number required; top protocols exclude CEX by default', async () => {
    online(); stub((u) => (u.endsWith('/tvl/aave') ? 1.5e10 : u.endsWith('/protocols') ? [{ name: 'Aave', slug: 'aave', category: 'Lending', chains: ['Ethereum'], tvl: 1.5e10 }, { name: 'Binance', slug: 'binance-cex', category: 'CEX', tvl: 1e11 }, { slug: 'broken', tvl: 'x' }] : 'nope'));
    expect((await llama.protocolTvl('aave')).data).toEqual({ slug: 'aave', tvlUsd: 1.5e10 });
    await expect(llama.protocolTvl('../etc/passwd')).rejects.toThrow(/invalid protocol slug/);
    await expect(llama.protocolTvl('unknown')).rejects.toThrow(/unexpected DefiLlama TVL/);
    expect((await llama.topProtocols(10)).data.map((p) => p.slug)).toEqual(['aave']);
    expect((await llama.topProtocols(10, 'cex')).data.map((p) => p.slug)).toEqual(['binance-cex']);
  });
});

// ---- fake Ethereum node --------------------------------------------------------------------------------------------
const POOL_ABI = parseAbi(['function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)', 'function FLASHLOAN_PREMIUM_TO_PROTOCOL() view returns (uint128)']);
const DP_ABI = parseAbi(['function getFlashLoanEnabled(address asset) view returns (bool)', 'function getPaused(address asset) view returns (bool)',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)']);
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);
const SEL: Record<string, string> = {
  [toFunctionSelector('FLASHLOAN_PREMIUM_TOTAL()')]: encodeFunctionResult({ abi: POOL_ABI, functionName: 'FLASHLOAN_PREMIUM_TOTAL', result: 5n }),
  [toFunctionSelector('FLASHLOAN_PREMIUM_TO_PROTOCOL()')]: encodeFunctionResult({ abi: POOL_ABI, functionName: 'FLASHLOAN_PREMIUM_TO_PROTOCOL', result: 10000n }),
  [toFunctionSelector('getFlashLoanEnabled(address)')]: encodeFunctionResult({ abi: DP_ABI, functionName: 'getFlashLoanEnabled', result: true }),
  [toFunctionSelector('getPaused(address)')]: encodeFunctionResult({ abi: DP_ABI, functionName: 'getPaused', result: false }),
  [toFunctionSelector('getReserveConfigurationData(address)')]: encodeFunctionResult({ abi: DP_ABI, functionName: 'getReserveConfigurationData', result: [6n, 7500n, 7800n, 10450n, 1000n, true, true, false, true, false] }),
  [toFunctionSelector('balanceOf(address)')]: encodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', result: 123_456_789_000n }),
};
const node = (chainId = '0x1', failBalance = false) => (_u: string, b: any) => {
  if (b.method === 'eth_chainId') return { jsonrpc: '2.0', id: b.id, result: chainId };
  if (b.method === 'eth_call') {
    const sel = String(b.params[0].data).slice(0, 10);
    if (failBalance && sel === toFunctionSelector('balanceOf(address)')) return { jsonrpc: '2.0', id: b.id, error: { code: -32000, message: 'execution reverted' } };
    return SEL[sel] ? { jsonrpc: '2.0', id: b.id, result: SEL[sel] } : { jsonrpc: '2.0', id: b.id, error: { code: -32601, message: 'unknown' } };
  }
  return { jsonrpc: '2.0', id: b.id, error: { code: -32601, message: 'method not found' } };
};

describe('Aave V3 flash-loan research', () => {
  it('reads premium, flash-loan flags and available liquidity via eth_call only', async () => {
    online(); stub(node());
    const r = await aave.flashLoanReserves(['usdc']);
    expect(r).toMatchObject({ kind: 'RESEARCH_ONLY', tradeEligible: false, executable: false, data: { chainId: 1, premiumTotalBps: 5, premiumProtocolShareBps: 10000 } });
    expect(r.data.reserves[0]).toMatchObject({ asset: 'USDC', flashLoanEnabled: true, paused: false, active: true, frozen: false, availableLiquidity: '123456.789', missing: [] });
    expect(new Set(sent.map((s) => s.body.method))).toEqual(new Set(['eth_chainId', 'eth_call']));
    expect(sent.every((s) => s.url === 'https://ethereum-rpc.publicnode.com')).toBe(true);
  });
  it('a failed read is reported as missing evidence, never as zero liquidity', async () => {
    online(); stub(node('0x1', true));
    const res = (await aave.flashLoanReserves(['WETH'])).data.reserves[0];
    expect(res.availableLiquidity).toBeNull(); expect(res.missing).toEqual(['liquidity']);
  });
  it('refuses a non-mainnet RPC and unknown assets', async () => {
    online(); stub(node('0x89'));
    await expect(aave.flashLoanReserves(['USDC'])).rejects.toThrow(/not Ethereum mainnet/);
    await expect(aave.flashLoanReserves(['NOTATOKEN'])).rejects.toThrow(/unknown Aave V3 Ethereum asset/);
  });
  it('the RPC transport refuses every state-changing or signing method', async () => {
    online(); stub(node());
    for (const m of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'eth_accounts']) {
      await expect(aave.readOnlyRpc(m, [])).rejects.toThrow(/read-only/);
    }
    expect(sent).toHaveLength(0);
  });
  it('MIA_ETH_RPC_URL must be https and is never echoed in errors', async () => {
    process.env.MIA_ETH_RPC_URL = 'http://node.example/v3/SECRETKEY123';
    await expect(aave.readOnlyRpc('eth_chainId')).rejects.toThrow(/must use https/);
    online(); process.env.MIA_ETH_RPC_URL = 'https://node.example/v3/SECRETKEY123';
    stub(() => ({ jsonrpc: '2.0', id: 1, error: { message: 'rate limited' } }));
    const err: Error = await aave.readOnlyRpc('eth_chainId').then(() => new Error('expected a failure'), (e: Error) => e);
    expect(String(err.message)).not.toContain('SECRETKEY123');
  });
  it('economics calculator: hypothetical, exact arithmetic, break-even spread', () => {
    const r = aave.flashLoanEconomics({ principalUsd: 1_000_000, premiumBps: 5, grossSpreadBps: 100, dexFeeBps: 60, slippageBps: 10, gasUnits: 500_000, gasPriceGwei: 2, ethUsd: 3000 });
    expect(r).toMatchObject({ kind: 'HYPOTHETICAL', executable: false, tradeEligible: false, grossUsd: 10000, costs: { premiumUsd: 500, dexFeesUsd: 6000, slippageUsd: 1000, gasUsd: 3 }, netUsd: 2497, breakEvenSpreadBps: 75.03 });
    expect(() => aave.flashLoanEconomics({ principalUsd: -1, premiumBps: 5, grossSpreadBps: 1 })).toThrow(/principalUsd/);
    expect(() => aave.flashLoanEconomics({ principalUsd: 1, premiumBps: 5, grossSpreadBps: Number.NaN })).toThrow(/grossSpreadBps/);
  });
  it('static guard: no signer, wallet, transaction or trading imports', () => {
    const src = ['aave.ts', 'defillama.ts', 'defiRoutes.ts'].map((f) => readFileSync(new URL(`../src/research/${f}`, import.meta.url), 'utf8')).join('\n');
    expect(src).not.toMatch(/\b(writeContract|sendTransaction|signTransaction|signMessage|privateKeyToAccount|mnemonicToAccount|createWalletClient|simulateContract)\b/);
    expect(src).not.toMatch(/from '\.\.\/(exec|portfolio|risk)\//);
  });
});

describe('DeFi research routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeAll(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: { password: 'defi route owner' } })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); });
  it('owner session required; strict query validation; calculator served', async () => {
    expect((await app.inject({ url: '/api/research/defi/yields' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/research/defi/yields?limit=500', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/research/aave/flashloan?assets=USDC;DROP', headers: { cookie } })).statusCode).toBe(400);
    const sim = await app.inject({ url: '/api/research/aave/flashloan/simulate?principalUsd=100000&premiumBps=5&grossSpreadBps=20', headers: { cookie } });
    expect(sim.statusCode).toBe(200); expect(sim.json()).toMatchObject({ kind: 'HYPOTHETICAL', executable: false });
    online(); stub(() => POOLS);
    const y = await app.inject({ url: '/api/research/defi/yields?stablecoin=true&minTvlUsd=0', headers: { cookie } });
    expect(y.statusCode).toBe(200); expect(y.json().data).toHaveLength(2);
  });
});
