#!/usr/bin/env node
/** Runs before `npm start`: builds the web UI once if web/dist is missing, so localhost never serves an empty app. */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.env.MIA_WEB_DIST || existsSync(resolve(root, 'web', 'dist', 'index.html'))) process.exit(0);
if (process.env.NODE_ENV === 'production') {
  console.error('Production web assets missing. Run npm ci && npm run build before starting.');
  process.exit(1);
}
console.log('\n• Web UI not built yet — building it once (npm run build -w web)…\n');
const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'web'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
