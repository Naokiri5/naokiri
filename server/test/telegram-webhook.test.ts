import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { closeDb, openDb, all, get, run } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { config } from '../src/config.js';
import { createLinkCode, linkForIdentity, linkStatus, redeemLinkCode } from '../src/integrations/telegram/link.js';
import { drainOutbox, sendViaBotApi } from '../src/integrations/telegram/webhook.js';
import { ownerSetupPayload } from './helpers.js';
import { getControl } from '../src/core/mode.js';
import { bus } from '../src/core/bus.js';
import { parseCommand } from '../src/integrations/telegram/commands.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';

const SECRET = 'test-secret_123';
let app: Awaited<ReturnType<typeof import('../src/index.js').buildApp>>;
let updateSeq = 500_000;
let chatSeq = 7_000;
const OWNER_USER = 111;

type Out = { status: string; text: string };
const outbox = (): Out[] => all<Out>('SELECT status, text FROM telegram_outbox ORDER BY created_at, rowid');
const hook = (body: unknown, secret: string = SECRET) => app.inject({
  method: 'POST', url: '/api/integrations/telegram/webhook',
  headers: { 'x-telegram-bot-api-secret-token': secret }, payload: body as object,
});
const msg = (text: string | undefined, from: number, chat: number, type = 'private', date = Math.floor(Date.now() / 1000)) => ({
  update_id: ++updateSeq,
  message: { message_id: updateSeq, date, text, from: { id: from, is_bot: false, first_name: 'o' }, chat: { id: chat, type } },
});

