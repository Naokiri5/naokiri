# MIA hot-path optimization — reconciliation on BrainOS integration

This is an incremental integration of the supplied MIA-HP1–HP5 documents, not a complete implementation of those phases. Existing source roots are server/src and web/src (not packages/server). Prior owners: PR #127 QHEF cockpit, #126 Choice, #128–#131 canonical execution and protective lanes, #135–#137 BrainOS integration.

| Source scope | Canonical owner | Integration / outstanding work |
| --- | --- | --- |
| HP1 latency | core/latency.ts, qhef/qhef.ts | O(1) ring writes, reject invalid measurements, preserve report fields and percentile convention. No latency target certified. |
| HP1 depth / transport | market/quality.ts, market/fabric.ts, providers/binance.ts | Shared structural validator applied to exact quantity book walk; invalid clocks rejected. REST only; canonical provider-wide HTTP 429/Binance 418 Retry-After cooldown added with monotonic timing. WS sequence synchronization, rotation, snapshot buffering and weight accounting still require integration. |
| HP1 cockpit | PR #127 | Reconcile existing cookie-auth/CSRF design, not browser bearer-token storage. No duplicate panel or routes. |
| HP2 scheduling | bot/bot.ts, market/scanner.ts, workers/runtime.ts | Existing independent protection, cooperative scan yields and worker bounds; adaptive pressure / global bounded queue not complete. |
| HP3 evidence / costs | market/quality.ts, scanner, features, decision, risk | Reuse book walk and impact. The two supplied HP3 documents contain wiring summaries rather than complete code. No new cache or evaluator asserted. |
| HP4 allocation / receipts | choice/arbitration.ts, risk/gate.ts, exec/oms.ts, portfolio/ledger.ts | Shadow ranking only; keep atomic risk+ledger writes. Do not use process-memory reservations or release unknown orders by timeout; require durable reconciliation before releasing capital. |
| HP5 domains | market/flinQueue.ts, choice/dualResearch.ts, knowledge/cognitive, lab, DITAS | Explicit boolean token-safety proof validation implemented; provider certification, RPC launch stream, actual sell simulation, venue-specific margin and calibrated strategy ranking remain open. |

FAST is memecoin research; DEEP is futures research. Existing spot paper remains a separate certified-for-testing lane, not routed through either mind. No router or caller-supplied boolean grants execution authority. Both mind paths and LIVE remain locked.

Validation: new tests exercise production latency, book walk and FLIN functions; all belong to existing Vitest CI. Do not infer benchmark improvement, profitable trading, or readiness from source changes. Exact-head CI and independent architecture review required. The extra structural validation adds work at execution time and must be measured with representative depth before any latency claim.

## BrainOS 9.0 — P0/P1/P2 source reconciliation (2026-11-25)

Incremental implementation on #137, not a new execution architecture. Source: nine owner PDFs covering P0 contracts, dependency matrix and compiler audit, FAST re-entry/anti-churn, REFLEX exits, CanonicalOMS, and FAST/OMS/Strategy Arena tests. The supplied "file trees and diffs" PDF contains export instructions rather than actual diffs; use GitHub branch evidence instead.

| Requirement | Canonical owner | Status / decision |
| --- | --- | --- |
| P0 architecture isolation | test/brainos7-authority.audit.test.ts | Extend existing Rolldown AST guard with signer, live-unlock and worker primitives, including reachable helpers. Do not introduce a second checker or assume TS7 exposes the legacy Compiler API. Full 12-layer matrix, alias resolution, symbol/data-flow analysis and unrelated production roots remain unverified. |
| FAST fresh evidence | market/flinQueue.ts | Equal or older source timestamps cannot overwrite persisted evidence; strictly newer evidence can update. Regression tests use canonical DB. Still research-only. |
| FAST anti-churn and reserve floors | risk/gate.ts, risk/policy.ts, portfolio/ledger.ts, exec/oms.ts | Existing risk and position gates remain authoritative. Proposed process-memory cooldown records, caller-supplied risk receipts, fixed 50%/5% reserve floors and continuous DEX re-entry are not imported. Design durable scope/cycle identity, atomic reserves, verified fills and owner policy migration first. |
| REFLEX exits | bot/bot.ts, exec/oms.ts, lab/exits.ts | Existing independent paper protection lane and shared stop/target/trailing/time rules retained. Additional DEX-specific triggers need verified telemetry, position identity, bounded dispatch, durable exit intent and reconciliation. No second interrupt writer. |
| Canonical OMS / parity | exec/oms.ts, exec/recovery.ts, portfolio/ledger.ts | Reject Map-backed replacement and hash/boolean-only authorization. Preserve SQLite transactions and existing fence. Bundle lifecycle, executable AMM quote/fee/tip parity, uncertain venue settlement and certified live adapter remain open. |
| Strategy Arena | lab/lab.ts | Atomically persist status, suspension index and audit; failure rolls back all. Regression preserves existing external certification denial. DSR and nine-stage migration remain open; require comparable Sharpe units, actual trial distribution, out-of-sample data and externally verified certificate. No autonomous promotion to LIVE. |

