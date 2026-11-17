// Starts a fresh, OFFLINE MIA instance for browser tests (no live market data; explicitly synthetic test fixtures).
import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'e2e', '.data');
rmSync(dataDir, { recursive: true, force: true });
const b = spawnSync(process.execPath, [resolve(root, 'server/scripts/ensure-build.mjs')], { stdio: 'inherit' });
if (b.status) process.exit(b.status);
const serverBuild = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'server'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (serverBuild.status !== 0) process.exit(serverBuild.status ?? 1);
const env = { ...process.env, MIA_OFFLINE: '1', MIA_PORT: process.env.MIA_E2E_PORT ?? '8799', MIA_HOST: '127.0.0.1', MIA_DATA_DIR: dataDir, MIA_LOG: 'warn' };
const seed = spawnSync(process.execPath, ['--import', 'tsx', resolve(root, 'e2e/seed-backtest.ts')], { cwd: root, stdio: 'inherit', env });
if (seed.status !== 0) process.exit(seed.status ?? 1);
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(resolve(root, 'e2e/quarantine-worker.mjs')).href}`;
const child = spawn(process.execPath, [resolve(root, 'server/scripts/run.mjs'), 'start'], {
  stdio: 'inherit', env,
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (c) => process.exit(c ?? 0));
