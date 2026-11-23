# MIA 6.0 four-section cockpit — first integrated increment

**Status:** DRAFT; user-facing navigation consolidation, not a MIA 6.0 release or LIVE certification.
**Existing owning PR:** #132 (Central Command Phase 4), based on #130 → #129 → #128.

## What changed and why

The authenticated shell now shows exactly **Autopilot, Trader Joe, Smart Portfolio, Settings**. Their canonical URLs reuse the existing, operational views rather than creating four mock views. The old pages and API paths are retained, and the command palette still indexes all legacy screens.

| New operator section | Existing functionality reused | Legacy deep links preserved |
| --- | --- | --- |
| Autopilot `/autopilot` | `pages/Trading.tsx` Bot, Central Command | `/bot`, `/terminal`, `/scanner`, `/discover`, `/intelligence`, `/news`, market tools |
| Trader Joe `/trader-joe` | `pages/Joe.tsx`, server `joe/joe.ts` | `/joe`, `/ditas`, `/academy`, `/decision/:id` |
| Smart Portfolio `/smart-portfolio` | `pages/Trading.tsx` Portfolio, canonical paper OMS/ledger | `/portfolio`, `/history`, `/journal`, `/calendar`, `/wallet` |
| Settings `/settings` | Existing Settings, Risk and QA screens | `/risk`, `/lab`, `/qhef`, `/connections`, `/security`, `/notifications`, `/qa` |

Shared `web/src/tokens.css` extracts the landing's Obsidian Palazzo colors and typography to make the authenticated app visually consistent. Risk status colors remain semantically distinct from decorative gold, blue and burgundy.

## Scope and safety

- No changes to OMS, risk governor, account balances, position ledger, ownership leases, market feeds or active protective exit loops.
- No alternate SSE stack, second Trader Joe agent, duplicate DITAS/Choice/portfolio memory store, or extra session flag.
- Existing **PAPER / approval / observe** modes and owner authentication remain the real operational controls.
- **LIVE remains locked**; changing its UI label or surfacing a switch is not a trading authorization.
- This navigation increment does **not** implement the uploaded durable session FSM, `/api/session/run`, `/api/session/close`, autonomous mode-specific execution, DITAS provenance firewall, or production-grade E2E session tests. Those require a separate cross-PR integration and explicit safety review. No fake session control is displayed.

## Verification requirements

1. `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e`.
2. Verify `web/src/nav.test.ts` for all legacy route ownership and four primary destinations.
3. Verify `e2e/navigation.spec.ts` for authenticated route access, unchanged mode, mobile layout, and legacy palette search.
4. Review exact-head CI, required deployment checks, financial invariants, architecture and accessibility before any merge.
5. Do not merge while #128 → #129 → #130 dependencies are draft or necessary release checks are failing.

**Rollback:** Revert these frontend navigation/style/test/doc commits; no DB migration or trading state change is involved.
