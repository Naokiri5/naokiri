import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const env = process.env;

export const config = {
  port: Number(env.MIA_PORT ?? 8787),
  host: env.MIA_HOST ?? '127.0.0.1',
  dataDir: resolve(env.MIA_DATA_DIR ?? resolve(process.cwd(), '..', 'data')),
  /** Disable all outbound polling (tests / offline). */
  offline: env.MIA_OFFLINE === '1',
  /** Number of deep-tier (T2) instruments to analyze with candles + books. */
  deepTierSize: Number(env.MIA_DEEP_TIER ?? 24),
  scanIntervalMs: Number(env.MIA_SCAN_INTERVAL_MS ?? 60_000),
  tickerIntervalMs: Number(env.MIA_TICKER_INTERVAL_MS ?? 15_000),
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
  joeModel: env.MIA_JOE_MODEL ?? 'claude-sonnet-5-5',
  telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: env.TELEGRAM_CHAT_ID ?? '',
  /** Per-process secret used to authenticate worker evidence packets. Never logged. */
  evidenceKey: env.MIA_EVIDENCE_KEY ? Buffer.from(env.MIA_EVIDENCE_KEY, 'hex') : randomBytes(32),
  webDist: resolve(process.cwd(), '..', 'web', 'dist'),
};

export function ensureDataDir() {
  mkdirSync(config.dataDir, { recursive: true });
}
