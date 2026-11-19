# REQUIREMENTS_TRACEABILITY_OMEGA — Omega TASK-00 (2026-11-19)

**Sources:**
- Spec §14 (requirements 001–100) and Appendix A (the original prompt), from `sources/MIA_OMEGA_UNIFIED_CLAUDE_OPUS_CODEX_MASTER_PROMPT.md`.
- No requirement was removed. Appendix A is preserved verbatim in that file.

**Status vocabulary (spec §1):**
- `EXISTING_MAIN`, `EXISTS_OPEN_PR` (in the combined #45 or this draft PR, not on `main`), `UPLOADED_STARTER_ONLY`, `PARTIAL`, `MISSING`, `NEEDS_CREDENTIALS`, `NEEDS_LICENSE_REVIEW`, `TESTNET_ONLY`, `LIVE_LOCKED`.
- **PR-01** means this draft PR (read-only Solana Hunter).

**Verification:**
- A file's presence on `main` versus #45 was checked with `git cat-file -e origin/main:<path>` (see `REPO_INVENTORY.md`).
- Completeness judgements (`PARTIAL`) are reviewer assessments from reading the code. They are not test results.
- An independent read-only audit agent proposed the rows; Claude re-checked them against git and corrected about eight `main`/PR labels.

## Requirements 001–100

| ID | Requirement | Status | Evidence | Gap / note |
|---|---|---|---|---|
| 001 | Validated WS order-book snapshots + replay | EXISTS_OPEN_PR | `market/depthStream.ts`, `test/depth-stream*.test.ts` (#18) | Binance only; no archive replay |
| 002 | Exchange trade/account event subscriptions | MISSING | — | Depth stream is book-only |
| 003 | Solana slot-aware stream decoder + gap replay | MISSING | — | The starter has no stream decoder |
| 004 | Provider health + disconnect failover | PARTIAL | `market/quality.ts`, `ops/readiness.ts` (main); depth-stream backoff (#45) | No provider failover chain |
| 005 | Per-mint/instrument freshness TTLs | PARTIAL | `market/quality.ts` (main); PR-01 watchlist 5-minute TTL, future-dated = stale | No per-mint TTL |
| 006 | Sustained p50/p95/p99 stage tracing | PARTIAL | `core/latency.ts`, `qhef/qhef.ts` (main) | Ring buffers; no sustained ≥10k-event run |
| 007 | Event-loop lag, heap, GC, CPU telemetry | PARTIAL | `qhef/qhef.ts` event-loop delay (main) | Heap/GC/CPU missing |
| 008 | Priority lanes: exits over new candidates | PARTIAL | QHEF lane labels; `monitorPositions` | No scheduler enforcement |
| 009 | Bounded queues, dedup, backpressure | PARTIAL | depth snapshot cap; `fabric/outbox.ts` (#45) | No candidate queue bound |
| 010 | Stale candidate cancellation before OMS | PARTIAL | `expireApprovals`; consensus expiry checks in `submitEntry` (#45) | No general pre-dispatch staleness sweep |
| 011 | Pump.fun mint launch watcher | MISSING | — | Needs verified program and stream provider |
| 012 | Bonding-curve tracker | MISSING | — | |
| 013 | PumpSwap graduation/migration detector | MISSING | — | |
| 014 | Raydium CPMM fresh-pool index | NEEDS_LICENSE_REVIEW | — | Raydium SDK is GPL-3.0; not imported |
| 015 | Raydium CLMM index | NEEDS_LICENSE_REVIEW | — | Same |
| 016 | Orca Whirlpools new-pool watcher | NEEDS_LICENSE_REVIEW | — | Custom Orca license; not imported |
| 017 | DEX Screener new-pair corroboration | PARTIAL | PR-01 `discover().solanaHunter` over the DEX Screener cache | No second-source corroboration yet |
| 018 | Launch source/slot/program provenance trail | MISSING | — | DITAS hash chain can host it |
| 019 | Per-token cross-platform dedup | PARTIAL | PR-01 dedups per mint; `hunt/ranker.ts` identity (#45) | Single platform only |
| 020 | Launch-to-migration archive | MISSING | — | |
| 021 | GMGN market ranking adapter | NEEDS_CREDENTIALS | PR-01 `solana/gmgn-read.ts` `trending()` (inert, not wired) | `GMGN_API_KEY`; ToS/rate limits (PR-05) |
| 022 | GMGN token security | NEEDS_CREDENTIALS | PR-01 `tokenSecurity()` (inert) | Response schema unverified |
| 023 | GMGN top holders | NEEDS_CREDENTIALS | PR-01 `topHolders()` (inert) | Fractional-field normalization pending |
| 024 | GMGN smart-money ingestion | NEEDS_CREDENTIALS | PR-01 `smartMoney()` (inert) | |
| 025 | GMGN developer/reputation validation | NEEDS_CREDENTIALS | — | |
| 026 | Public whale wallet watchlists | PARTIAL | `whales/prints.ts` (CEX prints) | No on-chain wallets |
| 027 | Wallet funding cluster evidence | MISSING | — | |
| 028 | Copy-tradability latency/slippage simulator | MISSING | — | |
| 029 | Insider/sybil detection | MISSING | — | |
| 030 | Untrusted social/metadata neutralization | PARTIAL | PR-01 strips control/bidi characters from symbols; Joe `safeSymbol` (#45) | URLs and descriptions not ingested yet |
| 031 | SPL mint/freeze authority verification | NEEDS_CREDENTIALS | PR-01 `solana/mint-audit.ts` (fail-closed parser + read-only `getAccountInfo`) | Needs a server-configured RPC URL; not wired (PR-06) |
| 032 | Token-2022 extension allow/deny lists | NEEDS_CREDENTIALS | PR-01 `mint-audit.ts` danger/reviewed sets; unknown extension = UNKNOWN | Test against real Token-2022 accounts |
| 033 | Mint owner + decimals verification | NEEDS_CREDENTIALS | PR-01 `assessParsedMint` | Same |
| 034 | Liquidity custody/vault audit | MISSING | — | |
| 035 | LP lock/burn provenance | MISSING | — | |
| 036 | Sized buy-route verification | MISSING | — | |
| 037 | Sized sell-route verification | MISSING | — | |
| 038 | Depth-adjusted slippage/exit-cost threshold | PARTIAL | CEX book walk in `exec/oms.ts`, `risk/gate.ts` | Not DEX |
| 039 | Creator wallet history review | MISSING | — | |
| 040 | Wash trading / sudden-drain alerts | PARTIAL | PR-01 blockers: ANOMALOUS_VOLUME_TO_LIQUIDITY, NO_OBSERVED_SELLS, EXTREME_PRICE_CHANGE | Heuristics only; no drain monitor |
| 041 | Jupiter route capability contract | MISSING | — | Terms review |
| 042 | Raydium route/fee adapter | NEEDS_LICENSE_REVIEW | — | |
| 043 | Orca quote/impact adapter | NEEDS_LICENSE_REVIEW | — | |
| 044 | Atomic capital reservation | PARTIAL | `submitEntry` locked transaction: cash, cap and full risk re-check (#45) | Paper; one account |
| 045 | Idempotent order/tx intents | PARTIAL | client order ids, duplicate checks (main + #45) | No Solana tx intent |
| 046 | Blockhash expiry checks | MISSING | — | |
| 047 | Preflight simulation + token-account costs | MISSING | — | |
| 048 | Priority-fee/compute-budget limits | MISSING | — | |
| 049 | Unknown tx outcome reconciliation | PARTIAL | `ORDER_UNKNOWN` reserved (`joe/live/events.ts`, #45) | Not produced (paper fills are all-or-nothing) |
| 050 | Exact real fills/balances/fee ledger | LIVE_LOCKED | `core/mode.ts` | |
| 051 | Shared paper/testnet/live risk policy versions | PARTIAL | `risk/policy.ts` (main); `exec/environment.ts` (#45) | Only the paper adapter |
| 052 | Exchange-native stop capability matrix | MISSING | — | |
| 053 | Independent local-stop watchdog | PARTIAL | `monitorPositions`, `exec/incidents.ts` (main) | Same process |
| 054 | Time/trailing/partial TP parity | PARTIAL | `lab/exits.ts`, `monitorPositions` (main) | Paper only |
| 055 | Cross-venue/wallet exposure | PARTIAL | `portfolio/correlation.ts` (main); `portfolio/stress.ts` (#45) | Single account |
| 056 | Daily/weekly loss + correlation breakers | PARTIAL | `risk/gate.ts`, `test/risk-correlation-sizing.test.ts` | |
| 057 | Emergency pause + verified cancellation | EXISTING_MAIN | `pauseNewOrders`, `cancelPendingEntries`, `emergencyStop` in `exec/oms.ts` | Paper scope |
| 058 | Venue/reorg/protection incident playbooks | PARTIAL | `exec/incidents.ts`; THINK runbook (#45) | Protection only |
| 059 | Separate real/paper/testnet ledgers | PARTIAL | `core/accounts.ts` (#45) | Only paper exists |
| 060 | Reservation / buying-power audit | PARTIAL | `submitEntry`, `portfolio/ledger.ts` | |
| 061 | 100-worker evidence coverage audit | EXISTING_MAIN | `workers/effectiveness.ts`; `test/worker-fault-injection.test.ts` (#45) | |
| 062 | 50-indicator source/version checks | PARTIAL | `features/indicators.ts`, `workers/indicators.ts` | Version pinning unverified |
| 063 | Bounded QCI timing + evidence expiry | PARTIAL | `qci/coordinator.ts`, `WorkerContext.asOf` | |
| 064 | Forecast calibration registry | EXISTING_MAIN | `ditas/calibration.ts` | Win probability stays `NO_VALID_FORECAST` |
| 065 | Regime classification | EXISTING_MAIN | `regime/regime.ts` | |
| 066 | Champion/challenger + owner promotion | PARTIAL | `lab/lab.ts`, `test/promotion-gate.test.ts` | |
| 067 | Walk-forward OOS experiments | PARTIAL | `lab/backtest.ts` | No walk-forward |
| 068 | Cost-aware expectancy under failures | PARTIAL | `lab/backtest.ts`; `decision/profitLab.ts` (#45) | |
| 069 | Whale survivorship-bias checks | MISSING | — | |
| 070 | Contradiction + dependency attribution | EXISTS_OPEN_PR | `qci/challenge.ts` (main) + horizon conflict and certificate (#45) | |
| 071 | Owner Cloudflare zone verification | NEEDS_CREDENTIALS | plan only (`sources/`) | Owner supplies the domain |
| 072 | Tunnel + Access hostname | NEEDS_CREDENTIALS | plan only | |
| 073 | Secure cookie + CSRF tests | PARTIAL | HttpOnly/SameSite=Strict, `x-mia-csrf`, `MIA_SECURE_COOKIE` (main); auth e2e (#45) | No proxy/Access test |
| 074 | Origin-bypass/firewall checks | MISSING | — | |
| 075 | Least-privilege service account | EXISTS_OPEN_PR | `deploy/mia.service` (User=mia, hardening) (#18) | |
| 076 | Off-host encrypted backup + verified restore | PARTIAL | `ops/backup.ts` worker verify, DATA-3 (#45) | Off-host copy not automated |
| 077 | WAF, rate limit, bot protection | NEEDS_CREDENTIALS | app-level `core/ratelimit.ts` only | |
| 078 | Deploy approval, immutable builds, rollback | PARTIAL | CI, `qa/gates.ts`, deployment guide | No artifact pipeline |
| 079 | Signer isolation + rotation runbook | PARTIAL | No signer by design; import boundaries (#45) | Runbook missing |
| 080 | License/provenance/secret/SBOM checks | PARTIAL | `scripts/secret-scan.mjs`, CI audit; `SOURCE_LICENSE_REGISTER.md` (PR-01) | No SBOM |
| 081 | Read-only Trader Joe event stream | EXISTS_OPEN_PR | `joe/live/*` (#44) | |
| 082 | Paper/testnet/live UI labels | PARTIAL | Mode labels (main) | No TESTNET label |
| 083 | Animated verified order lifecycle | PARTIAL | Joe Live states (#44) | UI milestone M2 not built |
| 084 | Candidate→order trace timeline | PARTIAL | certificate + replay (#45) | Per decision, not live |
| 085 | Live p50/p95/p99 dashboard | PARTIAL | QHEF page (main) | |
| 086 | New launch/migration watchlist view | PARTIAL | PR-01 Discover → "Solana watchlist" tab | No launch/migration data yet |
| 087 | Candlestick liquidity/execution overlays | PARTIAL | `server/src/chart/*`, Lightweight Charts | |
| 088 | Developer/wallet concentration visuals | MISSING | — | |
| 089 | Portfolio risk/protection panels | PARTIAL | incidents, stress (#45) | |
| 090 | No-trade reasons + provenance | EXISTS_OPEN_PR | `decision/noTrade.ts` (#15), certificate (#45) | |
| 091 | Full original-prompt traceability | EXISTS_OPEN_PR | this file (PR-01) | Section-level for Appendix A (below) |
| 092 | PR/migration dependency matrix | EXISTS_OPEN_PR | `PR_OVERLAP_MATRIX.md` (PR-01) | |
| 093 | 1,000-candidate burst load test | PARTIAL | `scripts/load-baseline.mjs` (#45) | Not the 1,000-launch scenario |
| 094 | WS + Solana reorg fault injection | PARTIAL | `test/depth-stream.test.ts`, worker fault injection (#45) | No Solana |
| 095 | Duplicate/late/unknown order tests | PARTIAL | `test/oms*.test.ts`, crash tests | Paper |
| 096 | Leader fencing / split-brain drill | EXISTS_OPEN_PR | `withWriteFence` in `ops/lease.ts`, `test/lease-fence.test.ts` (#45) | `main` has the lease without the fence |
| 097 | Paper→testnet parity certification | TESTNET_ONLY | — | Needs a testnet venue and keys |
| 098 | Mainnet shadow replay vs venue constraints | PARTIAL | `ditas/replay.ts` (#45), `chart/replay.ts` (main) | Evidence replay only |
| 099 | Independent security/finance final review | PARTIAL | trading-risk review of #45 (done 2026-11-19) | Final release review not done |
| 100 | Owner-approved bounded-live pilot | LIVE_LOCKED | `core/mode.ts` | Requires an explicit owner decision |

## Appendix A — section-level trace (original prompt)

| Appendix A section | Key asks | Status | Evidence / gap |
|---|---|---|---|
| Preamble | One shared engine, subsecond, reliable autonomy | PARTIAL | `exec/environment.ts` (#45); no live adapter (locked) |
| Part 1 §1 Target execution performance | p95 <200 ms (<100 ms stretch), 99.9%, 100% known fills | PARTIAL | QHEF compute-only baseline; conflict C-01 |
| Part 1 §2 New architecture | Fabric, fast/deep paths, one decision core, unified OMS | PARTIAL | `market/fabric.ts`, `fabric/*` (#45), `decision/engine.ts`, `exec/oms.ts` |
| Part 1 §3 Paper-to-live parity | Feature parity table | PARTIAL | Requirements 051/054/057/059; live LIVE_LOCKED (C-02, C-03) |
| Part 1 §4 Regenerated prompt | Container | n/a | |
| Part 1 §5 First priorities | Streaming, subsecond, contracts, testnet, certification | PARTIAL | Streaming in #45; testnet TESTNET_ONLY |
| Part 2 §1 Mandatory repository audit | Audit first | EXISTS_OPEN_PR | This TASK-00 |
| Part 2 §2 Performance requirements | Stage budgets, measured percentiles | PARTIAL | QHEF budgets; NOT_MEASURED end-to-end |
| Part 2 §3 Ultra-fast market-data engine | WS books/trades, sequencing, replay | PARTIAL | `depthStream.ts` (#45); no trade/account streams |
| Part 2 §4 MIA Fast Path | Precomputed deterministic analysis | PARTIAL | `market/scanner.ts`, `features/indicators.ts` |
| Part 2 §5 Deep Intelligence Path | 100 workers, 50 indicators, research | EXISTING_MAIN | `qci/*`, `workers/*`, `lab/*`, `knowledge/*` |
| Part 2 §6 One unified execution engine | Same strategy/risk/OMS across modes | PARTIAL | `exec/environment.ts` (#45): paper only |
| Part 2 §7 Canonical order lifecycle | State machine, unknown recovery | PARTIAL | OMS states; `ORDER_UNKNOWN` reserved |
| Part 2 §8 Real-money capital reservation | Atomic reservation | LIVE_LOCKED | Paper reservation under the lock (#45) |
| Part 2 §9 Unified entry/exit | One code path | PARTIAL | `submitEntry`/`executeExit`, `lab/exits.ts` |
| Part 2 §10 Real-time position monitoring | Continuous monitor | PARTIAL | `monitorPositions`, incidents |
| Part 2 §11 Parity certification | Parity certificate | MISSING | |
| Part 2 §12 Trading intelligence and accuracy | Calibration, regimes, walk-forward | PARTIAL | `ditas/calibration.ts`, `regime/regime.ts`; conflict C-09 |
| Part 2 §13 Durable shared data fabric | Sequencing, outbox, replay | EXISTS_OPEN_PR | `fabric/*` (#43); DITAS outcomes only |
| Part 2 §14 DB and event-loop optimization | SQLite tuning, loop lag | PARTIAL | `db/db.ts`, QHEF |
| Part 2 §15 Exchange adapters and coverage | Multi-venue | PARTIAL | CEX data providers; CCXT research (#45); no order adapters |
| Part 2 §16 Reliable autonomous operations | Supervision, leader election | PARTIAL | `ops/lease.ts`, readiness, `deploy/mia.service` (#45) |
| Part 2 §17 Security and key custody | Signer isolation | PARTIAL | No signer by design; Guardian (#45) |
| Part 2 §18 Trader Joe supervision | Narrator, pause-only | EXISTS_OPEN_PR | `joe/live/*` (#44); conflict C-08 |
| Part 2 §19 Dashboard redesign | Mode-labelled panels | PARTIAL | `web/src/pages/*` |
| Part 2 §20 Testing and acceptance | Burst, fault, parity, replay | PARTIAL | `server/test/*`, `e2e/*` |
| Part 2 §21 Deployment and release gates | Gates, rollback | PARTIAL | CI, `qa/gates.ts`; Cloudflare NEEDS_CREDENTIALS |
| Part 2 §22 Delivery rules | Ownership, small PRs | EXISTING_MAIN | `CLAUDE.md` |
| Part 2 §23 Final engineering principle | Fail closed, honest status | EXISTING_MAIN | `CLAUDE.md` invariants |
| Appendix B (Solana starter) | Read-only starter | EXISTS_OPEN_PR | **PR-01: imported verbatim (hashes match), reviewed, wired read-only** |
| Appendix C (Cloudflare checkpoints) | Tunnel + Access deployment | NEEDS_CREDENTIALS | Plan preserved; nothing configured |
