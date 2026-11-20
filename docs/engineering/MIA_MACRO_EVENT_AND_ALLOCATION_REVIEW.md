# MIA — Macro Event Protection & Fractional Kelly Research: Anti-Duplication Review

**User sources:** \`continue for the function and code it.odt\` (9 pages, original code for MacroCalendarVetoSkill, CapitalAllocatorSkill and UnifiedRiskGovernor) and \`MIA_5_1_UNIFIED_FULL_FIDELITY_MASTER(1).md\`. Original attachments and existing repository scripts are unchanged.

**Stack:** This PR is based on PR #66 (MIA research branch) and should be reviewed alongside recovery PR #62 and read-only OMS PR #64. No branch is merged by this change.

## Explicit answer: which features are already present?

| Proposed attached component | Current canonical MIA owner | Evidence and action |
| --- | --- | --- |
| \`MacroCalendarVetoSkill\` | \`news/news.ts\` macro headline classifier, \`risk/gate.ts\` fail-closed authority | Headline classification exists, but **no trustworthy scheduled-release calendar** on inspected PR #66 tree. Add an optional, owner-enforced event-window check to the existing gate; no second risk engine. |
| \`CapitalAllocatorSkill\` | \`risk/gate.ts\`, \`risk/policy.ts\`, \`portfolio/correlation.ts\` | Risk-per-trade sizing, conservative buffered stop, fees, cash/notional limits, policy and correlated-position veto already exist. Keep these authoritative. Add a **shadow research-only** fractional Kelly calculation, not a second allocator. |
| \`ReplayEvolutionSkill\`/\`StrategyGenome\` | \`ditas/calibration.ts\`, \`workers/effectiveness.ts\`, staged B-MIND branch | No corresponding named class on inspected tree. A genome confidenceScore is **not** a validated win probability. Do not introduce another autonomous sizing authority or fake calibrated cohort. |
| \`UnifiedRiskGovernor\` | \`risk/gate.ts\` and \`exec/oms.ts\` (rechecks under SQL write lock) | Already have single authoritative risk governor. Do not import or instantiate an alternative governor. |
| \`portfolio/calendar.ts\` | Closed-position realized-PnL calendar | NOT an upcoming CPI/FOMC/token-unlock calendar. Do not repurpose it or infer scheduled macro release dates from historical PnL. |

## Critical corrections to original attached examples

1. A stale macro cache in the attachment **does not veto** after fetch failure, which could allow exposures with missing schedule data. If ENFORCE is enabled, stale, missing, corrupt or uncovered snapshots must deny **new** entries. Default is NOT_CONFIGURED, *not* a certificate of macro safety.
2. The attachment's \`shouldFlattenBeforeEvent()\` has an independent automatic-exit suggestion. No such forced flatten is added; exits require existing OMS protection and evidence and must not be invented.
3. Original sizing uses a 2% per-trade fallback while MIA's accepted default is 0.5%; adding it as the second allocator would bypass owner policy.
4. \`Math.max(0.001, adjustedRiskFraction)\` fabricates a minimum bet even when evidence is poor, and \`confidenceMultiplier=0.25+confidenceScore\` can exceed 1. Do not do this.
5. \`confidenceScore\` from regime replay is not a calibrated trade-win probability. Missing/uncalibrated probability means NO_ESTIMATE.
6. Original \`Math.abs(entry-stop)\` accepts short stops. Current MIA PAPER engine is long-only and has specific stop-direction checks.
7. Original risk-per-unit ignores fees and conservative stop-fill buffers. Existing gate already calculates them; research calculations must take that gate result as input.
8. Original \`toFixed(6)\` and post-hoc rounding can violate venue steps or misstate risk. Use canonical \`floorToStep\` and never authorize from display rounding.
9. Original asset-level correlated exposure requires a monetary capacity model MIA does not yet have. A **research estimate** may accept an externally derived capacity, but must not replace the existing correlated-position veto.
10. A macro feed cannot be conjured from existing headline dates. Scheduled timestamps require a separately authorized, provenance-audited source; no third-party provider or credential has been connected in this PR.

## Current implementation: one shared risk authority

### \`server/src/risk/macroCalendar.ts\` — optional event-window gating

- Strict schema for event IDs, impact, currencies, schedules, timestamps, expiry and limited coverage.
- Owner-only publication API for future authenticated admin/feed workflow. No HTTP route or network provider is added.
- Default NOT_CONFIGURED (no silent promise of protection).
- ENFORCE mode rejects stale/invalid snapshots and insufficient currency coverage.
- Relevant high-impact releases block the configured 20-minute-before/15-minute-after interval.
- Pure assessment, no order placement, forced flattening, withdrawals or mode changes.

\`server/src/risk/gate.ts\` **reuses** \`assessStoredMacroEntry()\` and appends a denial reason when configured enforcement requires it. The existing paper OMS already reruns \`evaluateRisk()\` under its write lock, so the optional macro veto runs through that one authority. Nothing removes policy sizing, correlation, stale book, approval, and ledger protections.

**Feed caveat:** This PR does not automatically ingest official CPI/FOMC or token-unlock schedules and cannot assert a complete calendar. It must not be labeled *fully automatic macro protection* until source verification, ingestion refresh, signed/provenance-bounded state publication, error telemetry and operational tests are separately delivered. Snapshot expiry is deliberately limited to 30 minutes to prevent silent fail-open when a feed stops.

### \`server/src/risk/allocationResearch.ts\` — read-only fractional Kelly comparison

- Uses a lower out-of-sample win-probability bound plus net payoff ratio and at least 100 settled cohort observations with provenance.
- Reuses *conservative* per-unit loss and risk/notional budget inputs from the canonical policy gate.
- Never uses genome confidence as a probability, invents a minimum risk floor, or increases any policy cap.
- Rejects zero/negative edge, invalid/nonfinite inputs and cap exhaustion as NO_ESTIMATE/NO_POSITIVE_EDGE.
- Explicit result \`authority:'RESEARCH_ONLY'\`, \`mustPassExistingRiskGate:true\`; no orders, API routes or automatic strategy promotion.
- A caller-supplied cohort label does NOT independently verify calibration or independence; future ingestion must verify it before treating estimates as decision-grade information.

## Next engineering stages (NOT implemented here)

1. **Calendar ingestion:** Build a tested, provenance-confirmed economic/token-unlock calendar source with explicit currency coverage, fetch health, retries and owner-enabled enforcement; allow no source-provided change to authorization mode.
2. **Calendar auditability:** Expose source, freshness, next HIGH event and NOT_CONFIGURED/ENFORCING state in a read-only dashboard/Trader Joe and no-trade board; failure to refresh should notify and fail closed when enforcing.
3. **Risk research validation:** Derive out-of-sample lower bounds using settled, independent trading outcomes with confidence-interval design and realistic costs; track selection bias and regimen drift.
4. **Correlated capacity:** Model actual reserved notional by underlying factor, but keep original risk/correlation checks and ledger authoritative.
5. **Replay learning:** Reuse DITAS/worker evidence. Do not add an unverified ReplayEvolutionSkill or a second risk governor.
6. **Test macro-window time boundaries and OMS concurrent-entry race** against the final integration SHA.

## Verification required

Run \`npm run typecheck\`, focused \`npx vitest run test/macroCalendar.test.ts test/allocationResearch.test.ts\` from \`server/\`, \`npm test\`, \`npm run build\`, \`npm run test:e2e\`, \`npm run scan:secrets\`, \`npm audit --audit-level=high\`. Mark any not executed as NOT VERIFIED. New risk-evidence functionality must not weaken existing PAPER limits, and \`LIVE_EXECUTION_AVAILABLE=false\` must remain unchanged.

**Merge status:** DRAFT for owner review; no release/auto-merge/live authorization.
