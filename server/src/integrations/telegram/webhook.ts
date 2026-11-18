import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { all, get, run } from '../../db/db.js';
import { config } from '../../config.js';
import { audit } from '../../core/audit.js';
import { limiter, RateLimitError } from '../../core/ratelimit.js';
import { uid } from '../../core/util.js';
import * as auth from '../../api/auth.js';
import { handleCommand } from './commands.js';
import { createLinkCode, linkStatus, LinkError, revokeLink } from './link.js';

/**
 * Telegram webhook + owner link API (MIA-TG-01). Registered as its own Fastify plugin so the session guard in
 * api/routes.ts does NOT apply to the webhook. The webhook is authenticated by a secret header only, and a valid
 * secret still grants no account access: the sender must also be linked (see link.ts / commands.ts).
 */

const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;
const STALE_MESSAGE_S = 600;          // Telegram message dates older than 10 minutes are treated as replays
const DEDUPE_RETENTION_MS = 7 * 86_400_000;
const OUTBOX_MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
const rejectLimiter = limiter(60, 20);   // bad-secret attempts per source address
const chatLimiter = limiter(20, 10);     // accepted commands per chat

/** Reads the secret at call time. Missing or malformed secrets disable the webhook entirely (404). */
export function webhookSecret(): string | null {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  return SECRET_RE.test(s) ? s : null;
}

/** Constant-time comparison: both sides are hashed to equal length before timingSafeEqual. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

const Update = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int(),
    date: z.number().int(),
    text: z.string().max(4096).optional(),
    from: z.object({ id: z.number().int(), is_bot: z.boolean().optional() }).passthrough().optional(),
    chat: z.object({ id: z.number().int(), type: z.string().max(20) }).passthrough(),
  }).passthrough().optional(),
}).passthrough();

// ── reply outbox: QUEUED → PROVIDER_ACCEPTED | FAILED, with bounded retries and backoff ──────────────────────────

export function enqueueReply(chatId: number, text: string, now = Date.now()) {
  run("INSERT INTO telegram_outbox(id,chat_id,text,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,0,?,?,?)",
    uid('tgo'), chatId, text.slice(0, 3500), 'QUEUED', now, now, now);
}

/** Sends one message through the Bot API. Plain text (no parse_mode), so untrusted text is never markup. */
export async function sendViaBotApi(chatId: number, text: string): Promise<void> {
  if (!config.telegramBotToken) throw new Error('bot token not configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: ctl.signal,
    });
    // Never include the URL or body in the error: both can carry the bot token or chat identifiers.
    if (!res.ok) throw new Error(`telegram responded ${res.status}`);
  } finally { clearTimeout(timer); }
}

export async function drainOutbox(send: (chatId: number, text: string) => Promise<void> = sendViaBotApi, now = Date.now(), limit = 20): Promise<number> {
  const due = all<{ id: string; chat_id: number; text: string; attempts: number }>(
    "SELECT id, chat_id, text, attempts FROM telegram_outbox WHERE status='QUEUED' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?", now, limit);
  for (const row of due) {
    try {
      await send(row.chat_id, row.text);
      run("UPDATE telegram_outbox SET status='PROVIDER_ACCEPTED', attempts=attempts+1, last_error=NULL, updated_at=? WHERE id=?", Date.now(), row.id);
    } catch (e: any) {
      const attempts = row.attempts + 1;
      const failed = attempts >= OUTBOX_MAX_ATTEMPTS;
      run("UPDATE telegram_outbox SET status=?, attempts=?, next_attempt_at=?, last_error=?, updated_at=? WHERE id=?",
        failed ? 'FAILED' : 'QUEUED', attempts, Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
        String(e?.message ?? 'send failed').slice(0, 200), Date.now(), row.id);
    }
  }
  run('DELETE FROM telegram_update_dedupe WHERE received_at < ?', now - DEDUPE_RETENTION_MS);
  return due.length;
}

