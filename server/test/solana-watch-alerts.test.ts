import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { config } from '../src/config.js';
import { all, run } from '../src/db/db.js';
import { setSetting } from '../src/core/settings.js';
import { notify } from '../src/notify/notify.js';
import { market } from '../src/market/store.js';
import { refreshBackground } from '../src/market/fabric.js';
import { _resetProviderBlocks } from '../src/providers/http.js';
import '../src/providers/pending.js'; // registers the telegram provider used by notify()
import { failureGate } from '../src/core/ratelimit.js';
import { buildApp } from '../src/index.js';
import { _resetMintChecks } from '../src/solana/mintChecks.js';
import { TOKEN_PROGRAM } from '../src/solana/mint-audit.js';
import { alertNewWatchRows, watchAlertText, watchAlertStatus, _resetWatchAlerts, WATCH_ALERT_SOURCE, WATCH_ALERT_REPEAT_MS, WATCH_ALERTS_PER_HOUR, type AlertRow } from '../src/solana/watchAlerts.js';

/** Omega PR-07: opt-in, read-only Solana watchlist alerts. fetch is stubbed; nothing reaches Telegram or Solana. */
const NOW = Date.UTC(2026, 10, 19, 12);
const MINT_A = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const MINT_B = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const mintN = (i: number) => `${'A'.repeat(41)}${B58[Math.floor(i / 58)]}${B58[i % 58]}`;
const row = (mint: string, over: Partial<AlertRow> = {}): AlertRow => ({ mint, symbol: 'TEST', status: 'WATCH', liquidityUsd: 123_456.7, volume1hUsd: 30_000,
  ageMinutes: 12.4, mintCheck: { status: 'PASS_MINT_CHECKS_ONLY', slot: 471_406_626 }, ...over });
const alerts = () => all<{ title: string; body: string; delivery: string }>('SELECT title, body, delivery FROM notifications WHERE source=? ORDER BY ts', WATCH_ALERT_SOURCE);

const realFetch = globalThis.fetch;
let telegramTexts: string[] = [];
let telegramUrls: URL[] = [];
const saved = { offline: config.offline, token: config.telegramBotToken, chat: config.telegramChatId };
beforeEach(() => {
  freshDb(); _resetProviderBlocks(); _resetMintChecks(); _resetWatchAlerts(); telegramTexts = []; telegramUrls = [];
  Object.assign(config, { offline: false, telegramBotToken: 'TEST-BOT-TOKEN', telegramChatId: '12345' });
  globalThis.fetch = (async (u: any) => {
    const url = new URL(String(u));
    if (url.hostname === 'api.telegram.org') { telegramTexts.push(url.searchParams.get('text') ?? ''); telegramUrls.push(url); }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; Object.assign(config, { offline: saved.offline, telegramBotToken: saved.token, telegramChatId: saved.chat }); });
const enable = (on = true) => setSetting('notifyPrefs', { telegramMinSeverity: 'WARNING', quietHoursUtc: null, solanaWatchlistTelegram: on });

describe('Solana watchlist alerts', () => {
  it('are off by default: nothing is stored or sent', async () => {
    expect(alertNewWatchRows([row(MINT_A)], NOW)).toEqual([]);
    enable(false);
    expect(alertNewWatchRows([row(MINT_A)], NOW)).toEqual([]);
    expect(alerts()).toHaveLength(0);
  });
  it('only a WATCH row with a passed on-chain mint check qualifies', () => {
    enable();
    const sent = alertNewWatchRows([
      row(MINT_A),
      row(MINT_B, { status: 'REJECT' }),
      row(mintN(1), { status: 'INSUFFICIENT_DATA' }),
      row(mintN(2), { mintCheck: { status: 'NOT_CHECKED', slot: null } }),
      row(mintN(3), { mintCheck: { status: 'UNKNOWN', slot: 1 } }),
      row(mintN(4), { mintCheck: undefined }),
      row('not-an-address'),
    ], NOW);
    expect(sent).toEqual([MINT_A]);
  });
  it('reaches Telegram on opt-in even though the minimum severity is WARNING, with no links or trading-bot names', async () => {
    enable();
    alertNewWatchRows([row(MINT_A)], NOW);
    await vi.waitFor(() => expect(telegramTexts).toHaveLength(1));
    const text = telegramTexts[0];
    expect(text).toContain(`Mint: ${MINT_A}`);
    expect(text).toContain('Not a trade signal');
    expect(text).toContain('slot 471406626');
    expect(text).not.toMatch(/https?:|t\.me|bonk|axiom|photon|buy now/i);
    expect(telegramUrls[0].searchParams.get('link_preview_options')).toBe('{"is_disabled":true}'); // no preview cards, ever
  });
  it('a ticker that Telegram would turn into a link, mention or command is withheld (review fix)', async () => {
    enable();
    const evil = ['jup.ag/swap', '@BonkBot', '/start', 'pump.fun/x', 'U\u0405DC', 'TOOLONGTICKERNAME12'];
    alertNewWatchRows(evil.map((symbol, i) => row(mintN(i + 30), { symbol })), NOW);
    await vi.waitFor(() => expect(telegramTexts).toHaveLength(5)); // hourly cap: 5 of 6
    for (const t of telegramTexts) {
      expect(t).toMatch(/^\[MIA INFO\] Solana watchlist: ticker withheld\n/);
      expect(t).not.toMatch(/jup\.ag|@|\/start|pump\.fun/);
      expect(t).toContain('identify the token by its mint address');
    }
    expect(watchAlertText(row(MINT_A)).title).toBe('Solana watchlist: TEST');
  });
  it('records the last run, and a storage failure becomes a visible status instead of disappearing (review fix)', () => {
    enable();
    alertNewWatchRows([row(MINT_A)], NOW);
    expect(watchAlertStatus()).toMatchObject({ enabled: true, lastRunAt: NOW, lastError: null });
    run('DROP TABLE notifications');
    expect(alertNewWatchRows([row(MINT_B)], NOW + 1)).toEqual([]);
    expect(watchAlertStatus().lastError).toMatch(/no such table/);
  });
  it('without the opt-in flag an INFO notification still stays out of Telegram (no change to existing behavior)', async () => {
    notify('INFO', 'Paper entry: X', 'body', 'oms');
    await new Promise((r) => setTimeout(r, 20));
    expect(telegramTexts).toHaveLength(0);
  });
  // One clock for the code under test and for notify(), which stamps rows with Date.now() (review fix).
  it('alerts a mint once per 24 hours, matching the mint exactly', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    enable();
    expect(alertNewWatchRows([row(MINT_A)], NOW)).toEqual([MINT_A]);
    vi.setSystemTime(NOW + 60_000);
    expect(alertNewWatchRows([row(MINT_A)], NOW + 60_000)).toEqual([]);
    vi.setSystemTime(NOW + WATCH_ALERT_REPEAT_MS + 60_000);
    expect(alertNewWatchRows([row(MINT_A)], NOW + WATCH_ALERT_REPEAT_MS + 60_000)).toEqual([MINT_A]);
  });
  it('sends at most 5 per hour', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    enable();
    const rows = Array.from({ length: 8 }, (_, i) => row(mintN(i + 10)));
    expect(alertNewWatchRows(rows, NOW)).toHaveLength(WATCH_ALERTS_PER_HOUR);
    vi.setSystemTime(NOW + 1000);
    expect(alertNewWatchRows(rows, NOW + 1000)).toHaveLength(0);
    vi.setSystemTime(NOW + 3600_000 + 1000);
    expect(alertNewWatchRows(rows, NOW + 3600_000 + 1000)).toHaveLength(3);
  });
});

