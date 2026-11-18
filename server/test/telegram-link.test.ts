import { describe, it, expect, beforeEach } from 'vitest';
import { closeDb, openDb, all } from '../src/db/db.js';
import {
  createLinkCode, redeemLinkCode, isLinkedIdentity, revokeLink, linkStatus,
  MAX_CODE_ATTEMPTS, CODE_TTL_MS, LinkError,
} from '../src/integrations/telegram/link.js';

const USER = 111, CHAT = 222;

describe('Telegram one-time owner link (MIA-TG-01)', () => {
  beforeEach(() => { closeDb(); openDb(':memory:'); });

  it('binds exactly one Telegram user and private chat, and the code is single-use', () => {
    const { code } = createLinkCode();
    expect(redeemLinkCode(code, USER, CHAT)).toEqual({ ok: true });
    expect(isLinkedIdentity(USER, CHAT)).toBe(true);
    expect(isLinkedIdentity(USER, 999)).toBe(false);
    expect(isLinkedIdentity(999, CHAT)).toBe(false);
    expect(redeemLinkCode(code, 333, 444).ok).toBe(false);
  });

  it('stores only a hash of the code, never the code itself', () => {
    const { code } = createLinkCode();
    const row = all<{ code_hash: string }>('SELECT code_hash FROM telegram_links')[0];
    expect(row.code_hash).toBeTruthy();
    expect(row.code_hash).not.toContain(code);
  });

  it('burns the code after MAX_CODE_ATTEMPTS wrong guesses', () => {
    const { code } = createLinkCode();
    const wrong = code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA';
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) expect(redeemLinkCode(wrong, USER, CHAT).ok).toBe(false);
    expect(redeemLinkCode(code, USER, CHAT).ok).toBe(false);
    expect(linkStatus().pendingCode).toBe(false);
  });

  it('rejects an expired code', () => {
    const t0 = 1_000_000;
    const { code } = createLinkCode(t0);
    expect(redeemLinkCode(code, USER, CHAT, t0 + CODE_TTL_MS)).toEqual({ ok: false, reason: 'invalid or expired code' });
    expect(isLinkedIdentity(USER, CHAT)).toBe(false);
  });

  it('does not count malformed input as an attempt', () => {
    createLinkCode();
    expect(redeemLinkCode('nope', USER, CHAT).ok).toBe(false);
    expect(all<{ code_attempts: number }>('SELECT code_attempts FROM telegram_links')[0].code_attempts).toBe(0);
  });

  it('refuses a second link while one is active, and revoke purges chat identifiers', () => {
    const { code } = createLinkCode();
    redeemLinkCode(code, USER, CHAT);
    expect(() => createLinkCode()).toThrow(LinkError);
    expect(revokeLink()).toBe(true);
    expect(isLinkedIdentity(USER, CHAT)).toBe(false);
    expect(all<{ telegram_user_id: number | null; telegram_chat_id: number | null }>(
      "SELECT telegram_user_id, telegram_chat_id FROM telegram_links WHERE status='REVOKED'")[0])
      .toEqual({ telegram_user_id: null, telegram_chat_id: null });
    expect(revokeLink()).toBe(false);
  });

  it('status never exposes chat identifiers or the code', () => {
    const { code } = createLinkCode();
    redeemLinkCode(code, USER, CHAT);
    const s = JSON.stringify(linkStatus());
    expect(s).not.toContain(String(USER));
    expect(s).not.toContain(String(CHAT));
    expect(s).not.toContain(code);
  });
});
