# MIA 4.1 — Multi-market Intelligence & Paper-Trading Terminal

MIA scans live crypto markets, evaluates opportunities with **100 deterministic market workers**
and **50 indicator specialists** coordinated by **Quantum Consensus Intelligence (QCI)**, routes every
candidate through a central **decision engine** and a **fail-closed deterministic risk engine**, and
executes **paper trades against live order books**. Built from the MIA 4.1 Unified Master Prompt
(Parts 1–33).

> "Quantum" is a product metaphor for bounded parallel analysis. No quantum hardware or algorithms are used.
> MIA never promises profit; scores and consensus are evidence summaries, not win probabilities.

## Status at a glance

| Area | State |
|---|---|
| Live market data (Binance public mirror, Coinbase, Kraken, CoinGecko, DEX Screener, ECB FX, Google News) | **Working, verified live** |
| Scanner → 100-worker QCI → decision engine → risk gate | **Working on live data** |
| Paper OMS (live book-walk fills, fees, OMS-monitored stops, partial TP, trailing, time stops) | **Working**, verified with a real BTC round trip |
| Strategy Lab (walk-forward backtests on real history, Monte Carlo) | **Working** |
| Risk Center, emergency controls, Bot Account, Portfolio, Journal, Profit Calendar | **Working** |
| Asset Discovery, QHEF Performance, Security Center, Trading History, command palette (Ctrl/⌘+K) | **Working** (Phase 1) |
| Trader Joe | **Command mode working**; Claude conversational mode needs `ANTHROPIC_API_KEY` (not exercised in this build environment) |
| Wallet & Withdrawals | Address book, EIP-55/format validation, guided preview, freeze. **Submission blocked by release gate** (no signer, by design) |
| Equities, commodities, on-chain wallets/holders, copy trading, X, Telegram sources | **Pending credentials/licenses**: adapters registered and shown honestly; no simulated data |
| Real-money trading | **LOCKED.** No live venue adapter or signer exists. Mode `BOUNDED_LIVE` is refused by the release gates |

## Quick start

Requirements: **Node.js ≥ 22.16** (uses the built-in `node:sqlite` backup API; `.nvmrc` pins 22), npm, outbound HTTPS to the hosts in
`docs/API_INTEGRATIONS.md`. Works on macOS, Linux and Windows (cmd/PowerShell); all scripts are cross-platform.

```bash
npm install
npm start              # builds the UI on first run if needed, then serves API + UI on port 8787
```

Open **http://localhost:8787/**. The terminal prints the exact URLs:

```
  ➜ Local:     http://localhost:8787/
  ➜ Network:   http://<container-ip>:8787/      (only when bound to all interfaces)
```

Then create the **owner passphrase**, and:

1. **Risk Center**: review and accept the risk policy (step-up passphrase).
2. **Strategy Lab**: run backtests, then **promote** a strategy to PAPER only if you accept its out-of-sample record.
3. **Bot Account**: allocate paper capital and switch the mode to **Paper** (or **Approval** to confirm each order).

