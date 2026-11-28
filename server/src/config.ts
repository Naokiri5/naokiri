import { existsSync, linkSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ensureStorageDirectory, LinkedStorageFileError, readPrivateStorageFile } from './ops/storagePaths.js';
import { readPublicOrigin } from './security/origins.js';

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
  try {
    const directory = ensureStorageDirectory(dataDir);
    const file = join(directory, 'evidence.key');
    const readKey = () => {
      const until = performance.now() + 250;
      let wait: Int32Array | undefined;
      for (;;) {
        try {
          const v = readPrivateStorageFile(file).trim();
          if (!hex.test(v) || v.length % 2) throw new Error('evidence.key must contain at least 64 hex characters with even length');
          return { key: Buffer.from(v, 'hex'), source: 'file' as const };
        } catch (error) {
          // An atomic publisher holds two links until the private staging name is removed.
          if (!(error instanceof LinkedStorageFileError) || performance.now() >= until) throw error;
          wait ??= new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(wait, 0, 0, 5);
        }
      }
    };
    try { return readKey(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

    const key = randomBytes(32);
    const staging = mkdtempSync(join(directory, '.evidence-key-'));
    const staged = join(staging, 'key');
    try {
      writeFileSync(staged, key.toString('hex') + '\n', { mode: 0o600, flag: 'wx', flush: true });
      // Publish the complete file in one operation without replacing a concurrent winner's key.
      try { linkSync(staged, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        return readKey();
      }
      unlinkSync(staged);
      return { key, source: 'generated' };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  } catch (error) {
    throw new Error('A persistent evidence signing key is required. Verify MIA_DATA_DIR ownership and that the original evidence.key is a private regular file, or configure MIA_EVIDENCE_KEY.', { cause: error });
  }
}
const requestedDataDir = env.MIA_DATA_DIR ? resolve(env.MIA_DATA_DIR) : resolve(REPO_ROOT, 'data');
const persistEvidence = env.MIA_OFFLINE !== '1' || !!env.MIA_DATA_DIR;
const DATA_DIR = persistEvidence ? ensureStorageDirectory(requestedDataDir) : requestedDataDir;
const EVIDENCE = loadEvidenceKey(DATA_DIR, env.MIA_EVIDENCE_KEY, persistEvidence);

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
  /** Browser-facing origin for proxies that rewrite the Host authority. */
  publicOrigin: readPublicOrigin(env.MIA_PUBLIC_ORIGIN),
  webDist: env.MIA_WEB_DIST ? resolve(env.MIA_WEB_DIST) : resolve(REPO_ROOT, 'web', 'dist'),
};

/**
 * Every MIA_* environment variable the server reads. Documented in .env.example (a test keeps both in sync with the
 * source). Unknown MIA_* names are reported at startup, so a typo such as MIA_BACKUP_KEYY is not silently ignored.
 */
export const MIA_ENV_VARS = [
  'MIA_ALLOW_REMOTE_SETUP', 'MIA_AUTH_MODE', 'MIA_BACKUP_DIR', 'MIA_BACKUP_INTERVAL_H', 'MIA_BACKUP_KEEP', 'MIA_BACKUP_KEY',
  'MIA_CHOICE_SHADOW', 'MIA_CONSENSUS_DETAIL_HOURS', 'MIA_DATA_DIR', 'MIA_DEEP_TIER', 'MIA_DUAL_RESEARCH',
  'MIA_ENGINE_LEASE_TTL_MS', 'MIA_EVIDENCE_KEY', 'MIA_GIT_SHA', 'MIA_HOST', 'MIA_JOE_MODEL', 'MIA_KB_EMBEDDINGS',
  'MIA_KB_MAX_UPLOAD_MB', 'MIA_LIVE_TESTS', 'MIA_LOG', 'MIA_MAX_EXEC_BOOK_AGE_MS', 'MIA_OFFLINE', 'MIA_PORT',
  'MIA_PRIVY_APP_ID', 'MIA_PRIVY_EMBEDDED_WALLETS', 'MIA_PRIVY_OWNER_ID', 'MIA_PRIVY_VERIFICATION_KEY',
  'MIA_PUBLIC_ORIGIN', 'MIA_SCAN_INTERVAL_MS', 'MIA_SECURE_COOKIE', 'MIA_TICKER_INTERVAL_MS', 'MIA_WEB_DIST',
] as const;
/** MIA_* names present in the environment that the server does not read (likely typos). Names only, never values. */
export function unknownMiaEnv(source: Record<string, string | undefined> = env): string[] {
  const known = new Set<string>(MIA_ENV_VARS);
  return Object.keys(source).filter((name) => name.startsWith('MIA_') && !known.has(name)).sort();
}

export function ensureDataDir() {
  return ensureStorageDirectory(config.dataDir);
}
