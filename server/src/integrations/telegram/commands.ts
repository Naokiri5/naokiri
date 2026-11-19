import { getControl, displayMode, updateControl } from '../../core/mode.js';
import { accountState, openPositions, PAPER_ACCOUNT } from '../../portfolio/ledger.js';
import { recentDecisions } from '../../market/scanner.js';
import { botStatusView } from '../../bot/bot.js';
import { linkForIdentity, redeemLinkCode, revokeLink } from './link.js';

/**
 * Deterministic Telegram command router (MIA-TG-01). The LLM never interprets commands or authorizes anything.
 *
 * Trust rules:
 * - Telegram text is untrusted input. It is never echoed back, interpolated into state, or executed.
 * - Only an exact linked (from.id, chat.id) pair receives account facts.
 * - The only state-changing command is /pause (NEW entries only). It reuses the canonical control in core/mode.ts,
 *   which allows non-owner actors to reduce risk and audits the change.
 * - Every trading, approval, permission or limit command returns a fixed denial that points to the MIA app.
 */

export const HELP_TEXT = [
  'MIA paper-trading bot (read-only from Telegram).',
  '/status  paper mode and data freshness',
  '/risk  current risk state',
  '/positions  open PAPER positions',
  '/scan  last few decisions (no new analysis)',
  '/pause  pause NEW paper entries (existing positions stay monitored)',
  '/unlink  disconnect this chat',
  'Trades, approvals and limit changes are only available in the MIA app.',
].join('\n');

/** Commands that are never executed from Telegram. The argument is deliberately NOT echoed back. */
const DENIED = new Set(['buy', 'sell', 'snipe', 'resume', 'approve', 'withdraw', 'change-limits', 'changelimits']);
const MAX_TEXT = 256;

export interface TelegramSender { userId: number; chatId: number; chatType: string }
export interface TelegramReply { text: string; linkId: string | null }

export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const t = text.trim();
  // "/cmd", optional "@botname" suffix, optional argument. Anything else is not a command.
  const m = /^\/([A-Za-z][A-Za-z-]{0,31})(?:@[A-Za-z0-9_]{1,64})?(?:\s+([\s\S]*))?$/.exec(t);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[2] ?? '').trim() };
}

const appUrl = () => process.env.MIA_PUBLIC_URL?.trim() || 'the MIA app (open it in your browser)';
const money = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : 'unknown');
const publicReply = (text: string): TelegramReply => ({ text, linkId: null });

export function handleCommand(
  rawText: string,
  sender: TelegramSender,
  now = Date.now(),
  deferModePublish?: (publish: () => void) => void,
): TelegramReply {
  if (rawText.length > MAX_TEXT) return publicReply('Message too long. Send a short command such as /status.');
  const p = parseCommand(rawText);
  if (!p) return publicReply(HELP_TEXT);
  const { cmd } = p;

  if (cmd === 'start' || cmd === 'help') return publicReply(HELP_TEXT);

  if (cmd === 'link') {
    if (sender.chatType !== 'private') return publicReply('Send /link from a private chat with this bot.');
    const r = redeemLinkCode(p.arg, sender.userId, sender.chatId, now);
    return publicReply(r.ok ? 'Linked. Send /help for commands.' : `Link failed: ${r.reason}.`);
  }

  // Everything below exposes account facts or changes state: exact identity match first.
  const link = linkForIdentity(sender.userId, sender.chatId);
  if (!link) return publicReply('Not linked. Create a link code in MIA, then send /link CODE here.');

  if (DENIED.has(cmd)) return publicReply(`Not supported over Telegram. Review it in MIA: ${appUrl()}`);
  const linkedReply = (text: string): TelegramReply => ({ text, linkId: link.id });

  switch (cmd) {
    case 'status': {
      const ctl = getControl();
      const view = botStatusView();
      const ticker = view.lastTickerAt ? `${Math.round((now - view.lastTickerAt) / 1000)}s ago` : 'no data yet';
      return linkedReply([
        `Mode: PAPER (simulated, no real orders). Display: ${displayMode(ctl)}.`,
        `Engine: ${view.role}. Last market update: ${ticker}.`,
        `Policy accepted: ${view.policyAccepted ? 'yes' : 'no'}.`,
      ].join('\n'));
    }
    case 'risk': {
      const ctl = getControl();
      const acct = accountState(PAPER_ACCOUNT, now);
      return linkedReply([
        `PAPER account risk. Mode: ${displayMode(ctl)}. New entries paused: ${ctl.pausedNewOrders ? 'yes' : 'no'}.`,
        `Equity ${money(acct.equity)} · daily P&L ${money(acct.dailyPnlPct)}% · drawdown ${money(acct.drawdownPct)}%.`,
        `Open positions: ${acct.openCount} · open risk ${money(acct.openRiskPct)}%.`,
        `Disabled strategies: ${ctl.disabledStrategies.length}.`,
      ].join('\n'));
    }
    case 'positions': {
      const rows = openPositions(PAPER_ACCOUNT).slice(0, 10);
      if (!rows.length) return linkedReply('PAPER positions: none open.');
      return linkedReply(['PAPER positions (simulated):', ...rows.map((r) => `${r.instrument} ${r.direction} qty ${money(r.qty)} @ ${money(r.entry_price)}, stop ${money(r.stop_price)}`)].join('\n'));
    }
    case 'scan': {
      const rows = recentDecisions().slice(0, 5);
      if (!rows.length) return linkedReply('No recent decisions. Nothing is analysed on demand from Telegram.');
      return linkedReply(['Last decisions (PAPER, read-only):', ...rows.map((d) => `${d.asset} ${d.finalDecision} (${d.strategy.id}) ${d.createdAt}`)].join('\n'));
    }
    case 'pause': {
      if (getControl().pausedNewOrders) return linkedReply('New entries are already paused.');
      // Risk-reducing only: sets pausedNewOrders and never creates, resumes or sizes an order.
      updateControl(`telegram:${link.id}`, { pausedNewOrders: true }, undefined, deferModePublish);
      return linkedReply('New paper entries paused. Existing positions are still monitored. Resume only in the MIA app.');
    }
    case 'unlink': {
      revokeLink('telegram');
      return publicReply('Unlinked. This chat no longer receives MIA data.');
    }
    default:
      return publicReply(HELP_TEXT);
  }
}