Development with hot reload: `npm run dev` starts the backend (8787) and Vite (http://localhost:5173/, proxies `/api`).

### Host binding and forwarded ports

| Where you run MIA | Default bind | Open |
|---|---|---|
| Your own computer | `127.0.0.1` (not exposed to your network) | http://localhost:8787/ |
| Docker, dev container, Codespaces, Gitpod, Claude Code cloud session | `0.0.0.0` (auto-detected) | the forwarded URL for port **8787** |
| WSL2, a VM, or another device on your LAN | set `MIA_HOST=0.0.0.0` | `http://<machine-ip>:8787/` |

`MIA_HOST` and `MIA_PORT` always override the defaults. Binding `0.0.0.0` exposes the login page to the network; MIA
requires the owner passphrase for every API call, but put it behind TLS before exposing it beyond a trusted network.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `✖ Port 8787 is already in use` | another MIA instance or program | stop it, or `MIA_PORT=8788 npm start` (PowerShell: `$env:MIA_PORT=8788; npm start`) |
| Browser shows "connection refused" via a forwarded port | server bound to loopback only | `MIA_HOST=0.0.0.0 npm start` |
| Page says "MIA API is running … UI not built" | `web/dist` missing | `npm run build` |
| `✖ MIA requires Node.js 22.16 or newer` | old Node | install Node 22.16+ (`nvm use`) |
| `✖ Dependencies are not installed` | skipped `npm install` | run `npm install` in the repository root |
| Market data never loads behind a corporate proxy | proxy env | set `HTTPS_PROXY`; the launcher enables `NODE_USE_ENV_PROXY` for Node's fetch |

## Tests & QA evidence

```bash
npm test                         # 54 unit/integration tests (offline, deterministic)
npm run test:e2e                 # 32 browser checks (Playwright, offline server, all 25 pages)
npm run test:live -w server      # opt-in: real providers + real-order-book paper round trip (network)
npm run qa -w server             # records evidence used by the Release Gates page
npm run scan:secrets             # fails if a key/token/private key is in a tracked file
```

CI (`.github/workflows/ci.yml`) runs the secret scan, `npm audit`, typecheck, unit tests and the browser suite on every push
and pull request.

## Backups and restore

**Security Center → Backups** shows retained snapshots and their restore-test results. **Back up now** takes a
consistent snapshot of the full SQLite database, including settings, owner authentication and sessions, the paper
ledger, and the audit log. It does not back up environment variables, encryption keys, or files outside SQLite.

| Environment variable | Default | Purpose |
|---|---|---|
| `MIA_BACKUP_DIR` | `backups` under `MIA_DATA_DIR` (`data/backups` by default) | Snapshot files and manifests |
| `MIA_BACKUP_INTERVAL_MS` | `21600000` (6 hours) | Automatic backup interval; `0` or a negative value disables the scheduler, not manual backups |
| `MIA_BACKUP_KEEP` | `14` | Number of completed backups retained |
| `MIA_BACKUP_KEY` | unset | Optional 64-hex-character key for AES-256-GCM encryption at rest |

The owner can generate a key with `openssl rand -hex 32`, then supply it through the server's environment. Keep it
in a password manager or another secure offline location, separate from the backups. Never put it in Git, logs, or
chat. **Lose the key and you lose its encrypted backups.** Keep old keys when rotating: each existing snapshot still
needs the key used to create it. Without a key, snapshots are plaintext and contain sensitive authentication data.

The default directory is on the same disk as the database. It helps with a bad change, not a lost disk or host.
Set `MIA_BACKUP_DIR` to a directory on another disk for disk-failure protection. Also copy completed snapshots and
their manifests to independent off-host storage for host-failure protection, and keep the encryption key separately.

### Recover into a new data directory

1. **Verify while the existing MIA instance is still running.** Select a snapshot from `GET /api/backups` (or create
   one with **Back up now**), keep its manifest, and compare the snapshot file's SHA-256 with the manifest's
   `checksum` (`sha256sum FILE`, `shasum -a 256 FILE` on macOS, or `Get-FileHash FILE -Algorithm SHA256` in
   PowerShell); the manifest prefixes the hex digest with `sha256:`. Click **Run restore test** for that latest
   snapshot; an older retained snapshot can be tested with authenticated `POST /api/backups/:id/restore-test`.
   Require a passing result for SQLite integrity, schema,
   audit-chain verification, and paper-ledger reconciliation. An HTTP success alone is not enough: `restoreTest.ok`
   must be `true`. The test opens a temporary database; it never replaces the running one.
2. **Stop MIA before switching databases.** Keep the original data directory untouched so you can roll back. The
   verification step comes first because the restore-test endpoint needs the server running; recovery copying does
   not. If the original server cannot run, verify the checksum and perform those checks in an isolated MIA instance
   before using the snapshot for recovery.
3. If the snapshot is encrypted, decrypt it **offline** with its original `MIA_BACKUP_KEY`: the `MIABAK1` envelope
   uses AES-256-GCM. Require successful authentication-tag verification before accepting the plaintext SQLite file.
   Do not rename ciphertext to `mia.db`, and do not try `openssl enc` (it does not support this GCM envelope).
   For an unencrypted snapshot, the verified snapshot is already the plaintext SQLite database. Protect any plaintext
   working copy and remove it securely when it is no longer needed.
4. Create a **new, empty directory** and copy the verified plaintext database into it as **`mia.db`**. Do not copy
   old `mia.db-wal` or `mia.db-shm` files into that directory. Set `MIA_DATA_DIR` to its absolute path, then start MIA
   and check the recovered settings, paper ledger, audit log, and Security Center. Keep the old directory until you
   have verified recovery.

**Never overwrite a running database.** There is no restore, delete, or download route. The API only lists backups,
creates them (`POST /api/backups`), and runs isolated restore tests; recovery and file custody are operator actions.

For step 3, save this offline helper as `decrypt-backup.mjs` outside the repository. With MIA stopped and the
original key supplied securely in `MIA_BACKUP_KEY`, run `node decrypt-backup.mjs SNAPSHOT MANIFEST NEW_DIR/mia.db`.
Create `NEW_DIR` first. The helper checks the stored-file checksum and GCM tag, and refuses to overwrite a file.
The envelope is 8 bytes `MIABAK1\0`, a 12-byte nonce, ciphertext, then a 16-byte authentication tag.

```js
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [snapshot, manifest, output] = process.argv.slice(2);
const m = JSON.parse(readFileSync(manifest, 'utf8'));
const stored = readFileSync(snapshot);
const checksum = `sha256:${createHash('sha256').update(stored).digest('hex')}`;
if (checksum !== m.checksum || stored.length !== m.bytes) throw new Error('Checksum or size mismatch');
if (!m.encrypted || stored.length < 36 || !stored.subarray(0, 8).equals(Buffer.from('MIABAK1\0'))) throw new Error('Not an encrypted MIA backup');
const key = process.env.MIA_BACKUP_KEY ?? '';
if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('Supply the original 64-hex-character MIA_BACKUP_KEY');
const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), stored.subarray(8, 20));
decipher.setAuthTag(stored.subarray(-16));
const plaintext = Buffer.concat([decipher.update(stored.subarray(20, -16)), decipher.final()]);
writeFileSync(output, plaintext, { mode: 0o600, flag: 'wx' });
```

## Documentation

Start with `docs/PROJECT_STATUS.md` (plain-language status) and `docs/SETUP_GUIDE_BEGINNER.md`.

| File | Contents |
|---|---|
| `docs/PROJECT_STATUS.md` | where the project stands, what needs you |
| `docs/ARCHITECTURE.md` | design, trust boundaries, technology choices, dependencies |
| `docs/REQUIREMENTS_TRACEABILITY.md` | every spec part (1–33) → code → status |
| `docs/IMPLEMENTATION_ROADMAP.md` | phases and prioritized backlog |
| `docs/SETUP_GUIDE_BEGINNER.md` | step-by-step install and first use |
| `docs/API_INTEGRATIONS.md` | data providers, licences, credentials |
| `docs/SECURITY.md` | security audit and controls |
| `docs/TEST_REPORT.md` | test evidence |
| `docs/DEPLOYMENT_GUIDE.md` | running, backups, incidents, rollback |
| `docs/KNOWN_LIMITATIONS.md` | what does not work yet and why |
| `docs/QHEF_LATENCY_BASELINE.md` | measured performance |
| `docs/CHANGELOG.md` | history |
