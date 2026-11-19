import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { all, get, run, tx } from '../../db/db.js';
import { config } from '../../config.js';
import { audit } from '../../core/audit.js';
import { limiter, RateLimitError } from '../../core/ratelimit.js';
import { uid } from '../../core/util.js';
import { releaseLease, tryAcquireLease } from '../../ops/lease.js';
import * as auth from '../../api/auth.js';
import { handleCommand, type TelegramReply } from './commands.js';
import { createLinkCode, linkStatus, LinkError, revokeLink } from './link.js';

/**
 * Telegram webhook + owner link API (MIA-TG-01). Registered as its own Fastify plugin so the session guard in
 * api/routes.ts does NOT apply to the webhook. The webhook is authenticated by a secret header only, and a valid
 * secret still grants no account access: the sender must also be linked (see link.ts / commands.ts).
 */

const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;
const STALE_MESSAGE_S = 600;          // Telegram message dates older than 10 minutes are treated as replays
const DEDUPE_RETENTION_MS = 7 * 86_400_000;
const DEDUPE_PRUNE_MS = 3_600_000;
const OUTBOX_MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
const OUTBOX_LEASE = 'telegram-outbox';
const OUTBOX_LEASE_MS = 30_000; // Each Bot API request has a 10-second timeout.
const OUTBOX_POLL_MS = 1_000;
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

function enqueueReply(chatId: number, reply: TelegramReply, now = Date.now()) {
  run("INSERT INTO telegram_outbox(id,chat_id,text,link_id,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,'QUEUED',0,?,?,?)",
    uid('tgo'), chatId, reply.text.slice(0, 3500), reply.linkId, now, now, now);
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
  const due = all<{ id: string }>("SELECT id FROM telegram_outbox WHERE status='QUEUED' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?", now, limit);
  if (!due.length) return 0;
  const holder = uid('telegram-outbox');
  if (!tryAcquireLease(OUTBOX_LEASE, holder, OUTBOX_LEASE_MS)) return 0;
  let processed = 0;
  try {
    for (const { id } of due) {
      // Renew before each request. Recheck authorization in the same write transaction that starts the request.
      const pending = tx(() => {
        if (!tryAcquireLease(OUTBOX_LEASE, holder, OUTBOX_LEASE_MS)) return;
        const row = get<{ chat_id: number; text: string; attempts: number; link_id: string | null; active_link_id: string | null }>(`
          SELECT q.chat_id, q.text, q.attempts, q.link_id, l.id AS active_link_id FROM telegram_outbox q
          LEFT JOIN telegram_links l ON l.id=q.link_id AND l.status='ACTIVE' AND l.telegram_chat_id=q.chat_id
          WHERE q.id=? AND q.status='QUEUED' AND q.next_attempt_at <= ?`, id, now);
        if (!row) return;
        if (row.link_id !== null && row.active_link_id === null) {
          run("UPDATE telegram_outbox SET status='FAILED', text='', last_error='Telegram link inactive', updated_at=? WHERE id=?", Date.now(), id);
          return;
        }
        return { attempts: row.attempts + 1, accepted: send(row.chat_id, row.text).then(() => true, () => false) };
      });
      if (!pending) continue;
      const accepted = await pending.accepted;
      const status = accepted ? 'PROVIDER_ACCEPTED' : pending.attempts >= OUTBOX_MAX_ATTEMPTS ? 'FAILED' : 'QUEUED';
      const finished = Date.now();
      const retryAt = finished + BACKOFF_MS[Math.min(pending.attempts - 1, BACKOFF_MS.length - 1)];
      // A revoked row stays cancelled even if a request that started earlier returns afterwards.
      run(`UPDATE telegram_outbox SET status=?, attempts=?, next_attempt_at=?, last_error=?, updated_at=?
        WHERE id=? AND status='QUEUED' AND EXISTS (SELECT 1 FROM runtime_leases WHERE name=? AND holder=?)`,
      status, pending.attempts, retryAt, accepted ? null : 'Telegram delivery failed', finished, id, OUTBOX_LEASE, holder);
      processed++;
    }
  } finally {
    releaseLease(OUTBOX_LEASE, holder);
  }
  return processed;
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
  if (webhookSecret()) {
    let pruneTimer: ReturnType<typeof setInterval> | undefined;
    let outboxTimer: ReturnType<typeof setInterval> | undefined;
    let activeDrain: Promise<void> | undefined;
    const pruneDedupe = () => {
      try { run('DELETE FROM telegram_update_dedupe WHERE received_at < ?', Date.now() - DEDUPE_RETENTION_MS); }
      catch { app.log.warn('Telegram deduplication cleanup failed'); }
    };
    const tick = () => {
      if (activeDrain) return;
      // One request per poll keeps graceful shutdown bounded by the Bot API timeout.
      activeDrain = drainOutbox(sendViaBotApi, Date.now(), 1)
        .then(() => {}, () => { app.log.warn('Telegram outbox processing failed'); })
        .finally(() => { activeDrain = undefined; });
    };
    app.addHook('onListen', async () => {
      pruneDedupe();
      pruneTimer = setInterval(pruneDedupe, DEDUPE_PRUNE_MS);
      pruneTimer.unref();
      if (config.offline || !config.telegramBotToken) return;
      outboxTimer = setInterval(tick, OUTBOX_POLL_MS);
      outboxTimer.unref();
      tick();
    });
    app.addHook('onClose', async () => {
      clearInterval(pruneTimer);
      clearInterval(outboxTimer);
      await activeDrain;
    });
  }

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
    const sender = m?.from;
    // Edits, callbacks, channel posts and other update types are acknowledged but not processed in v1.
    if (!m || !sender || sender.is_bot) return reply.send({ ok: true, ignored: true });
    if (m.chat.type !== 'private') return reply.send({ ok: true, ignored: true });
    const receivedAt = Date.now();
    if (Math.floor(receivedAt / 1000) - m.date > STALE_MESSAGE_S) return reply.send({ ok: true, ignored: true, reason: 'stale' });

    const chatKey = String(m.chat.id);
    let charged = false;
    let publishMode: (() => void) | undefined;
    let result;
    try {
      result = tx(() => {
        // A failed command or reply insert rolls back the deduplication marker so Telegram can retry it.
        const ins = run('INSERT OR IGNORE INTO telegram_update_dedupe(update_id, received_at) VALUES (?,?)', update.update_id, receivedAt);
        if (Number(ins.changes) === 0) return { ok: true, duplicate: true };
        if (typeof m.text !== 'string') return { ok: true, ignored: true };
        try { chatLimiter.take(chatKey, 'telegram commands', receivedAt); }
        catch (error) {
          if (!(error instanceof RateLimitError)) throw error;
          return { ok: true, ignored: true, reason: 'rate limited' };
        }
        charged = true;
        const commandReply = handleCommand(m.text, { userId: sender.id, chatId: m.chat.id, chatType: m.chat.type }, receivedAt,
          (publish) => { publishMode = publish; });
        enqueueReply(m.chat.id, commandReply, receivedAt);
        return { ok: true };
      });
    } catch (error) {
      if (charged) chatLimiter.refund(chatKey);
      throw error;
    }
    publishMode?.();
    return reply.send(result);
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
