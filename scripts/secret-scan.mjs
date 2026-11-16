#!/usr/bin/env node
// Fails if tracked files contain likely secrets (API keys, tokens, private keys, seed-phrase markers).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/], ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/], ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/], ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/], ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/], ['Hex private key assignment', /(?:private[_-]?key|secret)\s*[:=]\s*['"]?(?:0x)?[0-9a-fA-F]{64}\b/i],
];
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => f && !/(^|\/)(package-lock\.json|.*\.(png|jpg|ico|woff2?))$/.test(f) && f !== 'scripts/secret-scan.mjs');
const hits = [];
for (const f of files) {
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => { for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${f}:${i + 1}  ${name}`); });
}
if (hits.length) { console.error(`✖ Possible secrets found:\n${hits.join('\n')}`); process.exit(1); }
console.log(`✓ Secret scan clean (${files.length} tracked files)`);
