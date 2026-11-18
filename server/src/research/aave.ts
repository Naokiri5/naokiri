/**
 * Aave V3 (Ethereum) flash-loan RESEARCH: read-only on-chain facts plus a hypothetical cost calculator.
 *
 * MIA cannot take a flash loan. There is no transaction builder, no signer, no wallet and no `eth_sendRawTransaction`:
 * the JSON-RPC transport only allows `eth_call`, `eth_chainId` and `eth_blockNumber`, and refuses any other chain than
 * Ethereum mainnet (chain id 1). Contract addresses come from the official BGD Labs `@bgd-labs/aave-address-book`,
 * never typed by hand. Results are RESEARCH_ONLY / tradeEligible:false and never reach the scanner, QCI, decision
 * engine, risk gate or OMS.
 *
 * RPC: MIA_ETH_RPC_URL (an https URL; it may contain a provider key, so it is never logged or returned), default
 * the public `https://ethereum-rpc.publicnode.com`.
 */
import { AaveV3Ethereum } from '@bgd-labs/aave-address-book';
import { createPublicClient, custom, formatUnits, parseAbi, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { fetchProvider, registerProvider, setRateLimit } from '../providers/http.js';

export const ETH_RPC = 'eth-rpc-readonly';
registerProvider({ id: ETH_RPC, name: 'Ethereum JSON-RPC (read-only eth_call)', sourceClass: 'onchain', markets: ['defi-lending'],
  license: 'Public RPC terms of the configured endpoint.', realtime: 'NEAR_REALTIME', requiresCredentials: false,
  note: 'Read-only eth_call for Aave V3 research. No transactions, no signer.' });
setRateLimit(ETH_RPC, 60);

export class AaveResearchError extends Error { statusCode = 400; }
const ALLOWED_RPC = new Set(['eth_call', 'eth_chainId', 'eth_blockNumber']);
const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com';

function rpcUrl() {
  const v = process.env.MIA_ETH_RPC_URL?.trim();
  if (!v) return DEFAULT_RPC;
  let u: URL; try { u = new URL(v); } catch { throw new AaveResearchError('MIA_ETH_RPC_URL is not a valid URL'); }
  if (u.protocol !== 'https:') throw new AaveResearchError('MIA_ETH_RPC_URL must use https');
  return u.href;
}

let rpcId = 0;
/** The only way this module talks to a node: allow-listed read methods through MIA's provider layer. */
export async function readOnlyRpc(method: string, params: unknown[] = []): Promise<unknown> {
  if (!ALLOWED_RPC.has(method)) throw new AaveResearchError(`blocked JSON-RPC method ${method}: Aave research is read-only`);
  const body = await fetchProvider(ETH_RPC, rpcUrl(), { timeoutMs: 15_000, redirectMode: 'error', jsonBody: { jsonrpc: '2.0', id: ++rpcId, method, params } });
  const r = (body ?? {}) as { result?: unknown; error?: { message?: unknown } };
  if (r.error) throw new AaveResearchError(`RPC error: ${String(r.error.message ?? 'unknown').slice(0, 120)}`);
  if (!('result' in r)) throw new AaveResearchError('malformed JSON-RPC response');
  return r.result;
}

const client = createPublicClient({ chain: mainnet, transport: custom({ request: ({ method, params }) => readOnlyRpc(method, (params ?? []) as unknown[]) }) });

const POOL_ABI = parseAbi(['function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)', 'function FLASHLOAN_PREMIUM_TO_PROTOCOL() view returns (uint128)']);
const DP_ABI = parseAbi([
  'function getFlashLoanEnabled(address asset) view returns (bool)',
  'function getPaused(address asset) view returns (bool)',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
]);
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

type AssetKey = keyof typeof AaveV3Ethereum.ASSETS;
export const DEFAULT_ASSETS = ['USDC', 'USDT', 'WETH', 'WBTC', 'DAI'] as const;
export const knownAssets = () => Object.keys(AaveV3Ethereum.ASSETS);

let chainChecked = false;
async function assertMainnet() {
  if (chainChecked) return;
  const id = await readOnlyRpc('eth_chainId');
  if (typeof id !== 'string' || Number.parseInt(id, 16) !== 1) throw new AaveResearchError('configured RPC is not Ethereum mainnet (chain id 1)');
  chainChecked = true;
}
export function _resetAaveForTests() { chainChecked = false; }

/** Flash-loan premium and, per asset, whether flash loans are enabled and how much is available to borrow right now. */
export async function flashLoanReserves(assets: readonly string[] = DEFAULT_ASSETS) {
  const keys = [...new Set(assets.map((a) => a.toUpperCase()))].slice(0, 12);
  for (const k of keys) if (!(k in AaveV3Ethereum.ASSETS)) throw new AaveResearchError(`unknown Aave V3 Ethereum asset ${k}`);
  await assertMainnet();
  const pool = AaveV3Ethereum.POOL as Address; const dp = AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER as Address;
  const [premiumTotal, premiumProtocol] = await Promise.all([
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'FLASHLOAN_PREMIUM_TOTAL' }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: 'FLASHLOAN_PREMIUM_TO_PROTOCOL' }),
  ]);
  const reserves = [];
  for (const k of keys) {
    const a = AaveV3Ethereum.ASSETS[k as AssetKey];
    const settle = async <T>(p: Promise<T>) => { try { return await p; } catch { return null; } }; // one failed read = missing evidence, not zero
    const [enabled, paused, cfg, liquidity] = await Promise.all([
      settle(client.readContract({ address: dp, abi: DP_ABI, functionName: 'getFlashLoanEnabled', args: [a.UNDERLYING as Address] })),
      settle(client.readContract({ address: dp, abi: DP_ABI, functionName: 'getPaused', args: [a.UNDERLYING as Address] })),
      settle(client.readContract({ address: dp, abi: DP_ABI, functionName: 'getReserveConfigurationData', args: [a.UNDERLYING as Address] })),
      settle(client.readContract({ address: a.UNDERLYING as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [a.A_TOKEN as Address] })),
    ]);
    reserves.push({
      asset: k, underlying: a.UNDERLYING, decimals: a.decimals,
      flashLoanEnabled: enabled, paused, active: cfg ? cfg[8] : null, frozen: cfg ? cfg[9] : null,
      availableLiquidity: liquidity === null ? null : formatUnits(liquidity, a.decimals),
      missing: [enabled === null && 'flashLoanEnabled', paused === null && 'paused', cfg === null && 'configuration', liquidity === null && 'liquidity'].filter(Boolean),
    });
  }
  return { source: 'aave-v3-ethereum', fetchedAt: Date.now(), kind: 'RESEARCH_ONLY' as const, tradeEligible: false as const, executable: false as const,
    note: 'Read-only on-chain facts. MIA cannot take, sign or send a flash loan.',
    // premiumTotalBps: fee charged on the borrowed amount (5 = 0.05%). premiumProtocolShareBps: share of that fee that
    // goes to the Aave treasury, in basis points of the fee (10000 = all of it). It is NOT an additional charge.
    data: { chainId: 1, pool: AaveV3Ethereum.POOL, premiumTotalBps: Number(premiumTotal), premiumProtocolShareBps: Number(premiumProtocol), reserves } };
}

