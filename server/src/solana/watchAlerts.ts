/**
 * Omega PR-07: Solana watchlist alerts through MIA's own notifications (in-app, and Telegram when configured).
 *
 * Read-only and opt-in (Settings → Notifications, `notifyPrefs.solanaWatchlistTelegram`, off by default). An alert is
 * sent only for a row the watchlist rates WATCH whose on-chain mint check passed (mint and freeze authority revoked).
 * The message carries the mint address and the checks, never a buy button or a link to a trading bot or site: MIA
 * cannot trade these tokens, and an alert is not a trade signal. The owner decides alone, outside MIA.
 *
 * Limits: one alert per mint per 24 hours, at most 5 per hour, de-duplicated against the stored notifications.
 */
import { notify } from '../notify/notify.js';
import { get } from '../db/db.js';
import { getSetting } from '../core/settings.js';
import { isSolanaAddress } from '../providers/solanaRpc.js';

export const WATCH_ALERT_SOURCE = 'solana-watchlist';
export const WATCH_ALERT_REPEAT_MS = 24 * 3600_000;
export const WATCH_ALERTS_PER_HOUR = 5;

/** The fields an alert needs; the watchlist candidates (`discover().solanaHunter.candidates`) satisfy it. */
export interface AlertRow {
  mint: string; symbol: string; status: string; liquidityUsd: number; volume1hUsd: number; ageMinutes: number | null;
  mintCheck?: { status: string; slot: number | null };
}

export const watchAlertsEnabled = () =>
  getSetting<{ solanaWatchlistTelegram?: unknown }>('notifyPrefs', {}).solanaWatchlistTelegram === true;

const usd = (n: number) => `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;

/** Plain text (Telegram is sent without parse mode, so nothing in it is interpreted as markup). No links. */
export function watchAlertText(r: AlertRow) {
  const title = `Solana watchlist: ${r.symbol}`;
  const lines = [
    `Mint: ${r.mint}`,
    `Liquidity ${usd(r.liquidityUsd)} · 1h volume ${usd(r.volume1hUsd)} · age ${r.ageMinutes == null ? 'unknown' : `${Math.round(r.ageMinutes)} min`}`,
    `On-chain: mint and freeze authority revoked (slot ${r.mintCheck?.slot ?? 'unknown'}).`,
    'Not checked: holder distribution, pool custody, an executable sell route.',
  ];
  if (/[^\x20-\x7E]/.test(r.symbol)) lines.push('The ticker has non-ASCII characters: compare the mint address, not the name.');
  lines.push('Watchlist only. Not a trade signal; MIA cannot buy this token.');
  return { title, body: lines.join('\n') };
}

/**
 * Send alerts for rows that newly qualify. Returns the mints alerted. Never throws into the caller's loop for a bad
 * row: rows that do not qualify are skipped.
 */
export function alertNewWatchRows(rows: readonly AlertRow[], nowMs = Date.now()): string[] {
  if (!watchAlertsEnabled()) return [];
  const lastHour = get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE source=? AND ts > ?', WATCH_ALERT_SOURCE, nowMs - 3600_000)?.n ?? 0;
  let budget = WATCH_ALERTS_PER_HOUR - lastHour;
  const sent: string[] = [];
  for (const r of rows) {
    if (budget <= 0) break;
    if (r?.status !== 'WATCH' || r.mintCheck?.status !== 'PASS_MINT_CHECKS_ONLY' || !isSolanaAddress(r.mint)) continue;
    // Base58 has no '%' or '_', so the mint is safe inside a LIKE pattern.
    const recent = get('SELECT 1 FROM notifications WHERE source=? AND ts > ? AND body LIKE ?', WATCH_ALERT_SOURCE, nowMs - WATCH_ALERT_REPEAT_MS, `%Mint: ${r.mint}%`);
    if (recent) continue;
    const { title, body } = watchAlertText(r);
    notify('INFO', title, body, WATCH_ALERT_SOURCE, { telegramOptIn: true });
    sent.push(r.mint);
    budget--;
  }
  return sent;
}