/** Sends queued replies in the background. No-op without a bot token, so tests and offline runs never call Telegram. */
function kickOutbox() {
  if (!config.telegramBotToken) return;
  void drainOutbox().catch(() => { /* failures are recorded per row */ });
}

// ── session guard for owner-facing endpoints (same cookie and CSRF rules as api/routes.ts) ─────────────────────

const COOKIE = 'mia_session';
const tokenOf = (req: FastifyRequest) => (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

function ownerGuard(req: FastifyRequest, reply: FastifyReply, mutating: boolean): boolean {
  if (!auth.validSession(tokenOf(req))) { reply.code(401).send({ error: 'authentication required' }); return false; }
  if (mutating && req.headers['x-mia-csrf'] !== '1') { reply.code(403).send({ error: 'missing CSRF header' }); return false; }
  return true;
}

export async function telegramRoutes(app: FastifyInstance) {
  app.post('/api/integrations/telegram/webhook', async (req, reply) => {
    const secret = webhookSecret();
    if (!secret) return reply.code(404).send({ error: 'not found' });

    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (typeof header !== 'string' || !secretMatches(header, secret)) {
      try { rejectLimiter.take(req.ip, 'webhook'); } catch (e) { if (e instanceof RateLimitError) return reply.code(429).send({ error: 'rate limited' }); throw e; }
      audit('anonymous', 'telegram.webhook.rejected', { reason: 'secret' });
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = Update.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid update' });
    const update = parsed.data;
    const m = update.message;
    // Edits, callbacks, channel posts and other update types are acknowledged but not processed in v1.
    if (!m || !m.from || m.from.is_bot) return reply.send({ ok: true, ignored: true });
    if (m.chat.type !== 'private') return reply.send({ ok: true, ignored: true });
    if (Math.floor(Date.now() / 1000) - m.date > STALE_MESSAGE_S) return reply.send({ ok: true, ignored: true, reason: 'stale' });

    // Exactly-once processing per update_id: a retried or replayed update is acknowledged without side effects.
    const ins = run('INSERT OR IGNORE INTO telegram_update_dedupe(update_id, received_at) VALUES (?,?)', update.update_id, Date.now());
    if (Number(ins.changes) === 0) return reply.send({ ok: true, duplicate: true });

    if (typeof m.text !== 'string') return reply.send({ ok: true, ignored: true });
    try { chatLimiter.take(String(m.chat.id), 'telegram commands'); }
    catch { return reply.send({ ok: true, ignored: true, reason: 'rate limited' }); }

    const text = handleCommand(m.text, { userId: m.from.id, chatId: m.chat.id, chatType: m.chat.type });
    if (text) enqueueReply(m.chat.id, text);
    kickOutbox();
    return reply.send({ ok: true });
  });

  app.post('/api/integrations/telegram/link/start', async (req, reply) => {
    if (!ownerGuard(req, reply, true)) return;
    const body = z.object({ password: z.string().min(1).max(1024) }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'password required' });
    // Creating a link grants account visibility, so it needs the passphrase (shares the brute-force limits).
    auth.verifyPassphrase(body.data.password, req.ip, 'telegram-link');
    try {
      const { code, expiresAt } = createLinkCode();
      return { code, expiresAt, instructions: 'Send /link CODE to the MIA bot in a private chat within 10 minutes.' };
    } catch (e) {
      if (e instanceof LinkError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  app.post('/api/integrations/telegram/unlink', async (req, reply) => {
    if (!ownerGuard(req, reply, true)) return;
    return { ok: true, unlinked: revokeLink('owner') };
  });

  app.get('/api/integrations/telegram/status', async (req, reply) => {
    if (!ownerGuard(req, reply, false)) return;
    const counts = all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM telegram_outbox GROUP BY status');
    const lastEvent = get<{ received_at: number }>('SELECT MAX(received_at) received_at FROM telegram_update_dedupe');
    return {
      webhookEnabled: !!webhookSecret(),
      botTokenConfigured: !!config.telegramBotToken,
      link: linkStatus(),
      outbox: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      lastUpdateAt: lastEvent?.received_at ?? null,
    };
  });
}
