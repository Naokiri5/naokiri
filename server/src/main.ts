/**
 * MIA server entry point. Kept separate from index.ts (which only exports buildApp for tests) so startup never
 * depends on comparing argv paths — that comparison failed on Windows and silently skipped app.listen().
 */
import { networkInterfaces } from 'node:os';
import { config, inContainer } from './config.js';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 16)) {
  console.error(`\n✖ MIA requires Node.js 22.16 or newer (found ${process.versions.node}).\n  It uses the built-in node:sqlite module. Install Node 22 LTS or newer: https://nodejs.org/\n`);
  process.exit(1);
}

const { buildApp } = await import('./index.js');
const { startBot, stopBot } = await import('./bot/bot.js');
const { startBackups, stopBackups } = await import('./backup/backup.js');

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
} catch (e: any) {
  if (e?.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${config.port} is already in use on ${config.host}.\n  Another MIA instance (or other program) is listening there. Stop it, or start on another port:\n    macOS/Linux:  MIA_PORT=8788 npm start\n    PowerShell:   $env:MIA_PORT=8788; npm start\n`);
  } else if (e?.code === 'EACCES') {
    console.error(`\n✖ Permission denied binding ${config.host}:${config.port}. Use a port above 1024 (MIA_PORT).\n`);
  } else console.error('\n✖ Server failed to start:', e?.message ?? e);
  process.exit(1);
}

const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
const lines = [`\n  MIA 4.1 is running (paper trading only; real-money execution is locked)`, `  ➜ Local:     http://localhost:${config.port}/`];
if (config.host === '0.0.0.0' || config.host === '::') {
  lines.push(`  ➜ Network:   ${lan.map((a) => `http://${a}:${config.port}/`).join('  ') || '(no external interface)'}`);
  if (inContainer()) lines.push(`  ➜ Container detected: bound to all interfaces so a forwarded port can reach it. Open the forwarded URL for port ${config.port}.`);
} else lines.push(`  ➜ Bound to ${config.host} only. For Docker/WSL/Codespaces or another device set MIA_HOST=0.0.0.0.`);
lines.push(`  ➜ Data:      ${config.dataDir}`, config.offline ? '  ➜ OFFLINE mode: market data polling disabled' : '');
console.log(lines.filter(Boolean).join('\n') + '\n');

startBot();
startBackups();
const shutdown = async () => { stopBackups(); stopBot(); await app.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
