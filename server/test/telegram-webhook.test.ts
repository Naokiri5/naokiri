import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { closeDb, openDb, all } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { createLinkCode, redeemLinkCode } from '../src/integrations/telegram/link.js';
import { getControl } from '../src/core/mode.js';
import { parseCommand } from '../src/integrations/telegram/commands.js';

const SECRET = 'test-secret_123';
let app: Awaited<ReturnType<typeof import('../src/index.js').buildApp>>;
let updateSeq = 500_000;
let chatSeq = 7_000;
const OWNER_USER = 111;

type Out = { status: string; text: string };
const outbox = (): Out[] => all<Out>('SELECT status, text FROM telegram_outbox ORDER BY created_at');
const hook = (body: unknown, secret: string = SECRET) => app.inject({
  method: 'POST', url: '/api/integrations/telegram/webhook',
  headers: { 'x-telegram-bot-api-secret-token': secret }, payload: body as object,
});
const msg = (text: string, from: number, chat: number, type = 'private', date = Math.floor(Date.now() / 1000)) => ({
  update_id: ++updateSeq,
  message: { message_id: updateSeq, date, text, from: { id: from, is_bot: false, first_name: 'o' }, chat: { id: chat, type } },
});

describe('Telegram webhook (MIA-TG-01)', () => {
  beforeEach(async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    closeDb(); openDb(':memory:'); app = await buildApp();
  });
  afterAll(() => { delete process.env.TELEGRAM_WEBHOOK_SECRET; closeDb(); });

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
    expect(outbox().at(-1)!.text).toMatch(/Resume only in the MIA app/);
    expect(getControl().pausedNewOrders).toBe(true);
    expect(all<{ action: string }>("SELECT action FROM audit_log WHERE action='control.update'").length).toBeGreaterThan(0);
    await hook(msg('/resume', OWNER_USER, chat));
    expect(getControl().pausedNewOrders).toBe(true);
    expect(outbox().at(-1)!.text).toMatch(/Not supported over Telegram/);
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

  it('parses commands with an optional @bot suffix and rejects plain text', () => {
    expect(parseCommand('/status@MiaBot')).toEqual({ cmd: 'status', arg: '' });
    expect(parseCommand('/link ABCDEFGH')).toEqual({ cmd: 'link', arg: 'ABCDEFGH' });
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});
