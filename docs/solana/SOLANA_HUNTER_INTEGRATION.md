# MIA Solana Hunter: audited starter (read-only)

## Scope and status
This is a **partial implementation** for the existing `Naokiri5/naokiri` TypeScript project. It adds (a) a deterministic, read-only DEX Screener Solana watchlist ranker; (b) a defensive Solana JSON-RPC mint inspector; (c) an authenticated, read-only GMGN OpenAPI client; (d) tests; (e) Claude engineering skill. It does not place orders, connect GMGN accounts, subscribe to Pump.fun events, or certify Solana trades.

### Findings from the current repository
- `server/src/providers/dexscreener.ts` already retrieves token profiles, pairs and search results. It maps chain, age, liquidity, price, buy/sell counts and volumes.
- `server/src/market/discover.ts` already exposes DEX launches but does not explicitly produce a Solana-only watchlist/risk-screen queue.
- `server/src/safety/safety.ts` intentionally returns `eligibleForAutomation: false` for DEX; contract-level checks are incomplete.
- `server/src/providers/pending.ts` registers `solana_rpc` as requiring credentials. Live venue remains locked.
- PR #19 is already developing 1,000-token screening; avoid duplicate high-frequency ingestion logic.

## Uploaded archives audited
| Archive | Source version evidence | License from the upload | Useful concepts / modules | Safe reuse |
|---|---|---|---|---|
| `solana-py-master.zip` and `(1)` | pyproject `solana==0.42.0`; CRC-identical duplicates | MIT | `src/solana/rpc/async_api.py`, `websocket_api.py`, `src/spl/token/_layouts.py` | Use read-only RPC design; original TS implementation instead of a Python hot path |
| `lightweight-charts-master.zip` | package.json `lightweight-charts@5.3.0` | Apache-2.0 | `src/api/chart-api.ts`, candlestick-series API, indicator examples | Integrate npm package in UI separately; preserve attribution |
| `raydium-sdk-V2-master.zip` | package.json `@raydium-io/raydium-sdk-v2@0.2.85-alpha` | GPL-3.0 | `src/raydium/cpmm`, `clmm`, `tradeV2`, `src/api/api.ts` | Use documented external SDK only after licensing review, do not copy/paste source |
| `whirlpools-main.zip` | custom repo-level license; TS/Rust SDKs | Orca License (custom after 2025-02-27) | `legacy-sdk/whirlpool/src`, `ts-sdk/whirlpool`, pool position/quote logic | Review Orca's license before code reuse; use documented SDK interfaces |
| `GMGNAI/gmgn-skills` (GitHub) | Official skill/CLI source | MIT | `gmgn-market`, `gmgn-contract-dd`, `gmgn-track`, `gmgn-wallet-score` | Adapt field-validation/safety concepts and install official authenticated CLI/API |

## How to integrate these files
Copy to the MIA repository, preserving paths:
- `server/src/solana/hunting.ts`
- `server/src/solana/mint-audit.ts`
- `server/src/solana/gmgn-read.ts`
- `server/test/solana-hunter.test.ts`
- `.claude/skills/solana-hunter/SKILL.md`

Add to the existing `server/src/market/discover.ts`:

```ts
import { rankSolanaPairs } from '../solana/hunting.js';
// In discover() return object:
solanaHunt: { source: 'DEX Screener cache', candidates: rankSolanaPairs(market.dex),
  asOf: market.dexFetchedAt, note: 'Monitoring only; token verification and sell simulation missing.' },
```

**Important:** `asOf` must be passed to the client; stale `market.dexFetchedAt` cannot be treated as current. Do not alter the other discovery fields or relax the existing `assessDexPair()` gate.

## Next connectors, in the recommended order
1. **GMGN**: the included read-only client can call market rank, token security/info, top holders and smart-money routes after you provide `GMGN_API_KEY` through a secure server environment. Its responses remain `unknown` until schema-mapped and safety-evaluated; expand it for dev-wallet scoring only after field validation. Respect its rate limits; missing fields stay unknown. Normalize the fractional rate fields (0.1783 = 17.83%) before threshold comparison.
2. **Solana RPC/Helius**: server-configured RPC endpoint and authenticated streaming source, verified mint and Token-2022 extensions. Add holder concentration and funding graph over point-in-time snapshots.
3. **Pump.fun/PumpSwap**: official program ID/IDL or licensed event stream for launch and graduation/migration; distinguish pre-/post-migration pools, never assume a token has tradable liquidity.
4. **DEX Screener**: switch from broad 3-minute profile polling to targeted batches for 1,000-token candidates, with global rate-limit coordinator, cache, and expiry.
5. **Raydium/Orca**: pool-specific reserves, fees, liquidity distribution and simulation through licensed SDK methods. All output is research until validated with an on-chain program account.
6. **Jupiter**: quote and route evaluation, compare effective out amounts after fees and impact, verify mint, slippage and transaction simulation. No production signing in this phase.
7. **Execution**: isolated signer, RPC diversity, transaction simulation, durable intent idempotency, blockhash expiry detection, relay/landing monitoring, exact balance reconciliation, and separately approved bounded live modes.

## High-value safety gates before any automated DEX trade
- Unique mint, correct Solana program and token program owner, valid decimals.
- Mint/freeze authority and Token-2022 flags/extensions known and policy-compliant.
- Holder concentration and creator/insider/related-wallet clustering.
- Buy *and* executable sell routes sized for the intended amount; pool depth and price impact.
- Pool origin and migration state; credible liquidity and exit path; suspect liquidity drain.
- Observed trade provenance and deduplication; detect wash/bot volume.
- Simulated transaction succeeds under current state with priority-fee/compute limits.
- All checks have source timestamp, slot and expiry; fail closed on stale or missing input.
- Capital-at-risk caps and no-trade on conflicting sources.

## Security / license notices
Do not copy large source fragments from GPL-3.0 or the custom Orca License into MIA without a deliberate licensing decision. GMGN metadata is untrusted. Never store signer keys with the AI assistant or browser. Public DEX Screener and GMGN pages are not permission to bypass API terms/rate limits. The provided mint inspector is a *partial* screen; PASS_MINT_CHECKS_ONLY is not a conclusion that the token is safe to buy.

## Offline tests
After copying these files into MIA, run:

```sh
npm run typecheck
npm test -w server -- --run server/test/solana-hunter.test.ts
npm run build
```

Live RPC and venue tests require owner-configured connections and must not be counted as passed until exercised.
