# DeFi research: DefiLlama yields and Aave V3 flash loans (read-only)

Status: **implemented, offline-tested, and live-checked on 2026-11-18.**

- **DefiLlama:** 15,238 yield pools loaded with none rejected; top protocols and Aave's TVL (about $14.8B) read.
- **Aave V3 Ethereum:** flash-loan fee 5 bps (0.05%), all of it going to the Aave treasury. Flash loans enabled for USDC, WETH and WBTC, with their available liquidity read on-chain.

Both are **research only**. They never reach the scanner, QCI, decision engine, risk gate or OMS. Every response says `kind: 'RESEARCH_ONLY'` and `tradeEligible: false`.

## DefiLlama (keyless, public API)

| Route (GET, owner session) | What it returns |
|---|---|
| `/api/research/defi/yields?chain=&project=&stablecoin=&minTvlUsd=&sort=apy\|tvlUsd&excludeFlagged=&limit=` | Yield pools from `yields.llama.fi/pools`, cached for 10 minutes. Minimum TVL defaults to $1M. |
| `/api/research/defi/protocols?limit=&category=` | Top protocols by TVL. Centralised exchanges are excluded unless `category=CEX`. |
| `/api/research/defi/protocol/:slug/tvl` | Current TVL of one protocol. |

Every row is validated, and invalid rows are dropped and counted, never guessed. Yields are **flagged, not hidden**:

- `APY_OUTLIER`: APY above 100%.
- `REWARD_DEPENDENT`: more than half the APY comes from reward tokens.
- `IMPERMANENT_LOSS`: the pool carries impermanent-loss risk.
- `LOW_TVL`: TVL below $1M.
- `APY_MISSING`: no APY reported.

Advertised APY looks backward and is not a forecast.

## Aave V3 flash-loan research

| Route (GET, owner session) | What it returns |
|---|---|
| `/api/research/aave/flashloan?assets=USDC,WETH` | On-chain facts for each asset: flash-loan fee, whether flash loans are enabled, paused, active or frozen, and available liquidity. Defaults to USDC, USDT, WETH, WBTC and DAI. |
| `/api/research/aave/flashloan/simulate?principalUsd=&premiumBps=&grossSpreadBps=&dexFeeBps=&slippageBps=&gasUnits=&gasPriceGwei=&ethUsd=` | A **hypothetical** cost and profit calculation, with a break-even spread. Pure arithmetic: nothing on-chain. |

**MIA cannot take a flash loan.** These protections apply:

- **No transactions.** There is no transaction builder, signer or wallet.
- **Read-only node calls.** The Ethereum node connection allows only `eth_call`, `eth_chainId` and `eth_blockNumber`, and a test proves `eth_sendRawTransaction`, signing and account calls are refused.
- **Mainnet only.** The configured node must report Ethereum mainnet (chain id 1).
- **Official addresses.** Contract addresses come from BGD Labs' `@bgd-labs/aave-address-book`, never typed by hand.
- **Failed reads stay missing.** A failed read is reported as `missing` evidence, never as zero liquidity.

### Ethereum node

`MIA_ETH_RPC_URL` is optional. It must be `https`, and defaults to the public `https://ethereum-rpc.publicnode.com`. If you use a paid node whose URL contains a key, treat the URL as a secret: put it only in the server environment. MIA never logs it or returns it.

## Network hosts

The server needs to reach:

- `yields.llama.fi` and `api.llama.fi`;
- your Ethereum node (default `ethereum-rpc.publicnode.com`).

## Dependencies

- `viem@2.58.0`: ABI encoding and `eth_call`. Only a read-only client is created.
- `@bgd-labs/aave-address-book@4.44.22`: the official Aave address registry.

## Rollback

Revert this PR, or remove these:

- the `defiRoutes(app)` line in `api/routes.ts`;
- `server/src/research/{defillama,aave,defiRoutes}.ts`;
- the test file;
- the two dependencies.

`fetchProvider` gained an optional `jsonBody` (JSON POST). Existing callers are unaffected.
