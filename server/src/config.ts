import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const env = process.env;
/** Repository root, derived from this file's location (NOT the shell's cwd), so any launch directory works. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Inside containers / Codespaces / dev containers / WSL-forwarded or cloud sessions, a port forwarder connects to the
 * container's network interface, so a loopback-only bind is unreachable. Bind all interfaces there; stay on loopback
 * on a normal desktop. MIA_HOST always wins.
 */
export function inContainer() {
  return !!(env.CODESPACES || env.REMOTE_CONTAINERS || env.DEVCONTAINER || env.GITPOD_WORKSPACE_ID || env.CLAUDE_CODE_REMOTE || env.KUBERNETES_SERVICE_HOST
    || existsSync('/.dockerenv') || existsSync('/run/.containerenv'));
}

/**
 * Evidence-packet HMAC key. Precedence: MIA_EVIDENCE_KEY (validated) → <dataDir>/evidence.key → generate and persist
 * (mode 0600). Previously the key was random per process, so signed evidence could not be re-verified after a
 * restart, and a non-hex MIA_EVIDENCE_KEY silently became an EMPTY key (Buffer.from('abc!', 'hex') stops at the
 * first bad character), which anyone can forge.
 */
export function loadEvidenceKey(dataDir: string, envValue = env.MIA_EVIDENCE_KEY, persist = env.MIA_OFFLINE !== '1' || !!env.MIA_DATA_DIR): { key: Buffer; source: 'env' | 'file' | 'generated' | 'ephemeral' } {
  const hex = /^[0-9a-fA-F]{64,}$/;
  if (envValue) {
    if (!hex.test(envValue) || envValue.length % 2) throw new Error('MIA_EVIDENCE_KEY must be at least 64 hex characters (32 bytes), even length. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    return { key: Buffer.from(envValue, 'hex'), source: 'env' };
  }
  if (!persist) return { key: randomBytes(32), source: 'ephemeral' };
  const file = join(dataDir, 'evidence.key');
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim();
    if (!hex.test(v) || v.length % 2) throw new Error(`${file} is corrupt (expected 64+ hex characters). Restore it from backup, or delete it to start a new key (older evidence will no longer verify).`);
    return { key: Buffer.from(v, 'hex'), source: 'file' };
  }
  const k = randomBytes(32);
  try { mkdirSync(dataDir, { recursive: true, mode: 0o700 }); writeFileSync(file, k.toString('hex') + '\n', { mode: 0o600, flag: 'wx' }); }
  catch (e: any) { if (e?.code === 'EEXIST') return loadEvidenceKey(dataDir, envValue, persist); return { key: k, source: 'ephemeral' }; }
  return { key: k, source: 'generated' };
}
const DATA_DIR = env.MIA_DATA_DIR ? resolve(env.MIA_DATA_DIR) : resolve(REPO_ROOT, 'data');
const EVIDENCE = loadEvidenceKey(DATA_DIR);

const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const raw = env[name]; if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  return n;
};

export const config = {
  port: intEnv('MIA_PORT', 8787, 1, 65535),
  host: env.MIA_HOST ?? (inContainer() ? '0.0.0.0' : '127.0.0.1'),
  dataDir: DATA_DIR,
  /** Disable all outbound polling (tests / offline). */
  offline: env.MIA_OFFLINE === '1',
  /** Number of deep-tier (T2) instruments to analyze with candles + books. */
  deepTierSize: intEnv('MIA_DEEP_TIER', 24, 5, 200),
  scanIntervalMs: intEnv('MIA_SCAN_INTERVAL_MS', 60_000, 10_000, 3_600_000),
  tickerIntervalMs: intEnv('MIA_TICKER_INTERVAL_MS', 15_000, 5_000, 600_000),
  /** Engine lease TTL override for offline tests only (0 = default: three ticker intervals, min 45 s); ignored when online. */
  engineLeaseTtlMs: intEnv('MIA_ENGINE_LEASE_TTL_MS', 0, 1_000, 3_600_000),
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
  joeModel: env.MIA_JOE_MODEL ?? 'claude-opus-5-5',
  telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: env.TELEGRAM_CHAT_ID ?? '',
  /** Persistent secret used to authenticate worker evidence packets. Never logged. */
  evidenceKey: EVIDENCE.key,
  evidenceKeySource: EVIDENCE.source,
  /** Add the Secure flag to the session cookie (set when MIA is served over HTTPS / behind a TLS proxy). */
  secureCookie: env.MIA_SECURE_COOKIE === '1',
  webDist: env.MIA_WEB_DIST ? resolve(env.MIA_WEB_DIST) : resolve(REPO_ROOT, 'web', 'dist'),
};

/** A newly created data directory is private to the server's account (it holds the database, keys and backups).
 *  An existing directory's permissions are left as the owner set them. */
export function ensureDataDir() {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
}
