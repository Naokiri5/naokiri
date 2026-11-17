# Security — Audit & Controls

Phase 0 audit · 2026-11-16 · commit `ce655bd`

## Findings (most severe first)

| ID | Severity | Finding | Evidence | Proposed fix (phase) |
|---|---|---|---|---|
| SEC-01 | ~~High~~ **RESOLVED (Phase 1)** | `@fastify/static@8.3.0` (serves the web UI) has published path-traversal and route-guard-bypass advisories. Two moderate transitive issues (`glob`, `minimatch`) come with it. | `npm audit`: 1 high, 2 moderate | Upgraded to 10.1.11; `npm audit`: 0 vulnerabilities; path-traversal regression tests in `static.test.ts`. |
| SEC-02 | ~~Medium~~ **RESOLVED (repair branch)** | No rate limiting on the API apart from login lockout; step-up and passphrase change had no attempt limit at all. | `api/routes.ts`, `api/auth.ts` | `core/ratelimit.ts`: login, step-up and passphrase change share one limit (5 per client, then 1 min doubling to 1 h; 20 per server per 15 min) and answer 429 + `Retry-After`. Per-session limits on Trader Joe (10/min), backtests (6/min), analysis (30/min), new instrument loads (60/min), news refresh (4/min). |
| SEC-03 | Medium | Inside containers the server binds `0.0.0.0` so forwarded ports work, which also exposes the login page on that network. All APIs still require the owner session. There is no TLS. | `config.ts#inContainer` | Document a TLS reverse proxy; add an `MIA_ALLOWED_ORIGINS`/host check (Phase 8). |
| SEC-04 | Medium | The SQLite database (`data/mia.db`) is not encrypted at rest. It holds the scrypt password hash, audit log, address book and paper ledger. It holds no API keys or private keys. | `db/db.ts` | File-permission hardening + backup encryption guidance (Phase 7/8). |
| SEC-05 | ~~Low~~ **RESOLVED (repair branch)** | The evidence-packet HMAC key was random per process, and a non-hex `MIA_EVIDENCE_KEY` silently became an **empty** (forgeable) key. | `config.ts` | Key loaded from `MIA_EVIDENCE_KEY` (validated: ≥ 64 hex chars) or `data/evidence.key`, generated once with mode 0600. Back it up with the database. |
| SEC-06 | Low (partly resolved) | CSP allows `'unsafe-inline'` styles (needed by the chart library). | `index.ts` | Added `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action` and `cache-control: no-store` on all API responses, with tests. `'unsafe-inline'` styles remain. |
| SEC-07 | ~~Info~~ **RESOLVED (Phase 1)** | No CI pipeline. | — | `.github/workflows/ci.yml`: secret scan, `npm audit --audit-level=high`, typecheck, unit + browser tests on every push/PR. |
| SEC-08 | Low | CSV export could carry spreadsheet formulas from stored text. | `journal/history.ts` | **Fixed in Phase 1** before release (cells starting with = + - @ are neutralised; tested). |
| SEC-09 | ~~Critical~~ **RESOLVED (repair branch)** | The auth/CSRF gate tested the raw URL, but the router percent-decodes the path, so `/%61pi/audit` reached `/api/audit` with no session (and `POST /%61pi/emergency/stop` with no CSRF check). | `api/routes.ts` onRequest hook | The gate now decides on the matched route (`req.routeOptions.url`); regression test in `api.test.ts`. |
| SEC-10 | ~~High~~ **RESOLVED (repair branch)** | Withdrawal preview copied the whole request body, **including the step-up passphrase**, into the audit log, which `/api/audit` returns. | `wallet/wallet.ts`, `api/routes.ts` | The passphrase is split off before the call and the audit entry lists named fields only (tested). **If you ever ran a withdrawal preview, change your passphrase**: existing audit rows can't be scrubbed without breaking the hash chain. |
| SEC-11 | Medium **RESOLVED (repair branch)** | Every error, including crashes and database faults, was returned as HTTP 400 with its internal message and was never logged. | `api/routes.ts` error handler | 400 validation · 401/403/404/409/429 typed errors · 502/503 provider failures · 500 for server faults (logged with request id, generic message to the client). |
| SEC-12 | Medium **RESOLVED (repair branch)** | Resuming after a pause and re-enabling strategies needed only a session; first-time setup was open to any client on a `0.0.0.0` bind. | `api/routes.ts` | Both now need step-up. Setup was accepted from loopback or a detected container/port-forwarder, or with `MIA_ALLOW_REMOTE_SETUP=1`. **Superseded by SEC-13.** |