Merge gate: exact-head CI, security/architecture review and deployment checks. Do not label this full BrainOS 9.0 or enable real-money execution. FAST/DEEP remain research-only, PAPER retains existing session and policy controls, and LIVE remains locked.

## BrainOS 9.0 P2 Smart Portfolio and cognitive coordinator (2026-11-25)

Source: the four uploaded P2 allocator/coordinator specifications and corresponding Vitest suites. Canonical owners are risk/policy.ts, risk/gate.ts, portfolio/ledger.ts, exec/oms.ts, choice/arbitration.ts and bot/bot.ts. PR #67 contains related shadow-only allocation research on a different stack; do not import its separate research calculation as trading authority.

- Implement optional, owner-accepted minUnallocatedReservePct and minSettlementReservePct in the existing versioned policy. Values are percentages (50 and 5, not 0.50 and 0.05), individually 0–100, combined at most 100. Existing policies without these fields retain their prior behavior; example configuration is not automatically applied.
- The current PAPER ledger has one cash balance, not independent settlement wallets. The two policy reserves are disjoint **logical portions** of the same cash balance. The floor is calculated using current pre-entry equity. Fee-inclusive headroom is max(0, (cash - equity * combinedPct/100)/(1 + feeRate)). The existing per-position notional and loss limits still apply. Size against the worst permitted entry price; the existing OMS rechecks the resulting actual notional cap under the fill transaction. No new balance, reservation store or execution authority.
- Tests extend the existing risk and OMS suites: invalid and unauthorized policy edits, legacy behavior, capped entry, fee-inclusive cash floor, subsequent fresh evaluation, late policy tightening, and continuing protective exits.
- No UI policy controls added in this increment; the fields are supported by the server policy contract. Separate ring-fenced settlement accounting and verified venue-specific fees are not claimed.
- Reject literal coordinator wiring: await of exit dispatch must not couple independent protection to reasoning; an interrupt is not a settled close. Do not remove held positions or release capital until confirmed fills reconcile. Simulated intra-cycle budgets cannot reserve real money across concurrent cycles. The current scan/protection/research lanes remain separate.
- Reject fabricated performance fallback (0.75 confidence or predicted edge used as verified expectancy), upward leverage floor during deterioration, rounding capital up beyond headroom, and missing lock evidence treated as unlocked. The supplied test uses a static hash as live certification and accesses assetId at the wrong nesting level; its expected FAST allocation also assumes a requested amount not established by the coordinator.
- Remaining P2 work: verified performance-driven taper, per-asset/engine caps on actual classified exposures, fresh QHEF/strategy evidence, multi-proposal shadow budget simulation, durable venue settlement/reservations, Strategy Arena and FAST/DEEP lane certification. Do not promote to LIVE or replace the canonical OMS. No profitability or latency claim.

Release gate: exact-head CI and independent review required; existing live locks remain. This is an incremental PAPER risk improvement, not complete P2 implementation.

## BrainOS P0–P2 hardening increment (2026-11-25)

The 19-document proposal is a roadmap, not evidence that its proposed parallel modules exist or are production-ready. Baseline #137 dc86ac7 passed CI run 45532484407. Continue its canonical PAPER architecture rather than import a second ledger, runtime authority, scheduler or certification path.

Implemented:
- P0: acceptPolicy now commits the owner-approved policy version and its audit row under the canonical BEGIN IMMEDIATE transaction. A late audit failure rolls back the policy update.
- P1: optional owner policy fields postExitCooldownMs, stopLossCooldownMs, entryFrequencyWindowMs, maxEntriesPerWindow and adaptiveDrawdownSizing. Existing accepted policies without these fields retain behavior. Frequency window and cap must be supplied together.
- Risk gate reads actual persisted PAPER positions for the most recent same-instrument closed exit and account-wide rolling entry count. Stop or trailing-stop closure applies the longer configured cooldown. No second counter or migration. Frequency counts filled position entries, not proposals, approvals, or network dispatch attempts. Existing OMS rechecks risk before committing under its write lock.
- Optional account-wide taper uses existing persisted deposit-invariant account high-water marks and closed loss streak: >=2.5% drawdown or >=3 losses => 0.65x; >=5% or >=5 losses => 0.35x; >=8% or >=7 losses => zero. Apply to per-trade risk budget and existing notional cap; other risk gates remain unchanged. No automatic policy mutation or leverage increase. Existing tighter breakers take precedence.
- Extend server/test/risk.test.ts and server/test/oms.test.ts with risk validation, taper, atomic policy rollback and actual paper entry/stop/SQLite reopen regression. Tests are not prospective market evidence.

