# Operations Runbook

## Deploy
- Single process: `npm run build && npm start`. Bind to loopback (`MIA_HOST=127.0.0.1`) and front it with a TLS reverse proxy
  if you expose it remotely. The session cookie is `HttpOnly; SameSite=Strict`; state-changing requests require the
  `x-mia-csrf` header.
- Secrets only via environment variables (`.env.example`). They never reach the browser, logs (redacted), or LLM prompts.

## Backup & restore
- Data lives in `$MIA_DATA_DIR/mia.db` (SQLite WAL). Back up with `sqlite3 data/mia.db ".backup data/backup-$(date +%F).db"`
  while running. Restore by stopping the server and replacing `mia.db` (delete `-wal`/`-shm`).
- Migrations are append-only (`server/src/db/migrations.ts`). Roll back code by redeploying the previous commit together
  with a pre-upgrade backup.

## Incidents
| Signal | Meaning | Response |
|---|---|---|
| Red "stale data" banner | ticker feed > 60 s old | New entries auto-blocked by the data-quality gate. Check Connections Hub. |
| CRITICAL "Protection unverified" | an open position has no fresh price | Risk Center → Verify/protect. Consider Close if the venue is unreliable. |
| Daily/weekly/drawdown breaker | loss limit reached | Entries blocked until the next boundary or review. Do not raise limits to bypass. |
| Strategy auto-suspended | paper expectancy decayed | Review in Strategy Lab; re-promote only after revalidation. |
| Audit gate FAIL | hash chain broken | Treat as tampering: stop the server, preserve the DB, investigate. |

Emergency actions (Risk Center) are distinct: pause new orders · cancel pending entries · verify protection ·
emergency stop (pause + cancel + verify, **no auto-close**) · close all (step-up + typed confirmation).

## Going live (not available in this build)
Requires every gate on the Release Gates page: 30-day paper evaluation, independent security review, an isolated signer
and transaction firewall (Part 24), a live venue adapter, the Independent Release Auditor sign-off, then explicit owner
authorization.
