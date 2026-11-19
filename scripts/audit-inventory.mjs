#!/usr/bin/env node
/**
 * Machine-readable audit inventory (debug work order §3.1 / §3.7). Lists every tracked file with size, language, owning
 * review team and review status, so an audit can never claim coverage it did not have.
 *   node scripts/audit-inventory.mjs docs/engineering/audit-review-status.json > docs/engineering/audit-files.json
 * The status file maps path prefixes to a status; the longest matching prefix wins; anything unmatched is NOT_REVIEWED.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const statusMap = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : {};
const LANG = { '.ts': 'typescript', '.tsx': 'tsx', '.mjs': 'javascript', '.js': 'javascript', '.json': 'json', '.md': 'markdown', '.css': 'css', '.html': 'html', '.yml': 'yaml', '.yaml': 'yaml', '.csv': 'csv', '.service': 'systemd' };
const TEAMS = [
  ['server/src/exec', 'G Order lifecycle & risk'], ['server/src/risk', 'G Order lifecycle & risk'], ['server/src/portfolio', 'E Database & accounting'],
  ['server/src/db', 'E Database & accounting'], ['server/src/ops', 'H Reliability'], ['server/src/bot', 'H Reliability'], ['server/scripts', 'H Reliability'], ['deploy', 'H Reliability'],
  ['server/src/market', 'F Markets & intelligence'], ['server/src/providers', 'F Markets & intelligence'], ['server/src/features', 'F Markets & intelligence'],
  ['server/src/workers', 'F Markets & intelligence'], ['server/src/qci', 'F Markets & intelligence'], ['server/src/decision', 'F Markets & intelligence'], ['server/src/regime', 'F Markets & intelligence'],
  ['server/src/lab', 'F Markets & intelligence'], ['server/src/chart', 'F Markets & intelligence'], ['server/src/ditas', 'F Markets & intelligence'],
  ['server/src/knowledge', 'I AI, knowledge & provider safety'], ['server/src/joe', 'I AI, knowledge & provider safety'], ['server/src/news', 'I AI, knowledge & provider safety'], ['server/src/safety', 'I AI, knowledge & provider safety'],
  ['server/src/api', 'D Backend API & security'], ['server/src/core', 'D Backend API & security'], ['server/src/security', 'D Backend API & security'], ['server/src/wallet', 'D Backend API & security'],
  ['server/src/qa', 'J Independent QA & release'], ['server/test', 'J Independent QA & release'], ['e2e', 'J Independent QA & release'],
  ['web', 'C Frontend & accessibility'], ['.github', 'B Build, dependencies & CI'], ['package', 'B Build, dependencies & CI'], ['scripts', 'B Build, dependencies & CI'],
  ['server/src', 'D Backend API & security'], ['docs', 'A Repository & architecture'], ['.claude', 'A Repository & architecture'], ['', 'A Repository & architecture'],
];
const longest = (path, entries) => entries.filter(([p]) => path.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const out = files.map((path) => ({
  path, bytes: statSync(path).size, language: LANG[extname(path)] ?? (extname(path) || 'other'),
  team: longest(path, TEAMS), review: path === 'package-lock.json' ? 'GENERATED' : (longest(path, Object.entries(statusMap)) ?? 'NOT_REVIEWED'),
}));
const counts = out.reduce((m, f) => ((m[f.review] = (m[f.review] ?? 0) + 1), m), {});
process.stdout.write(JSON.stringify({ generatedFrom: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), totalFiles: out.length, counts, files: out }, null, 1) + '\n');