export interface FlashLoanScenario { principalUsd: number; premiumBps: number; grossSpreadBps: number; dexFeeBps?: number; slippageBps?: number; gasUnits?: number; gasPriceGwei?: number; ethUsd?: number }
/**
 * Hypothetical economics of a flash-loan round trip. Pure arithmetic for research and education: it assumes the
 * spread is real and capturable at that size, which in practice it usually is not (MEV competition, price impact).
 */
export function flashLoanEconomics(s: FlashLoanScenario) {
  const v = (x: number | undefined, d: number, name: string, max: number) => {
    const n = x ?? d; if (!Number.isFinite(n) || n < 0 || n > max) throw new AaveResearchError(`${name} must be between 0 and ${max}`); return n;
  };
  const principal = v(s.principalUsd, NaN, 'principalUsd', 1e10);
  const premiumBps = v(s.premiumBps, NaN, 'premiumBps', 1000); const spread = v(s.grossSpreadBps, NaN, 'grossSpreadBps', 10_000);
  const dexFee = v(s.dexFeeBps, 60, 'dexFeeBps', 1000); const slip = v(s.slippageBps, 10, 'slippageBps', 1000);
  const gasUnits = v(s.gasUnits, 450_000, 'gasUnits', 30_000_000); const gwei = v(s.gasPriceGwei, 1, 'gasPriceGwei', 10_000); const ethUsd = v(s.ethUsd, 0, 'ethUsd', 1e7);
  const bps = (b: number) => (principal * b) / 10_000;
  const gross = bps(spread); const premium = bps(premiumBps); const fees = bps(dexFee); const slippage = bps(slip);
  const gasUsd = gasUnits * gwei * 1e-9 * ethUsd;
  const net = gross - premium - fees - slippage - gasUsd;
  const breakEvenSpreadBps = principal > 0 ? premiumBps + dexFee + slip + (gasUsd / principal) * 10_000 : null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { kind: 'HYPOTHETICAL' as const, executable: false as const, tradeEligible: false as const,
    assumptions: { principalUsd: principal, premiumBps, grossSpreadBps: spread, dexFeeBps: dexFee, slippageBps: slip, gasUnits, gasPriceGwei: gwei, ethUsd },
    costs: { premiumUsd: r2(premium), dexFeesUsd: r2(fees), slippageUsd: r2(slippage), gasUsd: r2(gasUsd) },
    grossUsd: r2(gross), netUsd: r2(net), breakEvenSpreadBps: breakEvenSpreadBps === null ? null : Math.round(breakEvenSpreadBps * 100) / 100,
    caveats: ['Spreads large enough to cover costs are usually captured first by MEV searchers.', 'Price impact grows with size; this model assumes a fixed slippage.', 'Gas price is set by the caller; ethUsd 0 ignores gas.'] };
}