describe('Telegram webhook (MIA-TG-01)', () => {
  beforeEach(async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    closeDb(); openDb(':memory:'); app = await buildApp();
  });
  afterEach(async () => { await app.close(); delete process.env.TELEGRAM_WEBHOOK_SECRET; closeDb(); });

  it('is disabled (404) when no valid secret is configured', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = '';
    expect((await hook(msg('/help', OWNER_USER, chatSeq++))).statusCode).toBe(404);
  });

  it('rejects a wrong secret header with 401 and queues nothing', async () => {
    const r = await hook(msg('/help', OWNER_USER, chatSeq++), 'wrong');
    expect(r.statusCode).toBe(401);
    expect(outbox()).toHaveLength(0);
  });

  it('answers an unlinked sender without disclosing account data', async () => {
    const chat = chatSeq++;
    expect((await hook(msg('/status', OWNER_USER, chat))).statusCode).toBe(200);
    const [reply] = outbox();
    expect(reply.text).toMatch(/Not linked/);
    expect(reply.text).not.toMatch(/Mode|Equity|position/i);
  });

  it('links through /link, then serves read-only status to the linked identity only', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    await hook(msg(`/link ${code}`, OWNER_USER, chat));
    expect(outbox().at(-1)!.text).toMatch(/Linked/);
    await hook(msg('/status', OWNER_USER, chat));
    expect(outbox().at(-1)!.text).toMatch(/PAPER/);
    // A different user in the same chat, or the owner in another chat, gets nothing.
    await hook(msg('/status', 999, chat));
    expect(outbox().at(-1)!.text).toMatch(/Not linked/);
    await hook(msg('/status', OWNER_USER, chatSeq++));
    expect(outbox().at(-1)!.text).toMatch(/Not linked/);
  });

  it('prunes expired update records when the listener has no replies to send', async () => {
    const update = msg(undefined, OWNER_USER, chatSeq++);
    expect((await hook(update)).json()).toEqual({ ok: true, ignored: true });
    expect(outbox()).toHaveLength(0);
    run('INSERT INTO telegram_update_dedupe(update_id, received_at) VALUES (?, ?)', 1, Date.now() - 8 * 86_400_000);

    await app.listen({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(all('SELECT update_id FROM telegram_update_dedupe')).toEqual([{ update_id: update.update_id }]);
  });

  it('reports whether the current Paper risk policy is valid and accepted', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    const status = async () => {
      expect((await hook(msg('/status', OWNER_USER, chat))).statusCode).toBe(200);
      return outbox().at(-1)?.text;
    };

    expect(await status()).toContain('Policy accepted: no.');
    acceptPolicy('owner', DEFAULT_POLICY);
    expect(await status()).toContain('Policy accepted: yes.');
    run('INSERT INTO risk_policy_versions(version, policy, created_at, accepted_by) VALUES (2, ?, 0, ?)', '{}', 'fixture');
    expect(await status()).toContain('Policy accepted: no.');
  });

  it('ignores a retried update_id (exactly-once side effects)', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    const update = msg('/help', OWNER_USER, chat);
    await hook(update);
    const before = outbox().length;
    const r = await hook(update);
    expect(r.json()).toEqual({ ok: true, duplicate: true });
    expect(outbox().length).toBe(before);
  });

  it('retries a rolled-back pause at the rate limit and publishes only the committed mode', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const modeEvent = vi.fn();
    bus.on('mode', modeEvent);
    try {
      for (let used = 0; used < 9; used++) {
        expect((await hook(msg('/help', OWNER_USER, chat))).json()).toEqual({ ok: true });
      }
      const update = msg('/pause', OWNER_USER, chat);
      run("CREATE TEMP TRIGGER fail_telegram_reply BEFORE INSERT ON telegram_outbox BEGIN SELECT RAISE(ABORT, 'fixture'); END");
      expect((await hook(update)).statusCode).toBe(500);
      expect(getControl().pausedNewOrders).toBe(false);
      expect(get('SELECT update_id FROM telegram_update_dedupe WHERE update_id=?', update.update_id)).toBeUndefined();
      expect(modeEvent).not.toHaveBeenCalled();
      run('DROP TRIGGER fail_telegram_reply');

      expect((await hook(update)).json()).toEqual({ ok: true });
      expect(getControl().pausedNewOrders).toBe(true);
      expect(outbox()).toHaveLength(10);
      expect(modeEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pausedNewOrders: true }));
      expect((await hook(msg('/help', OWNER_USER, chat))).json()).toEqual({ ok: true, ignored: true, reason: 'rate limited' });
    } finally {
      bus.off('mode', modeEvent);
      now.mockRestore();
    }
  });
  it('ignores group chats and stale messages', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    expect((await hook(msg('/status', OWNER_USER, chat, 'group'))).json().ignored).toBe(true);
    const stale = Math.floor(Date.now() / 1000) - 3_600;
    expect((await hook(msg('/status', OWNER_USER, chat, 'private', stale))).json().reason).toBe('stale');
    expect(outbox()).toHaveLength(0);
  });

  it('/pause from the linked chat pauses NEW entries and is audited; /resume is denied', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    await hook(msg('/pause', OWNER_USER, chat));
    expect(getControl().pausedNewOrders).toBe(true);
    expect(all<{ action: string }>("SELECT action FROM audit_log WHERE action='control.update'").length).toBeGreaterThan(0);
    expect(outbox()).toEqual([expect.objectContaining({ text: expect.stringMatching(/Resume only in the MIA app/) })]);
    await hook(msg('/resume', OWNER_USER, chat));
    expect(getControl().pausedNewOrders).toBe(true);
    expect(outbox()).toHaveLength(2);
    expect(outbox()).toContainEqual(expect.objectContaining({ text: expect.stringMatching(/^Not supported over Telegram/) }));
  });

  it('denies trading commands and never echoes their arguments', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    await hook(msg('/buy BTCUSDT 1000', OWNER_USER, chat));
    const reply = outbox().at(-1)!.text;
    expect(reply).toMatch(/Not supported over Telegram/);
    expect(reply).not.toContain('BTCUSDT');
  });

  it('owner endpoints require a session (401 without cookie)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/integrations/telegram/status' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/integrations/telegram/link/start', headers: { 'x-mia-csrf': '1' }, payload: { password: 'x' } })).statusCode).toBe(401);
  });

  it('requires owner session and CSRF to cancel a pending code, and preserves an active link', async () => {
    const password = 'telegram test passphrase';
    const session = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload(password) });
    expect(session.statusCode).toBe(200);
    const cookie = session.cookies.find(({ name }) => name === 'mia_session');
    expect(cookie).toBeDefined();
    const headers = { cookie: `mia_session=${cookie!.value}` };
    const cancel = (requestHeaders: Record<string, string>) => app.inject({
      method: 'POST', url: '/api/integrations/telegram/link/cancel', headers: requestHeaders,
    });
    const ownerHeaders = { ...headers, 'x-mia-csrf': '1' };
    const chat = chatSeq++;
    const { code } = createLinkCode();

    expect((await cancel({ 'x-mia-csrf': '1' })).statusCode).toBe(401);
    expect((await cancel(headers)).statusCode).toBe(403);
    expect(linkStatus().pendingCode).toBe(true);
    expect((await cancel(ownerHeaders)).json()).toEqual({ ok: true, canceled: true });
    expect(linkStatus().pendingCode).toBe(false);
    expect(redeemLinkCode(code, OWNER_USER, chat).ok).toBe(false);

    expect(redeemLinkCode(createLinkCode().code, OWNER_USER, chat).ok).toBe(true);
    expect((await cancel(ownerHeaders)).json()).toEqual({ ok: true, canceled: false });
    expect(linkForIdentity(OWNER_USER, chat)).toBeDefined();
  });

  it('clears queued account replies on unlink and still sends public replies', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    await hook(msg('/risk', OWNER_USER, chat));
    await hook(msg('/help', OWNER_USER, chat));
    await hook(msg('/unlink', OWNER_USER, chat));

    expect(outbox()[0]).toEqual({ status: 'FAILED', text: '' });
    const send = vi.fn(async () => {});
    expect(await drainOutbox(send)).toBe(2);
    expect(send.mock.calls).toEqual(expect.arrayContaining([
      [chat, expect.stringMatching(/^MIA paper-trading bot/)],
      [chat, expect.stringMatching(/^Unlinked/)],
    ]));
  });

  it('revalidates the original active link before delivering an account reply', async () => {
    const chat = chatSeq++;
    const { code } = createLinkCode();
    redeemLinkCode(code, OWNER_USER, chat);
    await hook(msg('/positions', OWNER_USER, chat));
    run("UPDATE telegram_links SET status='REVOKED'"); // Simulate a stale queued row after an administrative change.
    const replacement = createLinkCode();
    redeemLinkCode(replacement.code, OWNER_USER, chat);

    const send = vi.fn(async () => {});
    await drainOutbox(send);
    expect(send).not.toHaveBeenCalled();
    expect(outbox()).toEqual([{ status: 'FAILED', text: '' }]);
  });

  it('runs one drain at a time and retries a due reply without a new command', async () => {
    await hook(msg('/help', OWNER_USER, chatSeq++));
    let failDelivery!: (err: Error) => void;
    const inflight = new Promise<void>((_, reject) => { failDelivery = reject; });
    const first = drainOutbox(() => inflight);
    const send = vi.fn(async () => {});
    expect(await drainOutbox(send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
    failDelivery(new Error('fixture'));
    expect(await first).toBe(1);

    const retryAt = get<{ next_attempt_at: number }>('SELECT next_attempt_at FROM telegram_outbox')!.next_attempt_at;
    expect(await drainOutbox(send, retryAt - 1)).toBe(0);
    expect(await drainOutbox(send, retryAt)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox()[0].status).toBe('PROVIDER_ACCEPTED');
  });

  it('sends replies only to the configured Bot API endpoint without following redirects', async () => {
    const originalToken = config.telegramBotToken;
    const fetchStub = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchStub);
    config.telegramBotToken = 'test-token';
    try {
      await sendViaBotApi(321, 'Guardian alert fixture');
      expect(fetchStub).toHaveBeenCalledExactlyOnceWith('https://api.telegram.org/bottest-token/sendMessage', expect.objectContaining({
        method: 'POST', redirect: 'error',
        body: JSON.stringify({ chat_id: 321, text: 'Guardian alert fixture', disable_web_page_preview: true }),
      }));
    } finally {
      config.telegramBotToken = originalToken;
      vi.unstubAllGlobals();
    }
  });

  it('never starts Telegram delivery in offline mode even with a configured token', async () => {
    const originalToken = config.telegramBotToken;
    const fetchStub = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchStub);
    config.telegramBotToken = 'test-token';
    try {
      await app.close();
      app = await buildApp();
      await hook(msg('/help', OWNER_USER, chatSeq++));
      await app.listen({ host: '127.0.0.1', port: 0 });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fetchStub).not.toHaveBeenCalled();
      expect(outbox()[0].status).toBe('QUEUED');
    } finally {
      config.telegramBotToken = originalToken;
      vi.unstubAllGlobals();
    }
  });

  it('parses commands with an optional @bot suffix and rejects plain text', () => {
    expect(parseCommand('/status@MiaBot')).toEqual({ cmd: 'status', arg: '' });
    expect(parseCommand('/link ABCDEFGH')).toEqual({ cmd: 'link', arg: 'ABCDEFGH' });
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});
