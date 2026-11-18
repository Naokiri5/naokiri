# MIA integrations overview (2026-11-18)

One MIA application. Every integration plugs into the existing core: the provider registry, the owner auth/session gate, the Paper/Live interfaces (`exec/environment.ts`), and the research labelling (`RESEARCH_ONLY`, `tradeEligible: false`). None of them is a second trading engine, a second risk authority or a second ledger. QCI and the deterministic decision engine, risk gate, paper OMS, portfolio ledger and Trader Joe are unchanged.

| Tool | What it does in MIA | Status | Where | Settings (`.env.example`) | Owner action needed |
|---|---|---|---|---|---|
| **Privy** | Owner sign-in (email, social, passkey, wallet). Optional Privy-secured embedded wallet, shown view-only. | Built and offline-tested; not yet tried with a real Privy app | `server/src/security/privy.ts`, `web/src/privy/` · [doc](../operations/PRIVY_SIGN_IN.md) | `MIA_PRIVY_APP_ID`, `MIA_PRIVY_VERIFICATION_KEY` (optional), `MIA_PRIVY_EMBEDDED_WALLETS` (optional) | Create the Privy app, set its App ID and allowed origins, and serve MIA over HTTPS ([Tailscale Funnel](../operations/TAILSCALE_FUNNEL.md)) |
| **CCXT** | Read-only exchange connectivity research (markets, ticker, book, candles) | Built, tested, live-checked (Kraken, Coinbase) | `server/src/research/ccxt*.ts` · [doc](CCXT_RESEARCH.md) | `MIA_CCXT_SANDBOX` (optional) | None. Testnet *order* tests would need testnet keys and a separately reviewed adapter (not built). |
| **Vike Data** | On-chain, Hyperliquid and prediction-market research | Built, tested, live-checked (all 7 endpoints) | `server/src/providers/vike.ts` · [doc](VIKE_INTEGRATION.md) | `MIA_VIKE_API_KEY` (server only) | Keep the key rotated; never paste it in chat |
| **DefiLlama** | Yield pools (with risk flags) and protocol TVL | Built, tested, live-checked | `server/src/research/defillama.ts` · [doc](DEFI_RESEARCH.md) | none (keyless) | Allow `yields.llama.fi` and `api.llama.fi` outbound |
| **Aave V3** | Flash-loan facts (fee, enabled/paused flags, liquidity) plus a hypothetical calculator | Built, tested, live-checked on Ethereum mainnet | `server/src/research/aave.ts` · [doc](DEFI_RESEARCH.md) | `MIA_ETH_RPC_URL` (optional, https) | None (a public node is the default) |
| **NautilusTrader** | Independent simulated-venue backtester; reference for the future Live adapter | Isolated lab, smoke-tested | `research/python/nautilus/` · [doc](PYTHON_RESEARCH_LABS.md) | `MIA_RESEARCH_PYTHON` (optional) | None |
| **Freqtrade** | Strategy and backtest comparison with MIA's Strategy Lab | Isolated lab, smoke-tested (keyless dry run) | `research/python/freqtrade/` · [doc](PYTHON_RESEARCH_LABS.md) | none | None |

## What stays locked

| Locked | How it is enforced |
|---|---|
| Live trading | `LIVE_EXECUTION_AVAILABLE = false`; `LockedLiveExecutionAdapter` refuses every command. |
| Withdrawals | Preview-only; withdrawal freeze. |
| Delegated signing, transaction signing or sending, wallet funding, key export | Not implemented. A CI test fails if MIA's Privy code uses those Privy APIs. |
| Flash-loan execution | There is no transaction builder or signer. The Ethereum node connection only allows `eth_call`, `eth_chainId` and `eth_blockNumber`. |
| Research data | No research adapter imports `exec/`, `portfolio/` or `risk/` (static tests). Research data never votes in QCI or authorizes a trade. |

## Path toward certified autonomous trading

This is an outline, not a promise. Each step needs its own reviewed PR, tests and explicit owner approval.

1. **Evidence.** Run MIA in paper mode long enough to measure decision quality.
   - Compare its paper fills and fees with NautilusTrader on the same data.
   - Compare its strategies with Freqtrade backtests.
2. **Account isolation.**
   - Every order, fill, position and ledger row carries a typed account and environment (`TradingAccountRef`).
   - Durable reservations.
3. **Live adapter design.**
   - Venue client-order-id reconciliation, partial-fill states and verified protective stops.
   - Trade-only credentials, never withdrawal rights.
   - It replaces `LockedLiveExecutionAdapter` only after it passes the Live release tests.
4. **Release gates G07/G08/G12–G14 implemented and passing,** with independent risk review.
5. **Owner enrollment.** Per-account strategy enrollment and explicit owner approval in a separately reviewed live build. A deposit never unlocks any of this.

## Known blockers

- **CI audit job fails.** `npm audit --audit-level=high` reports 12 high-severity findings, all from one cause: an old `zod` 3.x pulled in by Privy's wallet libraries. It was not suppressed; fixing it waits for an upstream release.
- **Privy not live-tested.** That needs the owner's Privy App ID, HTTPS, and a real browser sign-in.
- **Binance through CCXT.** Binance's main API may be geo-blocked from some servers; Kraken and Coinbase Exchange were verified.
