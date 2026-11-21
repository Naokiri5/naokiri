# MIA 5.0 — MASTER CODEX + CLAUDE PROMPT
## Verified Live Authorization and Unified PAPER / TESTNET / LIVE Execution

SOURCE OF TRUTH: The user-provided original 50-item request, preserved without editing at docs/source-archive/MIA_5_0_USER_50_LIVE_ENHANCEMENTS_ORIGINAL.md. Use this master prompt alongside that original source. The 50-row matrix below covers all items in source order.

REPOSITORY: https://github.com/Naokiri5/naokiri
BRANCH: feat/mia-live-certification-order-state-20261121
PARENT: feat/mia-multimarket-providers-readonly-20261121 (draft PR #95), stacked over #92, #91, #89 and existing THINK feature branches.
STATUS: A CODE-DEVELOPMENT SPECIFICATION, NOT TRADING AUTHORIZATION. LIVE remains locked.

# ROLE AND OBJECTIVE

Act as a senior team of TypeScript engineers, exchange execution specialists, quantitative researchers, app-security engineers, database and SRE engineers, and independent release auditors. Deliver a functioning autonomous multi-market MIA bot in controlled phases without duplicating, weakening, deleting or rewriting existing modules. Finish real TESTNET and paper evidence first, then build a separately secured and reviewed live trading capability, activated only when every release gate and independent human approval passes.

Maintain ONE intelligence/scanner/QCI/FAST-DEEP THINK engine and ONE deterministic risk gate. The environments PAPER, TESTNET and LIVE share the same decision and risk contracts but DO NOT share financial state, credentials, remote order IDs, position or protection records. A control MODE such as BOUNDED_LIVE is not an account or a permission to bypass signing controls.

# MANDATORY NO-DUPLICATION AUDIT

Before any implementation, inspect repository HEAD, dependency PR stack, source owners, tests, schemas and infrastructure. Compare exact symbols and behavior to the original 50 features. Label every item ALREADY_IMPLEMENTED, PARTIAL_EXTEND, NEW_REQUIRED, EXTERNAL_PROOF_NEEDED or CONFLICT, with evidence path, function, test name and commit SHA. If an equivalent feature exists, extend or harden it; DO NOT create a second system.

Preserve the canonical modules:
- server/src/qa/gates.ts — G01 through G14, current commit-bound QA evidence, modeGate.
- server/src/core/mode.ts — OBSERVE, PAPER, APPROVAL, BOUNDED_LIVE, emergency/pause and hard LIVE_EXECUTION_AVAILABLE=false.
- server/src/exec/environment.ts — PAPER OMS wrapper, TESTNET preflight, locked LIVE adapter and typed account scopes.
- server/src/exec/oms.ts — only established PAPER execution engine, simulated fills and current ledger integration.
- server/src/risk/gate.ts and risk/policy.ts — single approved risk policy, sizing, leverage, loss/correlation/cost limits.
- server/src/portfolio/ledger.ts — account-scoped ledger; never post local synthetic exchange fills.
- server/src/market/fabric.ts and market/quality.ts — market data, freshness and cross-venue truth checks.
- server/src/exec/incidents.ts, ops/readiness.ts, qhef/qhef.ts — protection incidents, watchdog and latency metrics.
- server/src/api/routes.ts — existing authenticated Fastify routes, CSRF and owner step-up.
- server/src/providers/* — retain Kraken direct, Coinbase, CoinGecko, DEX Screener, Frankfurter, optional read-only Alpaca, OANDA, Helius, Jupiter, GoPlus; CCXT SDK is NOT_INSTALLED.

The new safe slice is:
- server/src/exec/liveReadiness.ts: read-only blocker report calling canonical G01–G14, mode and build identity. Always canAuthorizeTrade=false.
- server/src/exec/venueOrderState.ts: PURE observer of exchange ACK, FILL, UNCERTAIN and STATUS, no persistence/network/signer. Must NOT be called an operational OMS.

# STRICT SAFETY RULES

1. No AI agent (including Trader Joe), news feed, feature worker, webhook or browser can authorize or sign a trade.
2. No production API key in frontend, CI, prompt, logs, user chat or testnet process. Apply least-privilege IP-scoped trade-only keys, never withdrawals/transfers.
3. G01–G14 must be satisfied by actual verifiable evidence; CI cannot mark human approval or strategy profitability certified.
4. Leave LIVE_EXECUTION_AVAILABLE=false and LockedLiveExecutionAdapter unchanged until reviewed production signer, transactional firewall, durable order state, verified protection and owner grant exist.
5. Real TESTNET orders require dedicated credentialed sandbox approval; successful /api/v3/order/test does NOT place an actual testnet order.
6. Generate one stable client order ID per account-specific intent. Persist durable intent/reservation before POST. On timeout, 5xx or crash, mark UNKNOWN and reconcile with venue; NEVER blindly resubmit.
7. Use decimal-safe or integer atomic quantities; Number floating-point is unacceptable for final venue fills, fees, currency conversions and ledger postings.
8. Reconcile order and fills against REST plus authenticated execution reports at startup and after stream gap. A remote filled status without trade receipts must NOT invent ledger entries.
9. Every risk approval must be fresh at signing, account scoped, and no broader than owner-approved allocation/venue/symbol limits; refuse unexpected or stale data.
10. Stops and protections are separately checked for actual venue support, quantity and acknowledgment. A local software stop is not a remote exchange-hosted protection guarantee.
11. If deployment SHA, risk policy version, certified signer, owner grant, account eligibility or venue capability cannot be verified, refuse LIVE.
12. Copy third-party LICENSE-compatible concepts and tests selectively; do not paste Python/Rust repositories wholesale. No separate scanner, QCI, OMS or ledger.

# FULL ORIGINAL 50-ITEM IMPLEMENTATION MATRIX

The item names, descriptions and Build/Extend classifications derive from the attached original, without changing their intended scope. Paths are proposed engineering owners, NOT claims of completed code.

| # | Original requirement | Original action | Canonical extension target | Required improvement |
|---:|---|---|---|---|
| 1 | Unified live release gate | Extend | qa/gates.ts + exec/liveReadiness.ts | Extend `server/src/qa/gates.ts` so every G01–G14 requirement must show verified evidence from the release candidate. |
| 2 | Signed release certificate | Build | security/releaseCertificate.ts | Bind live authorization to the exact deployed commit, risk policy, venue, account and expiry. Reject unverified builds. |
| 3 | Hardware-backed owner authentication | Build | api/auth.ts + security/webauthn.ts | Require MFA/passkey or security-key step-up for initial live activation and risk-increasing changes. |
| 4 | Isolated trading signer | Build | security/tradingSigner.ts | Create a separate service that signs only preauthorized orders. AI agents and the website must never access raw signing credentials. |
| 5 | Secure credential vault | Build | security/secrets.ts | Store, rotate and revoke API secrets using Vault, cloud KMS or an equivalent managed secrets system. |
| 6 | Least-privilege exchange keys | Build | security/tradingSigner.ts | Restrict keys to trading, approved API scopes and IPs where supported. Disable withdrawals and transfers. |
| 7 | Account-specific permissions | Extend | exec/environment.ts | Separate PAPER, TESTNET and LIVE accounts, permitted strategies, symbols and capital allocations. |
| 8 | Transaction firewall | Build | exec/transactionFirewall.ts | Immediately before signing, independently verify owner authorization, current risk, venue, instrument, notional and remaining limits. |
| 9 | Independent release approval | Build | qa/gates.ts + review record | Require a separate security/release reviewer to approve the initial production release; retain the owner's final approval. |
| 10 | Expiring live authorization | Build | security/releaseCertificate.ts | Make live permission time-limited and revocable. A restart must not silently renew or broaden authorization. |
| 11 | Asynchronous execution contract | Extend | exec/environment.ts + exec/venueOrderState.ts | Extend `exec/environment.ts` to support exchange acknowledgments, pending orders and delayed fills without replacing the existing paper OMS. |
| 12 | Real TESTNET order execution | Build | exec/venues/binanceTestnet.ts | Add a separately gated adapter for virtual-fund orders through the exchange matching engine; first prove it without real money. |
| 13 | Durable order-intent ledger | Build | db/migrations.ts + exec/intentStore.ts | Persist each authorized order and reservation in the database **before** making a network request. |
| 14 | Unique exchange order identity | Build | exec/venueOrderState.ts | Generate stable client order IDs tied to account, venue and execution intent. Deduplicate repeated requests. |
| 15 | Unknown-order recovery | Build | exec/venueOrderState.ts | On timeout or uncertain response, freeze affected new entries and query the exchange. Never blindly resubmit. |
| 16 | Complete order state machine | Build | exec/venueOrderState.ts | Support `NEW`, `ACKNOWLEDGED`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED` and `UNKNOWN`, with venue-specific mappings. |
| 17 | Real-time execution reports | Build | exec/streams.ts | Subscribe to authenticated exchange order and account streams; detect disconnects and missing updates. |
| 18 | Exchange reconciliation | Build | exec/reconcile.ts | Compare local order IDs, fills, balances and positions with the exchange at startup, after reconnect, and periodically. |
| 19 | Actual fill and fee accounting | Build | portfolio/ledger.ts | Use exchange-confirmed fill quantities, prices and commissions. Apply decimal-safe financial arithmetic and deduplicate fill events. |
| 20 | Exchange-side protective orders | Build | exec/protection.ts | Verify supported stop, bracket or OCO orders and their protected quantities. Halt new entries when required protection is unavailable. |
| 21 | Shared risk rules across environments | Extend | risk/gate.ts | Reuse one risk-policy engine, but evaluate it against each environment's actual account balances, outstanding orders and exposure. |
| 22 | Hard live-capital allocation | Extend | risk/policy.ts + exec/firewall.ts | Set a maximum approved account allocation and per-order notional cap that MIA itself cannot increase. |
| 23 | Cross-venue portfolio exposure | Build | portfolio/correlation.ts | Track exposure across approved exchanges and brokers in a common reporting currency, without merging their ledgers. |
| 24 | Correlation and concentration limits | Extend | portfolio/correlation.ts + risk/gate.ts | Extend existing correlation checks to stock sectors, crypto assets, FX currency exposure and correlated positions. |
| 25 | Pre-order slippage budget | Extend | market/quality.ts + exec/firewall.ts | Recalculate spread, fees and market impact using fresh venue data immediately before execution. Refuse unfavorable trades. |
| 26 | Stale-data rejection | Extend | market/quality.ts + market/depthStream.ts | Preserve MIA's existing timestamp and data-quality checks; add venue sequence-gap and order-book recovery safeguards. |
| 27 | Daily, weekly and drawdown breakers | Extend | risk/gate.ts | Apply existing loss breakers to real venue-confirmed equity and unrealized exposure, not only paper-account estimates. |
| 28 | Flash-crash and abnormal-volatility protection | Build | risk/gate.ts + regime/regime.ts | Detect exceptional volatility, liquidity collapse and abnormal price divergence; reduce new exposure or pause entries. |
| 29 | Order-rate and exposure-velocity limits | Build | exec/transactionFirewall.ts | Cap orders per minute, outstanding orders, rapid position increases and repeated failed entries. |
| 30 | Emergency stop and safe recovery | Extend | exec/incidents.ts + core/mode.ts | Extend existing emergency controls so they block new orders at the execution boundary, inspect open venue orders, and require verified recovery before resuming. |
| 31 | Exchange instrument filters | Build | exec/venueCapabilities.ts | Validate tick size, step size, minimum notional, permitted order types and current venue filters before submission. |
| 32 | Stock-market session controls | Build | market/calendar.ts | Respect market hours, halts, extended-session permissions, corporate actions and instrument trading restrictions. |
| 33 | Forex margin and currency rules | Build | exec/venues/oanda.ts | Add practice-tested contract sizing, pip value, currency conversion, margin and financing-cost checks. Initially disallow leverage beyond approved limits. |
| 34 | Venue capability registry | Build | exec/venueCapabilities.ts | Require each adapter to declare supported orders, stops, market data, sandbox availability and reconciliation completeness. |
| 35 | Broker eligibility verification | Build | ops/accountEligibility.ts | Verify that the owner account, instrument and trading API are actually permitted in the relevant jurisdiction. |
| 36 | Solana transaction safety | Build | safety/safety.ts + providers/goplus.ts | Before any future swap signing, inspect token authorities, liquidity, transaction simulation, route, slippage and wallet approval exposure. |
| 37 | Clock synchronization | Extend | exec/venues/binanceTestnet.ts | Extend the testnet clock check to each production venue; stop signed requests when exchange clock drift is unacceptable. |
| 38 | Single-leader execution fencing | Extend | bot/leaderLease.ts + exec/firewall.ts | Ensure only one authorized leader can send orders for an account, even during failover or overlapping deployments. |
| 39 | Cross-venue price confirmation | Extend | market/quality.ts + market/fabric.ts | Extend the existing market-quality fabric to distinguish genuine independent prices from stale, derived or non-tradable reference rates. |
| 40 | Venue maintenance and outage controls | Build | providers/http.ts + ops/readiness.ts | Detect trading suspensions, maintenance, rate-limit bans and unavailable order endpoints; isolate the affected venue. |
| 41 | Complete G10 paper evaluation | Extend | qa/gates.ts + paper evaluation data | Record at least 30 days and 50 closed paper trades as required by MIA's release gate, with credible execution and risk statistics. |
| 42 | Shadow production mode | Build | decision/engine.ts + lab/lab.ts | Run decisions against observed production-market conditions without submitting orders; compare predicted and actual executable prices. |
| 43 | Walk-forward strategy evaluation | Extend | lab/lab.ts + lab/strategies.ts | Use genuinely out-of-sample periods, realistic costs, parameter sensitivity and regime changes before promoting any strategy. |
| 44 | Calibrated signal uncertainty | Extend | qci/coordinator.ts + decision/think-router.ts | Measure predictive calibration against realized outcomes; return `NO_VALID_FORECAST` or abstain when evidence is insufficient. |
| 45 | AI and assistant permission firewall | Extend | joe/joe.ts + security/tradingSigner.ts | Keep Trader Joe and all AI workers outside the signing authority. Test prompt-injection, malicious market metadata and attempted privilege escalation. |
| 46 | Chaos and disaster testing | Extend | test/miaChaosSuite.test.ts + test/exec | Simulate exchange timeouts, process crashes, partial fills, database interruption, duplicate events, lost streams and network partitions. |
| 47 | Production observability | Extend | qhef/qhef.ts | Extend QHEF with execution traces, reconciliation lag, uncovered exposure, signer-denial counts and actionable incident alerts. |
| 48 | Verified backup and restore | Extend | ops/backup.ts | Encrypt and back up the trading database, evidence keys and release records; regularly test recovery without repeating orders. |
| 49 | Secure software supply chain | Extend | github/workflows/ci.yml | Add CodeQL/security review, dependency and secret scans, SBOMs, signed deployment artifacts, protected branches and reproducible release evidence. |
| 50 | Independent live go/no-go and bounded pilot | Build | qa/gates.ts + security/releaseCertificate.ts | Require G13/G14 human approvals, all other gates, explicit account caps, a written incident plan and a separately approved small real-money pilot. |

# MIA OPERATIONAL RELEASE PHASES

PHASE 0 — AUDIT AND PRESERVE: build source inventory; verify all 50 requirements and existing gates against actual current branch. Run baseline tests and hash source. Identify duplicate or stale concepts before code changes.

PHASE 1 — REAL TESTNET ORDER LIFECYCLE: extend versioned asynchronous ExecutionAdapter, append-only SQLite migrations and durable outbox. Isolated virtual funds; canonical risk gate; venue order placement only after TESTNET-specific authorization. Implement order and fill reconciliation, partial fills, replay, cancellations, fee assets, client order IDs and loss of connectivity. Preserve existing PAPER OMS and its tests.

PHASE 2 — ACTUAL RISK, PROTECTION AND PORTFOLIO STATE: feed fresh authenticated exchange-account facts into the existing gate. Add instrument filters, venue-native stop verification, limits across accounts, account-epoch reset awareness, per-venue time and outage gates, leader fencing. Fail-closed on missing fills, stale price, unknown account balances, unsupported stops and changed symbol precision.

PHASE 3 — LIVE SECURITY IMPLEMENTATION (STILL LOCKED): isolated signer service, signed owner-specific release certificate, vault/KMS, per-order transaction firewall, owner MFA, revocation, production read-only SHADOW, threat model, passwordless release proof and audit records. Independent G07/G08/G12/G13 reviews are required; software tests alone cannot satisfy them.

PHASE 4 — CERTIFICATION: complete 30 days and at least 50 real closed PAPER trades, walk-forward statistical checks, execution parity tests, independent security review, exchange outage and crash drills, backup/restore, human release auditor review and owner G14 authorization. Two approvals: execution readiness AND strategy readiness; neither implies profit.

PHASE 5 — OWNER-APPROVED BOUNDED LIVE PILOT: after every G01–G14 PASS with trustworthy current deployment evidence, an independent reviewer and the owner explicitly approve one restricted account/venue/strategy/allowlist, hard capital and loss ceilings, expiry, rotation and revocation. No autonomous expansion or renewed certificate. Any ambiguous state returns to LOCKED until reconciled.

# EXACT DATA CONTRACTS TO IMPLEMENT IN PHASE 1

Suggested append-only schema (NOT yet a migration; review existing schema and migration version first):

~~~sql
CREATE TABLE venue_order_intents (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('TESTNET', 'LIVE')),
  account_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
  requested_units TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  trace_id TEXT NOT NULL,
  leader_fence_token TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(environment, account_id, venue_id, client_order_id)
);
CREATE TABLE venue_trade_receipts (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  account_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  venue_trade_id TEXT NOT NULL,
  quantity_atomic TEXT NOT NULL,
  price_atomic TEXT NOT NULL,
  fee_atomic TEXT NOT NULL,
  fee_asset TEXT NOT NULL,
  exchange_timestamp INTEGER NOT NULL,
  UNIQUE(environment, account_id, venue_id, venue_trade_id)
);
CREATE TABLE venue_order_events (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES venue_order_intents(id),
  event_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
~~~

Add explicit environment/account/venue matching foreign keys, unique event replay semantics, journal integrity, migration tests, monotonic leader fencing, durable reservation and restart/recovery behavior. SQLite transactions are NOT atomic with remote exchange requests. Never create money movement from a local ACK or HTTP 200.

Suggested future signed release envelope (NOT implemented by the current TypeScript):

~~~ts
interface ProposedLiveReleaseEnvelope {
  schemaVersion: 1;
  environment: 'LIVE';
  buildSha: string; // exact clean deploy SHA
  policyVersion: number;
  accountId: string;
  venueId: string;
  allowedSymbols: string[];
  allowedStrategies: string[];
  maxTotalAllocationAtomic: string;
  maxOrderNotionalAtomic: string;
  maxDailyLossAtomic: string;
  maxOpenOrders: number;
  issuedAt: number;
  expiresAt: number;
  ownerSignerId: string;
  independentReleaseReviewerId: string;
  nonce: string;
  signature: string;
}
~~~

Never mint this envelope from user-supplied JSON, AI output, test results alone or an environment flag. A signer must independently verify grant signatures, revocation, actual deployment SHA/policy, exact account, venue, data freshness, risk and hard caps before signing the specific order. Exposure limits must be durable across restart and retries. Values are owner/reviewer-selected and must not be invented by code.

# MANDATORY TESTING AND ACCEPTANCE DATA

T01: preserve main PAPER OMS behavior and all existing regression suites.
T02: three environments and two separate account/permission concepts are isolated.
T03: G01–G14: missing/duplicate/PENDING/FAIL/stale evidence locks LIVE.
T04: all gates mocked PASS still cannot invoke a live signer in this safe slice.
T05: deployment SHA unknown, mismatched, dirty or expired prevents a future signed release.
T06: current policy invalid, changed, absent or expired prevents approval.
T07: credential leaks/redirects, withdrawal/transfer API scopes and broad signer access are refused.
T08: persist intent BEFORE simulated venue POST and verify crash recovery.
T09: on timeout/5xx keep UNKNOWN, freeze affected new risk, query venue, no duplicate resubmit.
T10: duplicate exchange event and trade IDs do not duplicate quantity, fee or PnL.
T11: partial fill then cancel preserves executed quantity and remaining exposure.
T12: venue FILLED response without execution receipts does not generate cash-flow or fake fills.
T13: account or environment mismatch is denied before journal or signer access.
T14: status stream gap, venue outage, unknown balances, bad clock, stale market data => refuse new exposure.
T15: unsupported stop, mismatched stop quantity and unprotected position => critical incident, no new entry.
T16: emergency, owner revoke and risk breaker prevent new orders even when AI retries.
T17: real venue instrument precision/minimum, session, fees, commissions and FX conversion are verified.
T18: all 100 worker roles and assistant permissions must be tested and external-output prompt injection resisted.
T19: 30 real paper days / 50 trades are counted only from attributable observed history, not artificial test fixtures.
T20: server unit/integration, web unit, Playwright E2E, current SHA QA, TypeScript build, secret scan, dependency audit, isolated chaos suite and verified backup-restore succeed.

Log actual pass/fail/skipped counts, commit, environment, tool versions, operator review decisions and unresolved risks. Offline mocks are not evidence of credentialed exchange connectivity.

# GITHUB SOURCE REFERENCES — COMPARE, DO NOT WHOLESALE IMPORT

- nautechsystems/nautilus_trader: https://github.com/nautechsystems/nautilus_trader — order/event reconciliation and startup recovery.
- hummingbot/hummingbot: https://github.com/hummingbot/hummingbot — in-flight order tracker and fill events.
- ccxt/ccxt: https://github.com/ccxt/ccxt — exchange features, sandbox and error handling; avoid duplicate Kraken.
- freqtrade/freqtrade: https://github.com/freqtrade/freqtrade — risk and cooldown protections.
- QuantConnect/Lean: https://github.com/QuantConnect/Lean — cross-environment event model.
- alpacahq/alpaca-trade-api-js: https://github.com/alpacahq/alpaca-trade-api-js — TS broker metadata and API shape.
- oanda/v20-javascript-samples: https://github.com/oanda/v20-javascript-samples — practice-account API patterns.
- TauricResearch/TradingAgents: https://github.com/TauricResearch/TradingAgents — research debate (never signing authority).
- polakowo/vectorbt: https://github.com/polakowo/vectorbt — cost-aware walk-forward research.
- hashicorp/vault: https://github.com/hashicorp/vault — key isolation and rotation.
- open-telemetry/opentelemetry-js: https://github.com/open-telemetry/opentelemetry-js — extend QHEF.
- OWASP/ASVS: https://github.com/OWASP/ASVS — application security verification.
- aquasecurity/trivy: https://github.com/aquasecurity/trivy — build and dependency scanning.
- chaos-mesh/chaos-mesh: https://github.com/chaos-mesh/chaos-mesh — optional infrastructure chaos patterns.

Check their licenses, maintenance status, current API documentation, and match with MIA TypeScript. Do not claim an external engine is installed if it is merely cited.

# DELIVERABLES AND DONE DEFINITION

Provide a traceable 50-feature audit, minimal-diff TypeScript, append-only migrations only after validation, comprehensive tests, exact CI results, a safe deployment/rollback runbook, owner-only secure credential setup, and a draft PR. Distinguish all proposed steps from built/tested features.

Start from the safe modules added on this branch: exec/liveReadiness.ts and exec/venueOrderState.ts. They demonstrate truthful live blockers and pure event handling, NOT executing/admitting an order. The next independently reviewed milestone is a durable TESTNET OMS. Leave production LIVE locked until every independent gate and legal/broker eligibility condition is met.

Do not advertise guaranteed returns or fully operational LIVE trading without verified venue executions, audited safeguards and approved capital authorization.

---

## MIA5 2026-11-22 hardening PDF delta — actual repository ownership

**Source:** The uploaded 25-page “MIA 5.0 — Unified Hardening Documentation, TypeScript Catalog & Master Agent Prompt”, archived as parsed text at docs/source-archive/MIA5_HARDENING_25P_PARSED_SOURCE.txt. Also consider the uploaded 35-page Hive specification and the related PR #91/#93. These are proposed specifications, not evidence that the named modules are currently implemented.

### Use the existing modules, not the proposed duplicates

| PDF names | Existing canonical MIA | Engineering decision |
| --- | --- | --- |
| auth/privyWalletGuard.ts | server/src/security/privy.ts and server/src/api/auth.ts | Extend existing owner authentication; no second sign-in, session store or inferred wallet signing authority |
| CanonicalRiskGate.evaluateAndReserveIntent | server/src/risk/gate.ts evaluateRisk(), risk/policy.ts, exec/oms.ts | Preserve sole trading risk owner; extend only through tested existing transaction, risk and OMS boundaries |
| better-sqlite3 and mia_ledger.sqlite | Node DatabaseSync from node:sqlite, server/src/db/db.ts tx(), existing mia.db migrations | Do not add a second DB file/library or competing order-intent ledger |
| PaperOmsAdapter / LiveOmsAdapter | server/src/exec/oms.ts and server/src/exec/environment.ts | Keep PAPER OMS; TESTNET preflight and LIVE remain locked pending certification |
| buildMiaServer / reconcileStartupIntents | server/src/index.ts buildApp(), main.ts, ops/lease.ts, exec/venueOrderState.ts | Add durable venue reconciliation only after a real account-scoped intent journal and venue source exist |
| AGT-001..100, 10 orthogonal buckets | server/src/workers/registry.ts, runtime.ts and signed QCI in qci/coordinator.ts | No second voting registry; the existing 100 workers run in 11 correlated evidence domains |
| 97-slot Hive engine | Prior work on PR #91/#93 | Review and reuse; do not copy the Hive implementation into a duplicate live-certification stack |
| risk/gate.test.ts | server/test/risk.test.ts, oms.test.ts, liveAuthorizationAndOrderState.test.ts, and other existing suites | Run actual tests, not the PDF's assumed paths |

### Implemented in this PR

- The canonical venueOrderState.ts observational reducer rejects unsupported event kinds, status sources, statuses, uncertain reasons, invalid order sides and unsafe identity keys at runtime, before persisting any event as observed.
- Its deduplication uses own-property access to avoid treating inherited object properties as authentic event/trade history.
- The existing venue observation module also exposes toDeterministicVenueClientId: a non-executing, SHA-256-derived client ID with environment/account/sleeve/key scoping and strict Binance/OKX/Alpaca/Solana format validation. It does not reserve an intent, communicate with a signer or authorize any order; the future canonical OMS must persist uniqueness and reconcile uncertain network outcomes.
- Existing liveAuthorizationAndOrderState.test.ts covers malformed and adversarial payloads. Existing trade-ID deduplication, cross-account protection, UNKNOWN-on-uncertainty and per-fill atomic units are preserved.
- No new authorization route, risk decision, exchange POST, live signer, database table or second OMS has been created. The LIVE lock is unchanged.

### Objective: MIA autonomy with minimum routine owner action

1. Continuously gather validated, timestamped market evidence via one fabric and one scanner, 100 existing workers, QCI and recorded decisions. Abstain when feeds are stale, inconsistent or non-independent. FAST and DEEP share intelligence and risk authority.
2. Evaluate decisions through a single deterministic, portfolio-aware risk policy. Never let an agent, LLM, frontend, backtest or manual path skip the canonical risk/OMS boundary; preserve stops, cost limits, concentration, daily/weekly breakers, account isolation and idempotency.
3. Once a venue is separately certified, persist order intent BEFORE exchange network access. Never blindly retry timeouts or 5xx outcomes. Reconcile by account, client-order ID, venue trade IDs and actual partial fills before exposing more capital.
4. Automatically recover only safe observational tasks (feeds, scanning, bounded restart after verified liveness); back off and alert on repeat failures. HALT and request human review when financial state, ownership, balance or protection is unknown. Never auto-arm LIVE on startup or silently expand limits.
5. Keep normal in-envelope scanning and position management autonomous after certification, with owner actions reserved for initial account enrollment, policy authorization, critical incidents, revocation and changes in risk capacity.
6. Validate outcomes net of fees, slippage and realized fills with genuine backtests, holdouts and production-like soak. Do not claim 100% accurate trades or profitable execution from static contracts or synthetic tests.

### Merge and release checklist

- Compare PR branch heads, base branches, dependencies and overlapping files against current main. An open PR is not a shipped feature. Preserve existing integrations with PR #91/#93 (Hive), #98 (order state), #101 (decision overlays) and #106 (paper bundles).
- Run exact-head npm ci, typecheck, production build, server/web tests, relevant E2E, secrets scan and high-severity dependency audit. Capture evidence for *this* SHA, not an earlier successful commit.
- Audit issuer/wallet ownership proof, CSRF, idempotency, race conditions, durable replay, uncertain sends, protective exits, loss caps, migration conflicts and rollback.
- Require independent security and financial-risk review before merge or release. A PR marked non-mergeable, missing exact-head CI or Vercel rate-limited is NOT READY.
- LIVE remains blocked until G01–G14, independent certifications, real TESTNET order/fill lifecycle, restricted signer, durable reconciliation, operational monitoring and explicit owner-bound authorization are verified. A read-only readiness report is never execution authority.

**Prime directive:** Do not replace the established architecture merely to match a proposed TypeScript catalog. Prefer narrow verified enhancements of actual canonical owners, with regression coverage and truthful operational status.
