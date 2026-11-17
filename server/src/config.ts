import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const env = process.env;
/** Repository root, derived from this file's location (NOT the shell's cwd), so any launch directory works. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = env.MIA_DATA_DIR ? resolve(env.MIA_DATA_DIR) : resolve(REPO_ROOT, 'data');
const backupIntervalMs = Number(env.MIA_BACKUP_INTERVAL_MS ?? 6 * 3600_000);
const backupKeep = Number(env.MIA_BACKUP_KEEP ?? 14);
if (!Number.isFinite(backupIntervalMs) || env.MIA_BACKUP_INTERVAL_MS?.trim() === '') throw new Error('MIA_BACKUP_INTERVAL_MS must be a finite number');
if (!Number.isInteger(backupKeep) || backupKeep < 1 || env.MIA_BACKUP_KEEP?.trim() === '') throw new Error('MIA_BACKUP_KEEP must be a positive integer');

/**
 * Inside containers / Codespaces / dev containers / WSL-forwarded or cloud sessions, a port forwarder connects to the
 * container's network interface, so a loopback-only bind is unreachable. Bind all interfaces there; stay on loopback
 * on a normal desktop. MIA_HOST always wins.
 */
export function inContainer() {
  return !!(env.CODESPACES || env.REMOTE_CONTAINERS || env.DEVCONTAINER || env.GITPOD_WORKSPACE_ID || env.CLAUDE_CODE_REMOTE || env.KUBERNETES_SERVICE_HOST
    || existsSync('/.dockerenv') || existsSync('/run/.containerenv'));
}

export const config = {
  port: Number(env.MIA_PORT ?? 8787),
  host: env.MIA_HOST ?? (inContainer() ? '0.0.0.0' : '127.0.0.1'),
  dataDir,
  backup: {
    dir: env.MIA_BACKUP_DIR ? resolve(env.MIA_BACKUP_DIR) : resolve(dataDir, 'backups'),
    intervalMs: backupIntervalMs,
    keep: backupKeep,
  },
  /** Disable all outbound polling (tests / offline). */
  offline: env.MIA_OFFLINE === '1',
  /** Number of deep-tier (T2) instruments to analyze with candles + books. */
  deepTierSize: Number(env.MIA_DEEP_TIER ?? 24),
  scanIntervalMs: Number(env.MIA_SCAN_INTERVAL_MS ?? 60_000),
  tickerIntervalMs: Number(env.MIA_TICKER_INTERVAL_MS ?? 15_000),
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
  joeModel: env.MIA_JOE_MODEL ?? 'claude-opus-5-5',
  telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: env.TELEGRAM_CHAT_ID ?? '',
  /** Per-process secret used to authenticate worker evidence packets. Never logged. */
  evidenceKey: env.MIA_EVIDENCE_KEY ? Buffer.from(env.MIA_EVIDENCE_KEY, 'hex') : randomBytes(32),
  webDist: env.MIA_WEB_DIST ? resolve(env.MIA_WEB_DIST) : resolve(REPO_ROOT, 'web', 'dist'),
};

export function ensureDataDir() {
  mkdirSync(config.dataDir, { recursive: true });
}