Reconciliation and exclusions:
| Package | Canonical owner / gap |
| --- | --- |
| P0 CI and static boundary | .github/workflows/ci.yml and test/brainos7-authority.audit.test.ts already run; reuse existing npm and Node version. No duplicate workflow or passWithNoTests. Three consecutive exact-head runs and independent release review remain open. |
| P0 financial reservation and reconciliation | db/db.ts, portfolio/ledger.ts, portfolio/calendar.ts, exec/oms.ts, exec/recovery.ts, ops/lease.ts. PAPER fills, ledger writes and protective stop are atomic. External asynchronous reservations, integer money migration, partial/ambiguous venue execution and independent wallet reconciliation remain open. Do not create the proposed second balance ledger or a second fencing authority. (Since schema 12 the engine lease itself carries a never-reused epoch in ops/lease.ts; it strengthens the one lease fence and is not a parallel authority. `brainos_sessions.fence_epoch` is the session checkpoint's own version counter.) NOT_FOUND alone must not release an uncertain venue order. |
| P1 anti-churn and sizing | Implemented account/symbol subset above. Engine-level counters, directional flip-flop protection (no short execution in canonical PAPER), engine-specific drawdown and performance under genuine execution remain open. |
| P1 exposure and unified shadow cycle | Keep canonical positions, risk, choice arbitration and OMS. Require authoritative engine attribution, durable unresolved order exposure, same-snapshot research sizing and concurrency tests before parity claims. No synthetic live dispatch. |
| P2 verified strategy profiles and DITAS | Existing lab/lab.ts and ditas/calibration.ts own lifecycle and calibration. No generated outcomes or assumed probabilities may certify an edge. Require immutable real outcome provenance, independent holdout, correct multiple-testing statistics and health evidence. Health-gated adaptation remains open. |
| P2 bridge | Existing cognitive modules live under knowledge/cognitive; retain read-only boundaries. Injected financial callbacks can violate isolation even with no imports. Do not provide cognitive memory an independent order-authority port. |
| P2 session harness, CLI, HMAC, readiness and promotion | Existing qa/gates.ts and core/mode.ts remain authoritative; no signer, live adapter, live startup unlock, or production deployment change. The proposed CLI has a fallback development signing secret and seeds synthetic winning trades. A signed synthetic artifact does not prove prospective performance, venue reconciliation, or security. No eval-based deploy/rollback commands. Tests of simulated readiness are not production certification. |

Gate: #137 remains draft until exact-head CI and integration review. All live controls stay locked; no live unlock, certification artifact, or deployment was performed.

## Eight-priority OMS and release hardening increment (2026-11-25)

Source: seven owner-provided PDFs, priorities 1–8. Baseline f75d66c passed CI run 45535860115. Reuse #137, not the proposed replacement packages/server hierarchy.

| Priority | Canonical implementation / remaining gap |
| --- | --- |
| 1 Exact merge evidence | Existing .github/workflows/ci.yml checks out and asserts github.sha in both jobs (PR event merge commit, push event head). It still runs the existing typecheck, build, tests, audit and browser checks. No duplicate workflow. Branch protection, fresh exact-merge checks and independent approval remain separate. |
| 2 Durable external-order reservations | PAPER settles within one SQLite transaction and does not dispatch to an external venue. No second balance or OMS created. External reservations require real venue identity, owner-authorized funds, persisted lease fence and transactionally coupled order/ledger updates; not implemented. |
| 3 Ambiguous and partial fill reconciliation | Existing portfolio/calendar.ts reconciliation now checks each closed position individually and detects unlinked BUY/SELL principal entries. Equal and opposite errors cannot cancel in the account aggregate. exec/recovery.ts denies new entries on unknown and unresolved persisted PAPER order states; exits remain independent. Regression tests in server/test/oms.test.ts. This detects faults; does not automatically backfill venue fills or release external locks. Open PRs #64/#72 contain a related read-only venue assessor absent from this branch: reconcile ownership before importing it. |
| 4 Engine exposure | Existing long-only spot positions remain authoritative. No independent sleeve balances or position store. Actual per-engine classification, reserved/ambiguous exposure, venue leverage and isolated breakers remain unfinished. |
| 5 Strategy sizing | Preserve versioned Strategy Lab and reduction-only risk sizing. Proposed multipliers up to 2x cannot override existing authorized limits; caller-supplied performance snapshots are not verified evidence. |
| 6 DITAS learning | Preserve canonical immutable decision/outcome memory and existing calibration. Health-gated adaptive updates remain unfinished. |
| 7 Unattended certification | 72h actual PAPER/TESTNET soak remains pending. A SHA-256 digest of a caller-supplied JSON manifest is not trusted attestation; hydrating a fresh in-memory DB from the manifest cannot verify actual persisted production integrity. Dry-run with a zero-hour minimum must never issue a live-authorizing certificate. |
| 8 Railway/Privy boundary | Preserve existing hard LIVE lock and release gates. A writable directory and configured Privy identifiers alone do not establish volume persistence, least-privilege policy enforcement, or wallet authorization. No production promotion script or deployment changes. |

The proposed external-order state machine has no explicit fence in its ReserveOrderInput contract; callbacks for ledger and protective-stop writes must not introduce nontransactional side effects. Require definitive venue status and authenticated cumulative executions, not timeout or missing order evidence, before releasing reserved funds. The reconciliation additions are PAPER-only, not full external order recovery or multi-sleeve parity. Do not merge until exact new head/merge CI is verified; LIVE remains locked.

## Runtime lifecycle and deployment safety reconciliation (2026-11-25)

Source: fifteen owner PDFs covering shutdown, startup recovery, boot/OMS tests, adapter factory, readiness, burn-in manifest, verification scripts, environment template, runbook and PR checklist. Baseline 9d15b1b passed CI run 45541731006.

Implemented in canonical runtime:
- ops/shutdown.ts: one-way process-local drain latch. Not a second session authority; existing durable session and lease still control entries.
- exec/oms.ts: deny new entries before evaluation and inside the existing write transaction; do not enqueue new approvals while draining. Do not disable existing position exits. This is PAPER behavior; no external reservations are claimed.
- main.ts: shared startup promise, register SIGINT/SIGTERM before waiting for app construction/listen, avoid scheduler start after latch closes, reuse drainBot. Repeated signals do not start another drain. An undrained engine exits nonzero without explicitly closing the active SQLite handle; lease expiration and existing recovery govern the next process. After successful engine and HTTP drain, wait for the resumable knowledge-ingestion queue, request PASSIVE WAL checkpoint, and close the canonical DB. A busy/partial checkpoint retains committed frames; no forced truncation while another process may hold readers.
- bot/bot.ts: refuse scheduler restart during shutdown. ops/readiness.ts: existing /api/ready returns 503 while draining; /api/health retains its liveness behavior.
- server/test/oms.test.ts: regression of pre-transaction shutdown race, no new orders/approvals and continuing protective exits. server/test/runtime-shutdown.test.ts: actual latch and HTTP readiness transition (Fastify injection). Actual OS signal timing, active SSE/ingestion drain, Railway rolling replacement and power-loss/restart tests remain pending; existing WAL recovery coverage is separate.

Reconciliation decisions:
| Proposal | Decision |
| --- | --- |
| Express composition root, better-sqlite3, second OMS and worker stack | Reject replacement; current Fastify buildApp, main.ts, node:sqlite migrations, exec/oms.ts, bot scheduler and lease remain canonical. |
| Startup external-order reconciler | Retain existing takeover integrity and durable session recovery. Missing venue lookup after retries is not proof of non-delivery. Never automatically reject or free ambiguous external reservations without definitive authenticated evidence and fenced ownership. External polling/settlement remains unimplemented. |
| Shutdown after adapter timeout | Do not explicitly close SQLite beneath active operations or claim success. Retain durable unresolved state and fail nonzero. No real adapter calls exist in this branch. |
| Adapter factory | Do not import simulated TESTNET acknowledgements as genuine venue evidence or instantiate live clients based on a manifest digest. Existing PAPER simulator and hard LIVE mode denial remain. |
| Readiness and certification | Reuse /api/ready and qa/gates.ts; no second health route or per-request expensive full integrity scan. Existing takeover verifies audit/memory and ledger. Genuine independently attested 72h soak remains pending. |
| Manifest builder | Caller-supplied SHA/timestamps and fallback venue equity equal to internal equity cannot independently prove parity or elapsed unattended operation; no release-authorizing digest produced. |
| Local bootstrap/CI scripts | Existing CI already binds actual event SHA and runs workspace checks. Do not manufacture missing module files or synthetic certification artifacts. |
| Environment and Railway runbook | Current database path derives from MIA_DATA_DIR/mia.db and current HTTP settings use MIA_PORT/MIA_HOST. Proposed MIA_SQLITE_PATH and unlock flags are not canonical. Do not deploy, inject signing keys, or change service configuration without verified runtime and security gates. |

PR checklist: preserve prior code and PAPER behavior; exact-head/merge CI required; actual SIGTERM integration and multi-process recovery evidence required; external OMS reservation/partial-fill/venue parity, per-engine exposure, DITAS health-gated learning, genuine soak and Privy wallet-signing authorization remain open. No real-money authorization or deployment changes. Keep draft.

## P0–P2 launch roadmap reconciliation (2026-11-25)

Twenty supplied PDFs describe a Python/PostgreSQL architecture and staged production sign-off. Two pairs (operator CLI and end-of-soak auditor) repeat content. Do not replace the existing Node/Fastify/SQLite stack or create parallel state authorities. Baseline e4dc84d passed CI run 45573750210.

### Phase 1 — Core reliability (P0)
- Extend server/test/runtime-shutdown.test.ts: launch actual src/main.ts under Node with tsx loader, isolated SQLite directory, offline networking, boot marker and HTTP readiness. Send actual SIGTERM; require exit 0 within 10s, reopen and check committed balance, quick_check and audit chain. This exercises offline idle shutdown, not mid-venue-I/O or complete descendant process-tree auditing. Windows explicitly excluded from POSIX signal test.
- Extend server/test/brainos-wal-audit.test.ts: real child acquires canonical lease and commits fixture funds. Parent suspends child with SIGSTOP, waits for actual expiry and acquires the same database lease, commits a second fixture deposit, resumes old process with SIGCONT and requires LeaseLostError before stale transaction can mutate state. Child is reaped on completion/failure. Existing SIGKILL transaction regression remains. This is a two-process lease test, not full standby scheduler failover RTO certification.
- Harden ops/lease.ts: finite safe-integer TTL/timestamps, valid identity, well-formed persisted lease, backward clock observation fails closed; reuse validation in read-only leaseWitness.ts. Regression exercises malformed timestamps and denied renewal without mutation. This is NOT immunity to forward clock jumps or a server-clock distributed lease. Preserve single-host SQLite deployment until an explicit reviewed database migration is warranted.

### Phase 2 — Financial integrity (P0)
- Existing transactional PAPER OMS, per-position reconciliation and unresolved-order entry freeze retained. Durable asynchronous external-order reservations and authenticated venue balance/fill reconciliation remain blocked by absent certified adapters. A missing venue order alone must not unlock an uncertain submission. Do not install PostgreSQL migrations, synthetic confirmed-balance seeding or separate emergency CLI. Existing owner control, pause, emergency and durable close paths remain authoritative. Do not force-evict leases or clear halts outside audited control and verified recovery.

### Phase 3 — Risk and adaptation (P1)
- Existing reserve floors, anti-churn, adaptive drawdown reductions and strategy lifecycle maintained. Engine-specific exposure attribution, verified performance profiles and atomic external reservation limits remain incomplete. No additional financial balance table or caller-provided performance promotion.

### Phase 4 — Production certification (P2)
- Health-gated DITAS, actual 72h unattended evidence, authenticated independent venue parity and verified Railway/Privy boundaries remain open.
- Python container, tini/pytest workflows and migration predeploy scripts target an incompatible runtime; preserve current deployment until a separately reviewed Node image and volume/signal integration are tested. No Railway service mutation. Privy negative signing tests belong exclusively to isolated unfunded staging with verified endpoints and policy identity; generic HTTP errors or skipped tests cannot establish policy enforcement. Never run transaction requests against production funds to test rejection.
- Caller-entered soak start/end and SHA are not independently authenticated continuous runtime evidence. Read-only snapshot checks complement rather than substitute for historical telemetry.
- Launch sign-off: BLOCKED. Require exact merge SHA, three independently recorded clean CI runs, real process tests, review of all safety gates, and verified operational acceptance. No synthetic green check or automatic live unlock. Current draft targets #135 branch, not main. No deployment or authorization change.

## Durable reservation quarantine and P0 evidence increment (2026-11-25)

Source: twelve PDFs (including duplicate release-gate tests), baseline 2af3a64, CI run 45577472118 successful. Continue draft #137; its base is codex/mia6-brainos-autopilot, not main.

Implemented in existing modules:
- exec/recovery.ts: single canonical PAPER unresolved-order query recognizes all non-allowlisted statuses including PENDING_RESERVE, SUBMITTED, PARTIALLY_FILLED and AMBIGUOUS. A pending approval is exempt only as an unfilled BUY entry without a position. An ACTIVE stop is exempt only when an unfilled SELL protective stop matches an open position in the same account/instrument, positive quantity and current stop price. Malformed approvals and orphaned/mismatched active stops quarantine entries. No automatic order-state changes, cash refunds or new execution authority.
- Existing risk gate, OMS, durable session and /api/ready already consume this query. qa/gates.ts G05 now also requires zero unresolved PAPER orders alongside canonical ledger reconciliation and fails on unavailable evidence. It explicitly does not certify external venue parity.
- server/test/gates.test.ts: persisted order quarantine across actual WAL reopen, readiness failure, release denial even with supplied successful test report, unchanged order rows, invalid approval and orphan stop coverage.
- server/test/brainos-wal-audit.test.ts: two real child processes using the same canonical lease and ledger; primary is killed with SIGKILL after standby first reports denied acquisition. Standby waits actual expiry, acquires lease and commits fixture funds; assert old fence invalid, balances and audit chain intact, children reaped. This tests lease failover, not full production scheduler or venue recovery.
- Existing CI workflow adds three targeted reproducible shuffled runtime/WAL process test runs on the same checked-out merge commit. Not three independent full CI runs and not an attestation of 72h soak. No second workflow.

Deferred / rejected imports:
1. The suggested DurableReservationStore uses better-sqlite3, separate sleeve balance callbacks, and a caller-provided epoch comparison that does not prove current canonical lease ownership. Do not install a competing ledger. Existing PAPER fill is synchronous and atomic; external asynchronous write-ahead reservations still require a native SQLite canonical migration, authenticated adapter identity and cumulative fill settlement, lease-checked transactions, fee/quantity accounting and append-only transitions. No external dispatcher exists in this branch.
2. Do not release an ambiguous reservation merely because lookup returns no order; a delayed acceptance may exist. No automatic retry or refund on timeout. The proposed bridge only quarantines some symbol/sleeve pairs; preserve global PAPER quarantine pending real encumbrance accounting. Do not give cognitive memory financial write callbacks.
3. The proposed mid-network test references an unimplemented /api/oms/orders route and MIA_PAPER_VENUE_BASE_URL; do not introduce a test-only production execution bypass. Existing real offline SIGTERM and new SIGKILL tests are partial coverage. Actual authenticated in-flight adapter drain and descendant tree audit remain pending.
4. Reservation hash shape checks are not full historical chain verification. A mutable row without retained transition history cannot independently prove the previous hash. Reuse existing audit chain; do not emit a live-authorizing digest from unverified manifest flags or environment overrides (MIA_CI_P0_VERIFIED). Existing G07/G08/G10/G12/G13/G14 remain blocked; preserve 30-day/50-trade prospective requirement, owner authorization and hard BOUNDED_LIVE lock. A 72h soak, even if eventually genuine, is not a replacement for stricter existing gates.
5. No promote-live-bounded script, Railway deployment, signing policy change or new API route installed. Environment exports in a shell do not roll back a deployed runtime. Release certification remains BLOCKED until independently authenticated evidence and actual adapters exist.

Exact new head CI, independent review and merge readiness remain required. Do not claim production certification, live settlement or completed P0-P2 roadmap from these incremental PAPER changes.

## Stack consolidation and offline verification (2026-11-25)

Source: ten owner-provided consolidation and phase-verification PDFs. Baseline b2005c1 passed CI run 45592947368; main was a39ddaa597172619d8c897e49464910ebad6681f. GitHub compare confirms main is an ancestor (140 baseline commits ahead). Backup branch backup/pr-137-pre-consolidation-b2005c1 points to the baseline SHA.

| PR | Pinned head | Consolidation disposition |
| --- | --- | --- |
| #128 | 90b94790799e0645803c21441d5a939004f6c71e | Ancestor |
| #129 | ed84155125c87ecfd30715464de330a794c1a8e6 | Ancestor |
| #130 | 6900d8e7cc5074e80086f9d01db54afd561fecac | Ancestor |
| #131 | 756becc9dda48649795091aa9848b299e5a75694 | Diverged one commit; inspect its two changed files: all nonblank patch additions present in baseline, including exit freshness, remaining-lot rounding and regression cases. |
| #132 | ddbb08f6f296c561698232108eb52c0abb9105c9 | Ancestor |
| #134 | b03f95b01d30c765fc4a964d01f6f373f3158adb | Ancestor |
| #135 | af8ac9770369313df6d2cd061de4737fea305611 | Ancestor |
| #136 | c4f3bc8b6bd0c69d909073106284cfb36feaa190 | Diverged one commit; all nonblank patch additions across five files present, except two imports expanded to include additional symbols. Leader-only checkpoint recovery and continuing protection tests retained. |
| #137 | b2005c1bd5fb5f3331cbe161aa4a63139bc495e9 | Canonical consolidation source |

Ancestry is not feature certification. Patch review establishes absorption of the two divergent changes, not complete behavioral equivalence of every later edit. Do not cherry-pick identical changes or merge redundant branches. Retarget the existing draft #137 to main rather than duplicate its branch/PR; keep all original PRs open until the consolidated candidate actually passes checks, receives review and merges. Do not close unrelated backlog items.

Implementation:
- scripts/verify-brainos-phases.sh: explicit full local offline verification (secret scan, typecheck, production build, existing server and web suites, three shuffled P0 runs), plus --p0-only for existing CI. Checks exact expected SHA when supplied and rejects tracked worktree changes. Run via bash after npm ci. Isolated temporary data/home/tmp and allowlisted process environment prevent inherited application secrets, production data paths and opt-in live test flags from being passed to test commands. Only test logs retained on failure; no production endpoint probes or new release authorization.
- Existing CI invokes the script in the P0 step and uploads failure logs. No competing workflow; existing full QA, dependency audit and Playwright jobs are retained.
- Existing gates.test.ts checks the actual canonical mode authority with absent/false/true MIA_OWNER_LIVE_ACK, a synthetic certificate and permissive callback: all must reject BOUNDED_LIVE, preserve PAPER emergency halt and leave financial/audit/settings records unchanged.

Phase evidence: 1 (build/AST) and 2 (deterministic PAPER/lease/shutdown) have baseline CI evidence, not current-candidate evidence yet. 3 external reservations/settlement and 4 health-gated DITAS adaptation are still incomplete. Existing backtest and replay fixtures are regression evidence, not historical market profitability or full autonomous prospective certification. 5 Railway volume persistence, Privy signing isolation, Cloudflare origin protection and 6 72-hour/30-day prospective evaluation remain unverified. Use existing /api/ready, actual API auth, canonical MIA_DATA_DIR and existing server/src/main.ts composition root. Do not use proposed non-existent routes, environment flags, promotion scripts, shell sleeps in lieu of state assertions, broad DB dumps or unauthenticated production POST probes.

At baseline all three Vercel status links explicitly reported build-rate-limit upgrade links; this is not evidence of a current source compilation error. Older PR descriptions report earlier TS2688 failures. Do not remove required checks, modify deployment bindings, or claim deployment migration completed. Retain owner-directed Railway/Cloudflare/Privy target and independently review release checks. Exact new main-target merge CI, security review and deployment verification required; no live activation and no merge while incomplete.

## Historical tape and causal replay foundation (2026-11-25)

Eight supplied PDFs cover a historical event backtester, compressed tape reader, FAST/DEEP evaluators, proposed second CanonicalOMS and adapter factory, DITAS learner and roadmap. Baseline 8baa736 passed CI 45640357855; PR #137 targets main. All three Vercel checks remained failed.

Implemented:
- server/src/lab/tape-reader.ts: bounded streaming gzip NDJSON validation, strict venue/event schema, exact decimal-string BigInt conversion (1e9 scale), real boolean flags, safe integer timestamps and global monotonic chronology. Validate the suffix even if outside the requested filter window; full validation requires consuming the stream. Reject unknown/crossed/negative/malformed records and oversized lines. Caller-provided data is not authenticated market evidence.
- server/src/lab/eventReplay.ts: single-venue/symbol, deterministic research-only execution-cost probes over typed iterable or async iterable tapes. Positive latency, bounded pending queue, later matching observation, bounded wait, no invented after-EOF fills, side-specific observed top-of-book depth (buys consume ask quantity, sells bid quantity; each spent at most once per observation across due probes), conservative integer spread/slippage/fee estimates, streaming digest of input/observations/options. No orders, portfolio, strategy promotion or runtime authority. Trusted research callback, not arbitrary-code sandbox. Funding and launch events are not settled as cash flow. Existing candle backtest, exit capsule and Monte Carlo remain canonical; this is a complementary execution-evidence foundation, not a complete historical BrainOS backtest.
- server/test/historical-replay.test.ts: compressed parsing, invalid records, suffix chronology, missing/malformed files, cancellation, determinism, delayed same-instrument observation, costs, depth contention, expiry and no EOF execution. A follow-up replaced the single `availableTopQtyFp` book field with `bidQtyFp`/`askQtyFp`: one shared quantity let sell probes fill against ask-side depth behind a thin bid. No tapes existed yet, so no data migration was needed.

Deferred:
- Do not install the proposed parallel orchestrator_leases, canonical_orders, envelope_budgets, order_fills and financial ledger. Existing lease, OMS, orders, fills, ledger and risk authority remain canonical. The proposed epoch comparison alone lacks current lease ownership/expiry verification, automatic release after missing venue lookup is unsafe, and Number conversions can silently lose scaled integer precision. Native SQLite does not make a parallel authority safe.
- Do not install a live adapter with caller-injected unlock callback or API credentials. Current BOUNDED_LIVE hard lock remains. Proposed in-memory simulator records do not survive crash and sanitizing client IDs can collide. Actual durable external reservations, authenticated settlement, scoped venue identity and cumulative fill reconciliation remain incomplete.
- FAST/DEEP isolated strategy evaluation needs authentic on-chain/order-book/funding histories, existing FLIN safety, verified margin/fee mechanics and the existing risk/exit logic. No synthetic tape promotes strategies; no PnL or live parity asserted by probe results. No market dataset supplied.
- DITAS already has source-verified calibration, recent version-aware PAPER outcomes and research-only learning observation. Proposed new learner tables and caller-labeled verified outcomes cannot establish provenance or permission; do not enable automatic parameter mutations or count owner-entered forecasts as calibrated trade-win probabilities. Health-gated learning and actual adaptation remain open.
- Genuine soak, Railway persistent runtime, Cloudflare, Privy and deployment checks remain unverified. No deployment or authorization change. Exact new CI and review required; keep draft.

## Durable trading mandate increment (2026-11-25)

The owner's mandate is now persisted with the BrainOS session through migration 7, which is append-only. It records
market scope, authorized capital, risk policy and strategy-set versions, authorizer, and expiry. The paper OMS enforces
it inside the entry write transaction: scope and strategy version through `paperSpotEntryDenial`, and the capital
ceiling against the actual fill through `paperSpotCapitalDenial`. An expired mandate drains the session from the
protection lane. Sessions upgraded without a mandate fail closed. The Autopilot page shows FAST and DEEP selection cards
with server-reported readiness ("Research only"), a mandate summary, and capital and duration inputs in the Run
step-up dialog. FAST and DEEP remain research-only, and LIVE remains locked. The landing redesign in PR #138 is not
touched and remains authoritative. Classification, the pending register and the evidence are in
[`../BRAINOS_MASTER_ARCHITECTURE.md`](../BRAINOS_MASTER_ARCHITECTURE.md).

## BrainOS V2 FAST/DEEP roadmap: trade-built evidence increment (2026-11-26)

Source: the owner's "BrainOS V2 — FAST & DEEP Upgrade Roadmap" PDF (14 pages). The repository was audited first. Most
S2–S4 material was already absorbed or rejected in the increments above, so it is not re-imported. Implemented in
the owning modules:
- `server/src/market/tradeBars.ts` (P1.2): incremental trade-to-bar builder. It works in exact fixed point with
  watermark finalization, quarantine of late, duplicate, future and malformed trades, deterministic rebuild on
  retraction, invalidation for final bars, feed-gap flags, time-bounded dedupe and bounded memory. Final base bars
  are merged into open accumulators and dropped. Its bars feed the canonical `FeatureEngine`.
- `server/src/market/volumeSpike.ts` (P1.3): a pure, versioned volume-authenticity detector. It is a candidate
  trigger only, with no trading authority.
- `server/src/lab/tape-reader.ts` and `lab/eventReplay.ts`: `TRADE_TICK` events and `replayTradeEvidence`, which
  replays through the same builder and detector. A parity test compares the replay digest to the live-path digest.
- `scripts/benchmark-trade-bars.mjs`: latency percentiles and a memory soak mode.

Not wired into the runtime: there is no authenticated Solana trade feed yet. Disposition of every roadmap item is in
[`../BRAINOS_MASTER_ARCHITECTURE.md`](../BRAINOS_MASTER_ARCHITECTURE.md) section 14.
