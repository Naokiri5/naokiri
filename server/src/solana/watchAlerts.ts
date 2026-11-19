/**
 * Omega 06a: Solana watchlist alerts through MIA's own notifications (in-app, and Telegram when configured).
 *
 * Read-only and opt-in (Settings → Notifications, `notifyPrefs.solanaWatchlistTelegram`, off by default). An alert is
 * sent only for a row the watchlist rates WATCH whose on-chain mint check passed (mint and freeze authority revoked).
 * The message carries the mint address and the checks, never a buy button or a link to a trading bot or site: MIA
 * cannot trade these tokens, and an alert is not a trade signal. The owner decides alone, outside MIA.
 *
 * Limits: one alert per mint per 24 hours, at most 5 per hour, de-duplicated against the stored notifications. During
 * Telegram quiet hours an alert is stored in-app only and is not re-sent to Telegram later.
 */
import { notify } from '../notify/notify.js';
import { all } from '../db/db.js';
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

/**
 * Telegram turns URLs, @mentions and /commands into links even without a parse mode, so an attacker-chosen ticker such
 * as "jup.ag/swap" or "@SomeTradeBot" would become a clickable trading link. Only plain letters and digits are shown.
 */
const SAFE_TICKER = /^[A-Za-z0-9]{1,16}$/;
export const alertTicker = (symbol: string) => (SAFE_TICKER.test(symbol) ? symbol : 'ticker withheld');

let lastRunAt: number | null = null;
let lastError: string | null = null;
/** For the watchlist card: whether alerts are on and whether the last run failed. */
export const watchAlertStatus = () => ({ enabled: watchAlertsEnabled(), lastRunAt, lastError });
export function _resetWatchAlerts() { lastRunAt = null; lastError = null; }

const usd = (n: number) => `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;

/** Plain text (Telegram is sent without parse mode, so nothing in it is interpreted as markup). No links. */
export function watchAlertText(r: AlertRow) {
  const ticker = alertTicker(r.symbol);
  const title = `Solana watchlist: ${ticker}`;
  const lines = [
    `Mint: ${r.mint}`,
    `Liquidity ${usd(r.liquidityUsd)} · 1h volume ${usd(r.volume1hUsd)} · age ${r.ageMinutes == null ? 'unknown' : `${Math.round(r.ageMinutes)} min`}`,
    `On-chain: mint and freeze authority revoked (slot ${r.mintCheck?.slot ?? 'unknown'}).`,
    'Not checked: holder distribution, pool custody, an executable sell route.',
  ];
  if (ticker !== r.symbol) lines.push('The ticker is not shown because it is not plain letters and digits: identify the token by its mint address.');
  lines.push('Watchlist only. Not a trade signal; MIA cannot buy this token.');
  return { title, body: lines.join('\n') };
}

/**
 * Send alerts for rows that newly qualify. Returns the mints alerted. Never throws into the caller's loop for a bad
 * row: rows that do not qualify are skipped.
 */
export function alertNewWatchRows(rows: readonly AlertRow[], nowMs = Date.now()): string[] {
  if (!watchAlertsEnabled()) return [];
  lastRunAt = nowMs;
  try {
    // One read per run: this source sends at most 5 per hour, so the last day is at most ~120 short rows.
    const recent = all<{ ts: number; body: string }>('SELECT ts, body FROM notifications WHERE source=? AND ts > ?', WATCH_ALERT_SOURCE, nowMs - WATCH_ALERT_REPEAT_MS);
    let budget = WATCH_ALERTS_PER_HOUR - recent.filter((n) => n.ts > nowMs - 3600_000).length;
    const sent: string[] = [];
    for (const r of rows) {
      if (budget <= 0) break;
      if (r?.status !== 'WATCH' || r.mintCheck?.status !== 'PASS_MINT_CHECKS_ONLY' || !isSolanaAddress(r.mint)) continue;
      const marker = `Mint: ${r.mint}\n`; // exact and case-sensitive (base58 mints differ by case)
      if (recent.some((n) => n.body.includes(marker))) continue;
      const { title, body } = watchAlertText(r);
      notify('INFO', title, body, WATCH_ALERT_SOURCE, { telegramOptIn: true });
      recent.push({ ts: nowMs, body });
      sent.push(r.mint);
      budget--;
    }
    lastError = null;
    return sent;
  } catch (e) {
    lastError = String((e as Error)?.message ?? e).slice(0, 120);
    return [];
  }
}