| SEC-13 | High **FIXED (review branch, 2026-11-17)** | A detected container still opened first-run setup to any remote visitor. Reproduced: a remote IP claimed the owner with HTTP 200, and so did any client in this cloud session. | `api/routes.ts`, `api/auth.ts`, `main.ts`, `web/src/App.tsx` | Only a direct loopback connection with no `X-Forwarded-*`/`Forwarded`/`X-Real-IP` header, or `MIA_ALLOW_REMOTE_SETUP=1`, opens setup without a code. Everyone else must enter a one-time ~100-bit code printed to the server console. The code is compared in constant time, discarded after setup, and rejections are audited. Tests: `server/test/auth-setup.test.ts` (fails on the old code), `e2e/auth.spec.ts`. |
| SEC-14 | High **OPEN: owner decision** | Twenty failed passphrase attempts from any mix of addresses lock **every** client out for 15 min: owner login, and step-up actions such as close-all. Reproduced (429 for the correct passphrase). Emergency stop still works for an existing session. | `core/ratelimit.ts`, `api/auth.ts` | Options and trade-offs are in `docs/engineering/DEBUG_AUDIT_2026-11-17.md`. Authentication policy is not changed without owner approval. |

## Checks that passed

| Control | Result |
|---|---|
| Secrets committed to git | **None found.** Tracked files scanned for API-key, token and private-key patterns. |
| Placeholder or fake data in code | **None found** (scan for mock/fake/placeholder/`Math.random` in runtime code). |
| Seed phrases / private keys | Never requested or stored; no signer exists. |
| Owner authentication | scrypt hash, timing-safe compare, `HttpOnly; SameSite=Strict` session cookie (`Secure` with `MIA_SECURE_COOKIE=1`), 12 h expiry, expired sessions purged at login, shared login/step-up lockout. Live event streams close when their session ends. |
| CSRF | State-changing requests require the `x-mia-csrf` header. |
| Step-up authentication | Required for risk-policy changes, mode changes, clearing emergency, resuming new orders (including redundant resume requests), re-enabling a disabled strategy, promotion into PAPER or a LIVE_CANDIDATE attempt, quarantine release, close-all, address verification, withdrawal preview and lifting the withdrawal freeze. LIVE_CANDIDATE remains blocked even with the correct passphrase. Suspension, demotion and pausing require only the owner session. |
| AI and worker boundaries | Workers return signed, schema-validated evidence only. Trader Joe's tool set contains no order, limit, mode, funding or withdrawal tool (enforced by a test). |
| Independent risk engine | Deterministic; any exception or missing input returns DENY. Covered by tests. |
| Live trading | No live venue adapter or signer exists; `BOUNDED_LIVE` is refused by the release gates (tested). |
| Withdrawals | Stop at a validated preview marked `BLOCKED_BY_RELEASE_GATE`. Emergency freeze exists. |
| Audit log | Append-only and hash-chained; integrity is verified on the Release Gates page. |
| Test-derived release gates | `server/src/qa/gates.ts` names exact source files and Vitest fullNames. Missing sources, missing/non-passed assertions, malformed reports or any failed test/suite keep the gate PENDING. Record evidence with `npm run qa -w server`; offline live-provider checks remain skipped/PENDING. G01 cannot certify browser workflows, G03 has untested on-chain/health coverage, and G04 cannot certify LLM factuality, so those gates remain PENDING. Report freshness and source-revision attestation are not implemented. |
| Untrusted content | News, token metadata and market data are treated as data; Trader Joe's system prompt says so and his tools cannot act on it. |

## Rules that stay in force for every phase
No seed-phrase collection · no private keys exposed to AI or workers · no secrets in git · no unauthorized or automatic
transactions or withdrawals · no bypassing the risk engine · no live trading during development · no fabricated
integrations, balances or PnL · live trading needs its own explicit authorization after all release gates pass.
