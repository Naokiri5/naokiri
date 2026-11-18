# Deployment & Operations Guide

## Deploy
- Build before deployment: `npm ci && npm run build`. This builds `web/dist` and compiles the server into `server/dist`.
- Start the compiled server with `NODE_ENV=production npm start`. Production startup requires both build outputs and does not depend on dev-only `tsx`/Vite packages. Local development can use `npm start` after `npm install`; the launcher falls back to `tsx` when no production build exists. Default bind is loopback on a desktop and `0.0.0.0` inside detected
  containers so forwarded ports work; override with `MIA_HOST`. Front it with a TLS reverse proxy if you expose it remotely.
- Paths (`data/`, `web/dist`) resolve from the repository location, not the shell's working directory. The session cookie is `HttpOnly; SameSite=Strict` and gains `Secure` only when `MIA_SECURE_COOKIE=1` (set it explicitly whenever MIA is served over HTTPS; `NODE_ENV` does not enable it); state-changing requests require the
  `x-mia-csrf` header.
- Secrets only via environment variables (`.env.example`). They never reach the browser, logs (redacted), or LLM prompts.

## Backup & restore
- The existing `npm run backup -- create|verify <file>|list` CLI uses the same `server/src/ops/backup.ts` implementation
  as the leader's scheduled backups (`MIA_BACKUP_INTERVAL_H`, default 24 hours; `MIA_BACKUP_KEEP`, default 14).
  Scheduled runs verify immediately. The latest failed snapshot is kept and its failure is recorded. Retention runs
  after every creation, keeping the newest N plus the last verified good configured backup (at most N+1 snapshots), so
  persistent failures cannot grow storage without limit. CLI `create` and `verify` also persist the latest result in `settings`.
- CLI `verify` records into `$MIA_DATA_DIR/mia.db`, opening/creating and migrating that database if needed. When
  verifying an off-site copy on a recovery machine, use a separate `MIA_DATA_DIR` for this verification record. It
  replaces the latest status even for files outside `MIA_BACKUP_DIR`, but does not change which local good backup
  retention protects. The `verifyBackup` library function itself remains read-only.
- Security Center's **DATA-3** check and authenticated `GET /api/security` (`backup.lastVerify`) expose that result,
  including ledger reconciliation on the snapshot. Missing/deleted snapshots warn, failed verification fails, and
  either a snapshot or verification older than twice the interval (capped at seven days) warns. With scheduling
  disabled, the freshness window is 48 hours. Rechecking an old snapshot does not make its creation date recent.
- With `MIA_BACKUP_KEY` set, snapshot/decryption plaintext uses a private 0700 OS temporary directory, cleaned on
  success and failure; only ciphertext is written into the backup directory. The existing MIAB1 format and hex/base64
  key support are unchanged. The OS temp area (`TMPDIR` on Unix) needs space for a full plaintext database copy.
  Keep the encryption key and `data/evidence.key` separately; SQLite snapshots do not
  include either key or Academy source-document files outside the database.
- Data lives in `$MIA_DATA_DIR/mia.db` (SQLite WAL). Back up with `sqlite3 data/mia.db ".backup data/backup-$(date +%F).db"`
  while running. Restore by stopping the server and replacing `mia.db` (delete `-wal`/`-shm`).
- Migrations are append-only (`server/src/db/migrations.ts`). Roll back code by redeploying the previous commit together
  with a pre-upgrade backup.

## Incidents
| Signal | Meaning | Response |
|---|---|---|
| Red "stale data" banner | ticker feed > 60 s old | New entries auto-blocked by the data-quality gate. Check Connections Hub. |
| CRITICAL "Engine stopped: integrity check failed" | a takeover found a failed check (quick_check, schema, audit or decision-memory chain, ledger reconcile, protective stops); the engine released its lease and stopped, `/api/ready` stays 503 | Read the failed checks in the journal entry and `lastError` on the Autopilot page. Preserve the database and investigate before restarting; restarting alone re-runs the same checks and alerts again. |
| `/api/ready` check `monitor` failing | the leader's last position-monitor pass threw, or none completed within three ticker intervals | Open positions are not being evaluated. Check `lastError`, then Risk Center → Verify/protect. |
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
