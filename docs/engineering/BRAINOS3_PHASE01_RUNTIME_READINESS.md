# MIA BrainOS 3.0 — Phase 01: consolidation and runtime readiness (2026-11-26)

## 1. Pull-request consolidation

| PR | Finding | Recommendation |
|---|---|---|
| #140 `naokiri/jolly-wozniak-8q7ial` → `main` | Contains every #137 commit (#137 head `c085934` is an ancestor) plus reconciliation fixes, the session simulator, migration 8 (reconciliation indexes), sequenced telemetry, the Guardian Shield fixes and this phase. GitHub Actions on `55faff1`: unit/typecheck/audit/secret scan **success**, Playwright **success**; Cloudflare Workers build fails (external, shared with #137). | Treat #140 as the single release candidate. Close #137 only when #140 merges. |
| #137 `codex/brainos-paper-session` | Superseded by #140. | Keep open until #140 merges. |
| #141 `ci/railway-manual-deploy` | Only `.github/workflows/ci.yml`: adds a `workflow_dispatch` Railway job gated on `main`, the existing checks, the `production` environment and an explicit boolean. It installs `@railway/cli` without a version pin while holding `RAILWAY_TOKEN`. | Pin the CLI to an exact version (and preferably the actions to commit SHAs) before merging. Merge after #140. |
| #138 | Landing page and Railway hosting draft from an older base. | Reconcile against #140 before merging; do not merge independently. |

## 2. Railway production — verified read-only (Railway API)

| Item | Observed |
|---|---|
| Project and service | `mia-privy-preview` / `mia-web-api`, production, one replica (iad), domain `www.miaai.trade` → port 8787 |
| Build | Railpack, `npm run build` |
| Start command | **A maintenance server**: prints a storage inventory and answers `/railway-maintenance-health`. BrainOS is not running. |
| Volume | `mia-persistent-data`, **500 MB**, mounted at `/data` |
| Contents at last start (23 Nov) | `mia.db` 362 MB, `mia.db-wal` 4.4 MB, `evidence.key`; `/data/backups`: one verified backup from 22 Nov (0.57 MB plus manifest), one unrecognized 77 MB file and nine small unrecognized files. **≈445 MB used, ≈89%.** |
| Variables (names only) | `MIA_AUTH_MODE`, `MIA_DATA_DIR`, `MIA_HOST`, `MIA_PORT`, `MIA_PRIVY_APP_ID`, `MIA_PRIVY_OWNER_ID`, `MIA_SECURE_COOKIE`, `NODE_ENV`, `PORT`, Railpack settings. **No `MIA_BACKUP_KEY`**, which production backups require. |
| Pending | One staged environment patch with no changes (25 Nov). |

## 3. Root cause of the database growth

Measured with the fixture instrument:
- **Consensus record:** 65.7 KB. Every QCI run stored all 94 worker packets.
- **Compacted record (no packets):** 3.1 KB.
- **Decision report:** 11.0 KB.

No code ever deleted or compacted `consensus_records`, `decisions`, `journal`, `notifications` or DITAS snapshots. At the default 60-second scan this adds hundreds of MB per day, which matches the database growing from about 0.6 MB (22 Nov backup) to 362 MB. The next scheduled backup would copy the whole database onto the same volume and fill it. SQLite then rejects writes, including fills, settlements and stop updates.

## 4. Fixes in this phase

- **Storage guard** (`ops/storage.ts`): the volume's free space is classified as OK, LOW (< max(15%, 75 MB)) or CRITICAL (< max(5%, 25 MB)).
  - CRITICAL or unreadable makes the canonical risk gate deny new exposure (`STORAGE_CRITICAL`, `STORAGE_UNKNOWN`). Protection keeps running.
  - `/api/ready` reports a failing `storage` check.
  - Scheduled backups refuse to start unless 1.1× the database size plus the critical reserve is free. The existing hourly backup alert reports it.
- **Consensus retention** (`qci/retention.ts`): records older than `MIA_CONSENSUS_DETAIL_HOURS` (default 24 h) whose decision never produced an order lose their per-worker packet list.
  - Their summary is kept: state, domains, vetoes and counts, plus `packetsCompactedAt`.
  - Records linked to any order keep their packets permanently.
  - It runs in batches of 200 on the leader's background lane, using a durable watermark and migration 9 (`created_at` index).
  - Trading logic never reads stored packets, and the explanation view already handles their absence.

This reduces growth by about 82% per candidate. **It does not shrink the existing file.** SQLite reuses freed pages, but returning space to the volume needs `VACUUM`, which needs about as much free space as the database.

## 5. Owner actions before restoring the BrainOS runtime (in order)

1. Increase the Railway volume (for example to 5 GB) so the database, WAL and at least one backup fit with headroom.
2. Set `MIA_BACKUP_KEY` (and keep `evidence.key` or set `MIA_EVIDENCE_KEY`) as sealed variables.
3. Identify the unrecognized 77 MB file in `/data/backups` before deleting anything; take an off-volume copy of `mia.db` first.
4. Deploy #140 with the normal start command, so migrations 7–9 run, then let retention catch up. Confirm `/api/ready` reports storage `pass`.
5. Optionally run `VACUUM` once enough space is free, to reclaim the compacted pages.

## 6. Notes for Phase 02 (multi-user)

The live stream journal (`core/telemetry.ts`) and every REST view are **single-owner today**: all authenticated sessions are the owner, so replayed events are not user-scoped. Multi-user support must scope the journal and every account, order, position and session table to a verified user before a second user can sign in.

Individual custodial wallets, deposits and withdrawals for other users also change MIA's regulatory position (custody and money transmission). That decision belongs to the owner, with legal review, before building it.