describe('settings and wiring', () => {
  it('the setting defaults to off, can be turned on, and an older client payload turns it off', async () => {
    failureGate.reset();
    const app = await buildApp();
    try {
      const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('alerts owner') })).headers['set-cookie']).split(';')[0];
      const h = { cookie, 'content-type': 'application/json', 'x-mia-csrf': '1' };
      expect((await app.inject({ url: '/api/settings', headers: { cookie } })).json().notifyPrefs.solanaWatchlistTelegram).toBe(false);
      expect((await app.inject({ method: 'POST', url: '/api/settings/notify', headers: h, payload: { telegramMinSeverity: 'WARNING', quietHoursUtc: null, solanaWatchlistTelegram: true } })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/settings', headers: { cookie } })).json().notifyPrefs.solanaWatchlistTelegram).toBe(true);
      await app.inject({ method: 'POST', url: '/api/settings/notify', headers: h, payload: { telegramMinSeverity: 'WARNING', quietHoursUtc: null } });
      expect((await app.inject({ url: '/api/settings', headers: { cookie } })).json().notifyPrefs.solanaWatchlistTelegram).toBe(false);
    } finally { await app.close(); }
  });
  it('the background refresh sends one alert after a real DEX refresh and a passing mint check', async () => {
    enable();
    const RPC = 'https://rpc.example.com/';
    const envUrl = process.env.MIA_SOLANA_RPC_URL; process.env.MIA_SOLANA_RPC_URL = RPC;
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const revoked = { owner: TOKEN_PROGRAM, executable: false, lamports: 1, data: { parsed: { type: 'mint', info: { decimals: 6, supply: '1', isInitialized: true, mintAuthority: null, freezeAuthority: null } } } };
    try {
      market.reset(); const t = Date.now(); market.cgFetchedAt = t; market.fxFetchedAt = t; market.dexFetchedAt = 0;
      globalThis.fetch = (async (u: any) => {
        const url = String(u); const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('token-profiles')) return json([{ chainId: 'solana', tokenAddress: MINT_A }]);
        if (url.includes('/tokens/v1/solana/')) return json([{ chainId: 'solana', dexId: 'raydium', pairAddress: USDC, priceUsd: '1', liquidity: { usd: 100_000 }, fdv: 100_000,
          volume: { h1: 30_000, h24: 90_000 }, txns: { h1: { buys: 35, sells: 15 }, h24: { buys: 100, sells: 50 } }, priceChange: { h1: 4, h24: 5 }, pairCreatedAt: Date.now() - 60_000,
          baseToken: { address: MINT_A, symbol: 'AAA', name: 'A' }, quoteToken: { address: USDC, symbol: 'USDC' } }]);
        if (url === RPC) return json({ result: { context: { slot: 9 }, value: [revoked] } });
        if (url.includes('api.telegram.org')) { telegramTexts.push(new URL(url).searchParams.get('text') ?? ''); return json({ ok: true }); }
        return new Response('{}', { status: 404 });
      }) as typeof fetch;
      await refreshBackground();
      await vi.waitFor(() => expect(alerts()).toHaveLength(1));
      expect(alerts()[0].body).toContain(`Mint: ${MINT_A}`);
      await vi.waitFor(() => expect(telegramTexts.some((x) => x.includes(MINT_A))).toBe(true));
    } finally { if (envUrl === undefined) delete process.env.MIA_SOLANA_RPC_URL; else process.env.MIA_SOLANA_RPC_URL = envUrl; }
  });
});
