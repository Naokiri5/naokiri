# MIA 5.x — Bundle Trading: canonical, gap-only integration

**Branch:** feat/mia-bundle-canonical-preview-20261121  
**Integration scope:** P1 canonical preview plus P2 owner-initiated atomic PAPER bundle execution using canonical OMS.  
**Operational truth:** PAPER_ATOMIC execution is implemented for 2–5 existing PAPER decisions with step-up and an append-only v6 grouping migration. No second ledger, real orders, autonomous bundle scheduling, signer, TESTNET placement or LIVE orders were enabled. The existing single-entry OMS retains its behavior.

## Source preservation and identity

- Original user text: [sources/MIA_20261121_BUNDLE_USER_SOURCE_VERBATIM.txt](sources/MIA_20261121_BUNDLE_USER_SOURCE_VERBATIM.txt)
- Complete generated master prompt and original design: [sources/MIA_BUNDLE_20261121_GENERATED_MASTER_VERBATIM.md](sources/MIA_BUNDLE_20261121_GENERATED_MASTER_VERBATIM.md)
- Original generated standalone TypeScript, integrated without replacing existing OMS: [server/src/exec/bundles/assessment.ts](../../server/src/exec/bundles/assessment.ts)
- Runtime read-only evidence adapter: [server/src/exec/bundles/preview.ts](../../server/src/exec/bundles/preview.ts)
- Focused regressions: [server/test/bundle-preview.test.ts](../../server/test/bundle-preview.test.ts) and API authentication tests.

This integration is additive. The source archive is historical reference text and is **not** automatically executed or certified merely because it is in Git.

## Existing canonical owners — reuse, do not duplicate

| Concern | Existing owner | Action |
| --- | --- | --- |
| Market and asset evidence | market/store.ts, quality.ts, safety/safety.ts | Reused via canonical risk gate, never accept browser-submitted evidence |
| Decision identity and consensus | decision/engine.ts, decisions table | Read real immutable decision reports by ID; require PAPER_TRADE |
| Individual risk limits, correlation and sizing | risk/gate.ts, risk/policy.ts | Re-evaluate each candidate; aggregate only applies additional vetoes |
| Portfolio exposure, cash and stops | portfolio/ledger.ts, portfolio/calendar.ts | Read canonical account and reconciliation; no shadow ledger |
| Session, CSRF, throttling and mode | api/routes.ts, core/mode.ts | Reuse global protections; bundle routes are authenticated |
| Canonical paper orders and protection | exec/oms.ts | Extend with one outer transactional wrapper and deferred post-commit events; reuse existing individual entry writes |
| Demo/live parity | exec/demoLiveParity.ts (standalone proposal) | Do not treat it as wired or certified |
| Exchange reconciliation | open #64, #72; order reducer draft #97 | Review and adapt after dependency reconciliation, not wholesale import |
| TESTNET provider | draft #92 | Validations only; do not claim simulated venue orders |
| Solana quote and evidence | draft #95 | Read-only pending reviewed integration; no Jito signer |

**Branching decision:** targeted PR against main, not a merge of #45/#98 (large overlapping and currently conflicting branches). There is no existing bundle implementation in main to amend in place.

## Current endpoint contracts

### GET /api/trading/bundles/capabilities

Owner-authenticated read-only status describing supported preview modes and currently locked order-placement adapters. Never implies real-money certification.

### POST /api/trading/bundles/paper/execute

This owner-only, CSRF-protected, independently step-up-verified route accepts two to five stored PAPER decision IDs and runs `submitPaperAtomicBundle()`; it cannot accept a TESTNET or LIVE destination. Client input `{ "decisionIds": ["dec_01", "dec_02"], "password": "<redacted>" }` uses the existing sensitive-action verification. The route is manual only. A repeat or failed group cannot double debit the account.

### Durable metadata (migration v6)

`bundle_executions` and `bundle_entry_links` are append-only migration additions with unique PAPER group identity and references to canonical orders; there is no competing order or money ledger. Resolve migration numbering when reconciling with stacked PR #45.

### POST /api/trading/bundles/preview

