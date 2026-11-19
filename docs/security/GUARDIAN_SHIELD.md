# Guardian Shield: seven-layer defence in depth (phase P0 + P4)

Status: **first slice implemented and offline-tested:** read-only telemetry, an opt-in pause, and boundary tests.
- The edge, host and CI-scanner layers need the owner's hosting access or verified pins. They are documented below as pending, not claimed.
- Source: owner-supplied *MIA Guardian Shield master prompt*, skill, runbooks and `assess.ts` (2026-11-19).
- Guardian is **not a second trading brain**. It cannot trade, sign, withdraw, raise a limit, resume trading or enable Live.

## What is live in this slice

| Piece | Where | What it does |
|---|---|---|
| Assessment | `server/src/security/guardian/assess.ts` | The owner's prototype, extended. Assigns P0–P3 and suggests defensive steps. Pinned `canAuthorizeTrading/canSignTransactions/canWithdraw: false`. Events with untrustworthy time or provenance are quarantined rather than acted on. |
| Events | `guardian/events.ts` | Derived from the **existing** hash-chained audit log; there is no second event store. It watches: <ul><li>sign-in and step-up failure bursts</li><li>owner identity replaced (Privy re-link, authenticator reset, passphrase change)</li><li>a mode change by a non-owner or to Live</li><li>any signer action (this build has none)</li><li>withdrawal previews and freeze lifts</li><li>prompt-injection records</li><li>a broken audit chain</li></ul> Summaries carry counts and action names only: no IPs, tokens or bodies. |
| Containment | `guardian/response.ts` | Allowlist of exactly one action: **pause new orders**. It runs automatically only with `MIA_GUARDIAN_AUTOPAUSE=1`, once per piece of evidence, and is audited as `security.guardian.pause`. Exits stay protected and only the owner resumes. It never imports the OMS, wallet or any network client. |
| Posture | `guardian/posture.ts` | Seven layers. Anything not measurable from inside the app reads **NOT_VERIFIED / NOT_CONFIGURED, never green**. |
| Dashboard | Security Center → **Guardian Shield** | P0–P3 counts, events with evidence ids, the seven layers, and a manual *Pause new orders* button when auto-pause is off. |
| API | `GET /api/security/guardian` (owner session) | The report above; `authority` is always all `false`. |

**Fixes found during the P0 audit:**
- Log redaction now also covers `otp`, `accessToken`, `consoleCode`, `setupCode` and `authorization` (the Privy and authenticator fields were missing).
- Security Center check AUTH-1 showed **FAIL** ("no owner passphrase") in Privy mode. It now reports the bound Privy owner.

## Tests (`server/test/guardian.test.ts`, 19)

- Severity rules; quarantine of future, stale and unprovenanced events; frozen, zero-authority results.
- Detection thresholds: a mutation check confirmed the sign-in burst test fails if the threshold changes. A first authenticator enrollment does not alert.
- A tampered audit row produces an AUDIT_CHAIN_BROKEN P0.
- Auto-pause is off by default. When on, it pauses only: no emergency, no mode change, and no re-pause after the owner resumes. Its source cannot resume, change mode, or reach orders, wallets or the network.
- **GUARD-021/096:** Joe, knowledge, research, prediction and Guardian code touch the order system and wallet only through an allowlist. Joe may call `pauseNewOrders` and the read-only `listPositions`; Guardian may read `withdrawalFrozen`.
- **GUARD-049:** Trader Joe's tools are only read/analyse tools plus the risk-reducing pause.
- **GUARD-006:** forged `X-Forwarded-For` headers cannot dodge the sign-in limiter. **GUARD-007:** a body over 256 KB gets 413.
- **GUARD-050/082:** a canary secret sent with a failed step-up appears in neither the audit log nor Guardian output.

## Gap matrix (the 100 tickets, deduplicated against what MIA already has)

The tickets are **proposals, not observed vulnerabilities**.

