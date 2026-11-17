#!/usr/bin/env node
/**
 * Cross-platform launcher (replaces POSIX `VAR=x cmd` prefixes that fail in Windows cmd/PowerShell).
 *   node scripts/run.mjs start|dev
 * Sets NODE_USE_ENV_PROXY (so built-in fetch honours HTTPS_PROXY where one is configured) and silences the
 * node:sqlite experimental warning, then runs src/main.ts through tsx.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`\n✖ MIA requires Node.js 22.13 or newer (found ${process.versions.node}). Install Node 22 LTS or newer.\n`);
  process.exit(1);
}
const mode = process.argv[2] ?? 'start';
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') };
const { existsSync } = await import('node:fs');
const builtEntry = resolve(serverDir, 'dist', 'main.js');
let command;
let args;
if (mode === 'dev') {
  let tsxCli;
  try { tsxCli = createRequire(resolve(serverDir, 'package.json')).resolve('tsx/cli'); }
  catch { console.error('Development dependency tsx is missing. Run npm ci first.'); process.exit(1); }
  command = process.execPath; args = [tsxCli, 'watch', 'src/main.ts'];
} else if (existsSync(builtEntry)) {
  command = process.execPath; args = [builtEntry];
} else if (process.env.NODE_ENV === 'production') {
  console.error('\nProduction server build missing. Run npm ci && npm run build before starting.\n'); process.exit(1);
} else {
  let tsxCli;
  try { tsxCli = createRequire(resolve(serverDir, 'package.json')).resolve('tsx/cli'); }
  catch { console.error('\nDependencies missing. Run npm install in the repository root.\n'); process.exit(1); }
  command = process.execPath; args = [tsxCli, 'src/main.ts'];
}
const child = spawn(command, args, { cwd: serverDir, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
