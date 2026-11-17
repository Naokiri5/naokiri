// Starts a fresh, OFFLINE MIA instance for browser tests (deterministic: no live market data, empty database).
import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'e2e', '.data');
rmSync(dataDir, { recursive: true, force: true });
const b = spawnSync(process.execPath, [resolve(root, 'server/scripts/ensure-build.mjs')], { stdio: 'inherit' });
if (b.status) process.exit(b.status);
const child = spawn(process.execPath, [resolve(root, 'server/scripts/run.mjs'), 'start'], {
  stdio: 'inherit', env: { ...process.env, MIA_OFFLINE: '1', MIA_BACKUP_INTERVAL_MS: '0', MIA_PORT: process.env.MIA_E2E_PORT ?? '8799', MIA_HOST: '127.0.0.1', MIA_DATA_DIR: dataDir, MIA_LOG: 'warn' },
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (c) => process.exit(c ?? 0));