Requires authenticated session and the existing \`x-mia-csrf: 1\` header. Input:

\`\`\`json
{
  "environment": "PAPER",
  "mode": "MULTI_ASSET_BASKET",
  "decisionIds": ["dec_existing_01", "dec_existing_02"]
}
\`\`\`

Two to five **distinct, stored decision IDs**. The browser must not supply quantity, stop price, risk approval, balance or signer settings. The server derives all of them from real MIA records. A stored decision must still be eligible, but preflight can only deny risk — it never creates orders. Responses include reason codes, aggregate cash/risk totals and explicit \`canSubmit: false\`. Paper is the only environment with a preview; TESTNET and LIVE return fail-closed availability. PAPER_ATOMIC remains denied until its *actual* transactional OMS commit exists.

The PAPER ledger uses simulated quote amounts currently treated as paper USD by the existing OMS. The preview only supports the current Binance spot USDT-quoted flow; it does not perform foreign-exchange or real settlement conversion. Monetary comparison uses a conservative 1e6 integer scale, not a claim to exchange-native precision.

## Safety invariants

1. Existing \`submitEntry()\`, \`monitorPositions()\`, \`evaluateRisk()\`, canonical ledger, schema, sign-in and G01–G14 remain unchanged.
2. A failed single-leg canonical risk gate cannot be upgraded to allow by the bundle layer.
3. Aggregated new position count, estimated cash+fee commitments, total planned losses and pairwise correlation can veto a proposed basket.
4. Pending entries with no durable cash reservations block approval; unknown/incomplete marks or failed portfolio reconciliation block approval.
5. Paused, emergency or non-PAPER modes block PAPER bundle approval. Browser input cannot claim a safer environment, policy version, quantity, reservation or signer.
6. No asynchronous network, signer, venue order, real funds, wallet permissions or second risk engine; \`canSubmit\` is always false.
7. Do not call independent exchange orders atomic. Jito constraints and chain-specific inclusion proof require a separately reviewed adapter.
8. The read-only preview cannot reserve cash or guarantee execution. PAPER execution independently checks risk and canonical account state under a single database writer lock; every entry, fill, stop and ledger row either commits or rolls back together.

## Safe next phases (not implemented by this PR)

**P2 — PAPER_ATOMIC (implemented in this draft):** `submitPaperAtomicBundle()` starts one outer SQLite transaction, rechecks bundle risk, links the existing individual entry OMS fills to group records, and defers external events until after commit. A failure in any leg rolls back all financial records. Only authenticated, step-up-verified owners may call the PAPER endpoint; automated bot scheduling is not enabled.

**P3 — TESTNET:** Review #92 and #97/#72 dependency branches, then add durable venue order ACK/partial/UNKNOWN/reconciliation tests with stable client order IDs. The existing \`order/test\` preflight is not placement.

**P4 — Solana Jito:** Require signed ordered transactions, blockhash validity, limits of five, quote freshness, tip/gas/slippage assessment, private signer certification, landing status evidence and post-bundle portfolio reconciliation. An accepted submission is not a confirmed landing.

**P5 — LIVE:** G01–G14, isolated signer, environment-account separation, exchange reconciliation, native stops, owner-bounded approval, recovery and independent security sign-off. Do not auto-promote from PAPER.

## Acceptance requirements

- Existing single-entry PAPER OMS tests, account reconciliation and emergency controls unchanged.
- Test valid distinct decisions, stale consensus/market data, mixed policy versions, insufficient cash, reserved exposure, aggregate risk, correlation, unknown decisions, duplicate instruments, disabled strategy, missing marks, pause/emergency.
- API test no session=401, no CSRF=403, invalid payload=400, LIVE/TESTNET=locked, no order/ledger mutation.
- \`npm ci\`, \`npm run typecheck\`, \`npm test\`, \`npm run build\`, \`npm run test:e2e\`, \`npm run scan:secrets\` and \`npm audit --audit-level=high\`.
- No additional standalone OMS, risk gate or source copy compiled into runtime.
- Do not merge if CI or manual security/trading-risk review reveals regressions.

## Status

| Environment | Preview | Execution |
| --- | --- | --- |
| PAPER | Server-side canonical evidence preview | Owner-initiated PAPER_ATOMIC submit implemented in this draft, pending CI and review |
| TESTNET | Explicit lock state | Not implemented |
| LIVE | Explicit lock state | Locked by existing G01–G14 and signing requirements |

The P1/P2 PAPER integration is in this draft branch. CI evidence and independent review of the exact head are required before merging.
