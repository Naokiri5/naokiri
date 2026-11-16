# MIA 4.1 — Code Organization & Refactoring Backlog

This is a prioritized maintenance plan based on source inspection of the repair branch. It is not a claim that every similar-looking block is duplicated. Confirm each candidate against current callers and tests before modifying it.

## Existing canonical code to reuse

| Concern | Canonical location | Guidance |
|---|---|---|
| REST request, CSRF header, auth response handling, SSE and data hooks | web/src/api.ts | Do not implement a second fetch wrapper or stream subscription system in a page. |
| Shared Card, Stat, Badge, Tabs, Action, Modal, Page, sorting and Sparkline | web/src/ui.tsx | Extend or compose existing primitives rather than cloning them into pages. |
| Incremental technical indicator calculations | server/src/features/indicators.ts | This is the feature-calculation engine. Do not copy RSI/EMA/ATR calculations into workers or strategy code. |
| Indicator interpretation and specialist IDs | server/src/workers/indicators.ts | This adapter maps calculated snapshots to readings. It is intentionally different from the calculation engine; do not merge the responsibilities. |
| Deterministic test candles and DB setup | server/test/helpers.ts | Reuse fixtures and seed utilities; keep tests offline and reproducible. |
| SQLite helpers and transactions | server/src/db/db.ts | Keep parameterized access and transactions centralized. Avoid parallel persistence abstractions. |

## Priority 0 — protect behavior before cleanup

- Keep data-quality and paper OMS safeguards covered by tests.
- Add route validation and standardized error-status tests.
- Establish API contract tests before extracting route handlers.
- Keep CI typecheck, build, unit tests, secret scan, dependency audit and Playwright as release gates.

## Priority 1 — split the API composition module

Candidate: server/src/api/routes.ts (approximately 25 KB and 67 route registrations in the inspected version).

It currently coordinates auth, market, scanner/intelligence, risk, bot/portfolio/orders, journal/calendar, strategy lab, news/whales, wallet, connections, QA, security and Trader Joe routes.

Recommended structure (adapt to the real dependency graph):

    server/src/api/
      index.ts                 # route registration composition only
      shared.ts                # shared HTTP/schema/error helpers only when proven common
      routes/
        auth.routes.ts
        market.routes.ts
        intelligence.routes.ts
        risk.routes.ts
        portfolio.routes.ts
        journal.routes.ts
        lab.routes.ts
        news.routes.ts
        wallet.routes.ts
        security.routes.ts
        joe.routes.ts

Extract in small groups, preserving every method/path, pre-handler, auth/CSRF behavior, response shape, ordering where meaningful and error mapping. Avoid a giant dependency bag passed to every handler. Keep business logic in domain services, not route files. Add API tests for each extraction before deleting old registrations. Avoid splitting routes into individual files when that creates more indirection than value.

## Priority 2 — split large frontend pages into feature-owned components

Candidates: web/src/pages/Trading.tsx (~30 KB) and web/src/pages/Intel.tsx (~19 KB) in the inspected version. Their line counts understate visual complexity because several sections use dense JSX.

Suggested organization:

    web/src/features/
      trading/
        components/
        hooks/
        types.ts
      intelligence/
        components/
        hooks/
        types.ts
    web/src/pages/
      Trading.tsx       # page composition and route-level state
      Intel.tsx         # page composition and route-level state

Keep feature-local pieces local until a second genuine consumer appears. Extract repeated tables, filters and dialogs only if behavior and data contract match. Do not move domain decisions into React.

## Priority 3 — organize worker definitions by evidence domain

Candidate: server/src/workers/registry.ts (~23 KB in the inspected version), which defines a large deterministic worker catalog in a dense module.

Recommended future shape:

    server/src/workers/
      domains/
        market-structure.ts
        momentum.ts
        volume-flow.ts
        volatility.ts
        derivatives.ts
        cross-asset.ts
        sentiment.ts
        liquidity.ts
        risk-context.ts
      registry.ts       # stable aggregation and registration only
      runtime.ts
      types.ts

Do not divide mechanically by line count. Preserve all worker IDs, domain membership, dependencies, weights, deterministic outputs, timeout behavior and test expectations. Move one evidence domain at a time and add catalog-integrity tests.

## Priority 4 — typed API contracts

The frontend API wrapper is centralized, but several pages use any or repeat inline response shapes. Introduce typed response contracts by feature gradually, beginning with frequently reused and safety-relevant endpoints. Keep server runtime validation; TypeScript types alone do not validate untrusted payloads.

## Refactoring rules

- Prove duplication; do not refactor for visual similarity alone.
- Prefer one canonical implementation per actual behavior.
- Prefer feature/domain ownership over generic utils, helpers or common folders.
- Keep frontend feature components separate from backend domain logic.
- Do not change business rules while moving code.
- Avoid broad architecture rewrites. One cohesive extraction per PR.
- Capture before/after tests and compare externally visible contracts.
- Each PR must list duplicate candidates investigated, existing code reused, tests and any intentional remaining duplication.

## Suggested implementation order

1. Route registration extraction with API parity tests.
2. Trading page component extraction.
3. Intelligence page component extraction.
4. Worker catalog organization by domain.
5. Typed frontend response contracts.
6. Reassess whether more abstractions are justified.
