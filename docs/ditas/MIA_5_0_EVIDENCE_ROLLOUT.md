# MIA 5.0 behavioral evidence rollout

The foundation extends the existing DITAS decision ledger. In the app, open **DITAS → Decision ledger → Inspect decision** to see the observation sources available when that decision was recorded. The same frozen record is available through the authenticated `GET /api/ditas/events/:id/behavior-evidence` endpoint. It returns `404` for an unknown event and `409` for inconsistent or unsupported records.

## Source and baseline

The target baseline is `Naokiri5/naokiri` main at `2627cd276d2108c15a47ba41d60cdb54fddf10ff` (257 tracked paths). The associated Markdown and Word masters remain the source record. The SHA-256 of each attached master is below.

| Attachment | SHA-256 |
| --- | --- |
| `MIA_5_0_ULTIMATE_UNIFIED_SOURCE_PRESERVED_MASTER.md` | `1d415b82f4a234f72db3880e210b176056f3faeb727e87b338398f4e83fc9a5f` |
| `MIA_5_0_ULTIMATE_UNIFIED_SOURCE_PRESERVED_MASTER.docx` | `a3a3d7779976055a0f00b2f5a6a9aa06b376509c36027f63cb4b353bf60dd00e` |

The existing `scripts/inventory.mjs` indexes backend modules, routes, database tables and test files. `git ls-tree -r --full-tree HEAD` records the complete pinned path and blob inventory. This increment reviewed the affected seams. Repository-wide semantic and security certification is open.

## Requirement coverage

| Master design | Status | MIA ownership and verification |
| --- | --- | --- |
| U-00 / BM-00 baseline and overlap review | PARTIAL | Pinned tree and active GitHub PRs reviewed. The [unified branch](https://github.com/Naokiri5/naokiri/pull/45), [NEXUS contracts](https://github.com/Naokiri5/naokiri/pull/41), and [DITAS outbox](https://github.com/Naokiri5/naokiri/pull/43) are separate pending changes. The evidence view adds no parallel event transport. |
| U-01 / BM-01; BE-01–03 | PARTIAL | `ditas/memory.ts` checks the two linked hashes and `bmind/evidence.ts` checks identity, freshness, and provenance for Binance ticker and book inputs. `bmind-evidence.test.ts` covers same-source grouping, invalid/mismatched data, and late/stale observations. Cross-venue, Solana mint, social and news provenance require their own validated adapters. |
| U-10 / BM-07 decision evidence display | PARTIAL | Existing DITAS decision dialog, rate limiter, and owner session. `ditas-api.test.ts` exercises authentication, integrity and replay. `e2e/ditas.spec.ts` exercises the display and how it handles unavailable evidence. Trader Joe and incident alert integrations are pending. |
| U-02–U-06, BE-04–21 and EM-01–32 | PROPOSED | Extend the existing scanner and 11-domain QCI after provenance review. Behavioral hypotheses and strategy effects require qualified sources and evaluation. The endpoint reports source availability only. |
| U-07–U-09 and U-11 | PROPOSED | Extend existing risk, OMS and ledger in separate parity-tested changes. Complete replay, walk-forward, paper shadow and recovery checks before behavioral effects are considered. |
| U-12 | DISABLED | Real-money execution remains locked. |

For rollback, revert the feature commit and rebuild the server and UI together. The projection uses existing records and has no database migration. Unit and browser fixtures exercise behavior and provenance without measuring trading performance.
