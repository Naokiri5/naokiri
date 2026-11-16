# Security — Audit & Controls

Phase 0 audit · 2026-11-16 · commit `ce655bd`

## Findings (most severe first)

| ID | Severity | Finding | Evidence | Proposed fix (phase) |
|---|---|---|---|---|
| SEC-01 | **High** | `@fastify/static@8.3.0` (serves the web UI) has published path-traversal and route-guard-bypass advisories. Two moderate transitive issues (`glob`, `minimatch`) come with it. | `npm audit`: 1 high, 2 moderate | Upgrade to `@fastify/static@10.x` and retest static serving (Phase 1). |
| SEC-02 | Medium | No rate limiting on the API apart from login lockout (5 attempts → 60 s). An authenticated client could hammer expensive endpoints (`/api/analyze`, `/api/lab/backtest`). | `api/routes.ts` | Per-route rate limits (Phase 7). |
| SEC-03 | Medium | Inside containers the server binds `0.0.0.0` so forwarded ports work, which also exposes the login page on that network. All APIs still require the owner session. There is no TLS. | `config.ts#inContainer` | Document a TLS reverse proxy; add an `MIA_ALLOWED_ORIGINS`/host check (Phase 8). |
| SEC-04 | Medium | The SQLite database (`data/mia.db`) is not encrypted at rest. It holds the scrypt password hash, audit log, address book and paper ledger. It holds no API keys or private keys. | `db/db.ts` | File-permission hardening + backup encryption guidance (Phase 7/8). |
| SEC-05 | Low | The evidence-packet HMAC key is random per process unless `MIA_EVIDENCE_KEY` is set, so packets stored before a restart can't be re-verified afterwards. | `config.ts` | Persist a generated key with 0600 permissions (Phase 7). |
| SEC-06 | Low | No security headers test; CSP allows `'unsafe-inline'` styles (needed by the chart library). | `index.ts` | Add header tests; tighten CSP where possible (Phase 7). |
| SEC-07 | Info | No CI pipeline, so dependency and secret scanning only happen when someone runs them. | — | GitHub Actions: tests + `npm audit` + secret scan (Phase 1). |

## Checks that passed

| Control | Result |
|---|---|
| Secrets committed to git | **None found.** Tracked files scanned for API-key, token and private-key patterns. |
| Placeholder or fake data in code | **None found** (scan for mock/fake/placeholder/`Math.random` in runtime code). |
| Seed phrases / private keys | Never requested or stored; no signer exists. |
| Owner authentication | scrypt hash, timing-safe compare, `HttpOnly; SameSite=Strict` session cookie, 12 h expiry, login lockout. |
| CSRF | State-changing requests require the `x-mia-csrf` header. |
| Step-up authentication | Required for risk-policy changes, mode changes, clearing emergency, close-all, address verification, withdrawal preview and lifting the withdrawal freeze. |
| AI and worker boundaries | Workers return signed, schema-validated evidence only. Trader Joe's tool set contains no order, limit, mode, funding or withdrawal tool (enforced by a test). |
| Independent risk engine | Deterministic; any exception or missing input returns DENY. Covered by tests. |
| Live trading | No live venue adapter or signer exists; `BOUNDED_LIVE` is refused by the release gates (tested). |
| Withdrawals | Stop at a validated preview marked `BLOCKED_BY_RELEASE_GATE`. Emergency freeze exists. |
| Audit log | Append-only and hash-chained; integrity is verified on the Release Gates page. |
| Untrusted content | News, token metadata and market data are treated as data; Trader Joe's system prompt says so and his tools cannot act on it. |

## Rules that stay in force for every phase
No seed-phrase collection · no private keys exposed to AI or workers · no secrets in git · no unauthorized or automatic
transactions or withdrawals · no bypassing the risk engine · no live trading during development · no fabricated
integrations, balances or PnL · live trading needs its own explicit authorization after all release gates pass.
