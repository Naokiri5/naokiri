import { randomBytes } from 'node:crypto';
import { get, run, tx } from '../../db/db.js';
import { sha256, uid } from '../../core/util.js';
import { audit } from '../../core/audit.js';

/**
 * One-time owner link between MIA and a single Telegram private chat (MIA-TG-01).
 *
 * - The owner creates a code in an authenticated MIA session; only its SHA-256 hash is stored.
 * - The code expires after CODE_TTL_MS and is burned after MAX_CODE_ATTEMPTS wrong guesses.
 * - A successful redemption binds BOTH the Telegram user id and the private chat id, and the code is cleared (single use).
 * - Only one ACTIVE link may exist (single-owner app). Unlink clears the chat identifiers.
 */
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
/** 32 unambiguous characters: 256 % 32 === 0, so byte-to-character mapping has no modulo bias. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export interface LinkRow {
  id: string; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; code_hash: string | null; code_expires_at: number | null;
  code_attempts: number; telegram_user_id: number | null; telegram_chat_id: number | null;
  created_at: number; linked_at: number | null; revoked_at: number | null;
}

export class LinkError extends Error {}

export function newLinkCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const activeLink = () => get<LinkRow>("SELECT * FROM telegram_links WHERE status='ACTIVE'");

/** Creates a fresh one-time code, replacing any earlier unredeemed code. Refuses while a chat is already linked. */
export function createLinkCode(now = Date.now()): { code: string; expiresAt: number } {
  if (activeLink()) throw new LinkError('a Telegram chat is already linked; unlink it first');
  const code = newLinkCode();
  const expiresAt = now + CODE_TTL_MS;
  tx(() => {
    run("DELETE FROM telegram_links WHERE status='PENDING'");
    run("INSERT INTO telegram_links(id,status,code_hash,code_expires_at,code_attempts,created_at) VALUES (?,?,?,?,0,?)",
      uid('tgl'), 'PENDING', sha256(code), expiresAt, now);
    audit('owner', 'telegram.link.code_issued', { expiresAt });
  });
  return { code, expiresAt };
}

export type RedeemResult = { ok: true } | { ok: false; reason: string };
const INVALID = 'invalid or expired code';

/**
 * Redeems a code sent by Telegram. Failures RETURN (not throw) so the attempt counter commits.
 * The caller supplies the Telegram identifiers it verified from the update (never a username or display name).
 */
export function redeemLinkCode(raw: string, telegramUserId: number, telegramChatId: number, now = Date.now()): RedeemResult {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { ok: false, reason: INVALID };
  return tx<RedeemResult>(() => {
    if (activeLink()) return { ok: false, reason: 'a Telegram chat is already linked; send /unlink from it first' };
    const pending = get<LinkRow>("SELECT * FROM telegram_links WHERE status='PENDING'");
    if (!pending) return { ok: false, reason: INVALID };
    if ((pending.code_expires_at ?? 0) <= now || pending.code_attempts >= MAX_CODE_ATTEMPTS) {
      run("DELETE FROM telegram_links WHERE id=?", pending.id);
      return { ok: false, reason: INVALID };
    }
    if (pending.code_hash !== sha256(code)) {
      const attempts = pending.code_attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) run("DELETE FROM telegram_links WHERE id=?", pending.id);
      else run("UPDATE telegram_links SET code_attempts=? WHERE id=?", attempts, pending.id);
      audit('telegram', 'telegram.link.failed', { attempts });
      return { ok: false, reason: INVALID };
    }
    run("UPDATE telegram_links SET status='ACTIVE', code_hash=NULL, code_expires_at=NULL, code_attempts=0, telegram_user_id=?, telegram_chat_id=?, linked_at=? WHERE id=?",
      telegramUserId, telegramChatId, now, pending.id);
    audit('telegram', 'telegram.link.active', { linkId: pending.id });
    return { ok: true };
  });
}

/** True only for the exact Telegram user AND private chat that redeemed the active link. */
export function isLinkedIdentity(telegramUserId: number, telegramChatId: number): boolean {
  const l = activeLink();
  return !!l && l.telegram_user_id === telegramUserId && l.telegram_chat_id === telegramChatId;
}

/** Revokes the active link and purges the chat identifiers. Returns false when nothing was linked. */
export function revokeLink(actor = 'owner'): boolean {
  const l = activeLink();
  if (!l) return false;
  tx(() => {
    run("UPDATE telegram_links SET status='REVOKED', telegram_user_id=NULL, telegram_chat_id=NULL, revoked_at=? WHERE id=?", Date.now(), l.id);
    audit(actor, 'telegram.link.revoked', { linkId: l.id });
  });
  return true;
}

export function cancelLinkCode(): boolean {
  return tx(() => {
    const result = run("DELETE FROM telegram_links WHERE status='PENDING'");
    if (Number(result.changes) === 0) return false;
    audit('owner', 'telegram.link.code_canceled');
    return true;
  });
}

/** Owner-facing status: never returns chat or user identifiers, codes or hashes. */
export function linkStatus(now = Date.now()) {
  const active = activeLink();
  const pending = get<LinkRow>("SELECT * FROM telegram_links WHERE status='PENDING'");
  return {
    linked: !!active,
    linkedAt: active?.linked_at ?? null,
    pendingCode: !!pending && (pending.code_expires_at ?? 0) > now,
    pendingExpiresAt: pending?.code_expires_at ?? null,
  };
}