| Layer | Already in MIA (before this slice) | Added now | Pending (needs) |
|---|---|---|---|
| 1 Edge (001–010) | 256 KB body limit; proxy headers not trusted; loopback default | Tests for 006 and 007; posture shows edge as NOT_VERIFIED | 001–005, 008–010: managed DDoS/WAF or CRS ingress, private origin, ingress timeouts. **Needs the owner's host/DNS access.** |
| 2 Identity (011–020) | Server-verified Privy, bound owner, single-use TOTP step-up, CSRF, revocable HttpOnly sessions, shared brute-force limiter (PR #38) | Identity-change and step-up-burst detection | 015 device enrollment, 018 recovery cooldown, 019 dual approval |
| 3 App & agent (021–050) | Fail-closed mode gate (#18); Joe fixed tool list; untrusted content treated as data; research `RESEARCH_ONLY` | Boundary tests for 021, 049 and 096; secret-canary test for 050/082 | 041–048 tracing prompt injection end-to-end in Joe and knowledge ingestion (detector + audit action `*.injection`) |
| 4 Money (021–040) | Live locked; no signer, no keys (G07/G12 NOT_IMPLEMENTED); withdrawals preview-only plus freeze; risk gate | Mode-change and signer-action detection; withdrawal-attempt events | 023–040 transaction firewall and wallet policy: **phase P6, only before any Live work** |
| 5 Host (061–070) | Container detection, systemd unit | Posture shows host as NOT_VERIFIED | Falco or Wazuh, egress allowlist, rootless runtime: **host-dependent** |
| 6 Incident (071–090) | Persistent protection incidents; audit trail | Guardian rules, P0–P3, opt-in containment, dashboard | 072/074 venue-balance and API-key telemetry (Live only); 097 out-of-band alerts (Telegram exists, not yet wired to Guardian) |
| 7 Recovery (091–100) | Local SHA-256 audit chain; optional AES-256-GCM backups with restore verification | Chain-break P0; backup encryption visible in posture | 083 remote immutable anchors; 069/093 offsite backups and restore drills |
| CI / supply chain (051–060) | `permissions: contents: read`; npm audit (high); local secret scan | — | 052/054: **pin every Action to a full commit SHA**. CI uses floating `@v4` tags today (`actions/checkout`, `setup-node`, `upload-artifact`). Add Gitleaks, OSV and zizmor jobs pinned by SHA after verifying source and advisories. The SHAs could not be resolved from the build sandbox, so none were guessed. |

## Incident runbooks (owner-supplied, adapted to MIA's controls)

Severity levels:
- **P0:** credential compromise, a signer request, theft, a compromised build, an unknown live order, or a broken audit chain.
- **P1:** identity replaced, step-up guessing, abnormal allowances, malware.
- **P2:** sign-in bursts, withdrawal previews, low-confidence suspicious input.
- **P3:** routine noise.

For P0, stop new risk through MIA's own Pause (Risk Center, command palette, Trader Joe, or Guardian auto-pause), keep exits protected, and contact the owner out of band.

- **Account takeover:** Security Center → *Sign out all other sessions* (step-up). On the server:
  - `npm run owner -- bind-privy <did> --replace` ends every session;
  - `npm run owner -- reset-2fa` resets the authenticator.

  Never approve recovery from the session you suspect.
- **Unexpected allowance / wallet drainer:** MIA holds no keys and never signs. Revoke approvals with official tooling from a clean device. Never use "rescue contracts" or automatic sweepers.
- **CEX key leak:** MIA's research adapters are keyless. If a venue key exists elsewhere, disable it at the exchange and reconcile before restoring.
- **DDoS:** mitigate upstream. Never expose the origin as a shortcut. The trading loop runs inside the server process, separate from page rendering.
- **Prompt injection:** quarantine the source document or post. Its text has no authority in MIA, and Joe has no privileged tools.
- **Malware or host intrusion:** isolate the host, preserve a hashed snapshot, rebuild from a known-good build, and verify the audit chain and ledger. No hack-back.
- **Supply chain:** stop CI, revoke tokens, and rebuild from pinned sources.
- **Audit-chain break (P0):** treat local records as possibly forged. Compare them with backups and venue statements, and restore from a verified backup (`npm run backup -- verify <file>`).
- **Recovery:** only the owner restores privileges, then returns to Paper step by step. Nothing unpauses or re-enables Live automatically.

## Approval boundary

This slice used no live credentials, changed no DNS or edge settings, revoked no sessions, deployed no agents and enabled no financial signing. The owner's approval is needed for each of the following:
- turning on `MIA_GUARDIAN_AUTOPAUSE=1`;
- adding pinned CI scanners;
- configuring an edge or WAF;
- deploying host monitoring.
