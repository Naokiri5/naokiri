# MIA_OMEGA_PHASE_1_PLAN (2026-11-19)

**Team roles (spec §11):**
- **Claude:** architecture, traceability, review, and the PR-01 build (owner's choice on 2026-11-19).
- **Codex:** reviews PR-01, then implements later PRs in non-overlapping files.
- **Owner:** the only one who merges, deploys, supplies credentials, or unlocks live trading.

## Sequence (adapted to what already exists in #45)

| PR | Scope | Owner | Status | Blocked on |
|---|---|---|---|---|
| 00 | Audit: this folder | Claude | **Done** (this PR) | — |
| 01 | Read-only Solana Hunter: starter verbatim + review fixes + `discover().solanaHunter` + Discover tab | Claude build, Codex review | **Draft PR** (stacked on #45) | Codex review |
| 02 | Streaming consolidation | — | Already in #45 (#18 `depthStream.ts`) | #45 merge |
| 03 | Hot-path scheduler + sustained ≥10k-event p50/p95/p99 trace | Codex | Not started | Representative load harness |
| 04 | Durable order/fill events in the NEXUS outbox (beyond DITAS outcomes) | Claude design, Codex | Not started | Trading-risk review; migration v11+ |
| 05 | GMGN typed read-only client via `providers/http.ts` (rate limit, backoff, redirect guard), normalizers | Codex | Client inert in PR-01 | **Owner `GMGN_API_KEY` + ToS review** |
| 06 | Solana RPC mint audit wired: `mint-audit.ts` + slot provenance | Codex | Parser in PR-01 | **Owner RPC URL (HTTPS, allowlisted)** |
| 07 | Pump.fun / PumpSwap launch and migration stream | Codex | Not started | Verified program IDs/IDL, licensed stream |
| 08 | Raydium / Orca / Jupiter quotes and sell-viability | Codex | Not started | **License decision (GPL-3.0 / Orca)** |
| 09–12 | Research/replay, unified OMS adapter, testnet parity, Trader Joe UI | Mixed | Not started | Testnet venue keys for 11 |
| 13 | Cloudflare stage deploy (Tunnel + Access → `127.0.0.1:8787`) | SRE + Codex | Plan only | **Owner domain, host, Cloudflare access** |
| 14–15 | Security soak; owner-reviewed live readiness | Independent | Not started | Owner decision; LIVE stays locked |

## File ownership for the next PRs
- **New Solana code:** under `server/src/solana/` (Codex for PR-05/06/07).
- **Discovery output:** `server/src/market/discover.ts`. Only additive changes to the `solanaHunter` block.
- **Serialized under one integration owner:** `exec/oms.ts`, `risk/gate.ts`, `market/scanner.ts`, `db/migrations.ts`, `api/routes.ts`, `portfolio/ledger.ts`.
- **Boundary:** `server/src/solana/` is an evidence root in `test/import-boundaries.test.ts`. It may never import `exec/`, `wallet/` or `portfolio/`.

## Owner decisions needed (nothing is assumed)
1. **GMGN:** provide a `GMGN_API_KEY` through the server environment only (never in chat), and confirm GMGN's terms allow this use. Needed for PR-05.
2. **Solana RPC:** which provider (Helius, QuickNode, other) and its HTTPS URL, through the server environment only. Needed for PR-06.
3. **Licenses:** whether a GPL-3.0 dependency (Raydium SDK) is acceptable, and whether to obtain the Orca license review. Needed for PR-08.
4. **Cloudflare:** the exact hostname (for example `app.<your-domain>`), the Linux host, and when to deploy. Needed for PR-13. MIA stays in OBSERVE or PAPER on first deploy.
5. **Merge order:** #45 first, then this PR.
