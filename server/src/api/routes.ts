import { ditasRoutes } from '../ditas/routes.js';
import { knowledgeRoutes } from '../knowledge/routes.js';
import { analyzeChart } from '../chart/analysis.js';
import { replayChart } from '../chart/replay.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as auth from './auth.js';
import * as privy from '../security/privy.js';
import * as totp from '../security/totp.js';
import { authMode, passphraseSignInAllowed, stepUpMethod, verifyStepUp } from '../security/stepUp.js';
import { createBackup } from '../ops/backup.js';
import { bus } from '../core/bus.js';
import { market } from '../market/store.js';
import { board, rejections, recentDecisions, analyzeInstrument, dexBoard } from '../market/scanner.js';
import { bubbleMap } from '../market/bubbles.js';
import { isEligibleSpot } from '../market/fabric.js';
import { assessQuality, bookImpact } from '../market/quality.js';
import { assessCexAsset } from '../safety/safety.js';
import { classifyRegime } from '../regime/regime.js';
import { readIndicators, INDICATOR_SPECIALISTS } from '../workers/indicators.js';
import { WORKERS, DOMAINS, REQUIRED_DOMAINS } from '../workers/registry.js';
import { POOL, quarantined, releaseQuarantine } from '../workers/runtime.js';
import { workerEffectiveness } from '../workers/effectiveness.js';
import { overviewSnapshot } from '../dashboard/overview.js';
import { QCI_POLICY, DOMAIN_WEIGHTS } from '../qci/coordinator.js';
import { providers } from '../providers/http.js';
import { latencyReport } from '../core/latency.js';
import { getControl, updateControl, displayMode } from '../core/mode.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY, policyHistory } from '../risk/policy.js';
import { accountState, ledger, PAPER_ACCOUNT, openPositions } from '../portfolio/ledger.js';
import { correlation } from '../portfolio/correlation.js';
import { calendar, reconcile } from '../portfolio/calendar.js';
import * as oms from '../exec/oms.js';
import { listIncidents, acknowledgeIncident, IncidentError } from '../exec/incidents.js';
import { listJournal } from '../journal/journal.js';
import { recentNews, refreshNews } from '../news/news.js';
import { recentPrints, printThreshold } from '../whales/prints.js';
import { getWinCopyStatus, followOneWalletReadOnly, unfollowWalletReadOnly, recentWhaleObservations, getWinReadOnlyProfile } from '../whales/winRegistry.js';
import { reconstructReadOnlyDeepFootprints } from '../whales/winDeep.js';
import * as lab from '../lab/lab.js';
import { STRATEGIES } from '../lab/strategies.js';
import * as wallet from '../wallet/wallet.js';
import { listNotifications, markRead, notify } from '../notify/notify.js';
import { releaseGates } from '../qa/gates.js';
import { recentAudit, verifyAuditChain } from '../core/audit.js';
import { botStatus, botStatusView } from '../bot/bot.js';
import { readiness } from '../ops/readiness.js';
import { askJoe, chatHistory, dailyBriefing, JOE_TOOL_NAMES } from '../joe/joe.js';
import { all, get, P } from '../db/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { audit } from '../core/audit.js';
import { config, inContainer } from '../config.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { qhefReport } from '../qhef/qhef.js';
import { securityOverview, revokeOtherSessions } from '../security/security.js';
import { discover } from '../market/discover.js';
import { tradingHistory, toCsv, type HistoryFilter } from '../journal/history.js';
import { provider, ProviderError } from '../providers/http.js';
import { limiter, RateLimitError } from '../core/ratelimit.js';
import { sha256 } from '../core/util.js';

const COOKIE = 'mia_session';
const tokenOf = (req: FastifyRequest) => (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const bad = (reply: FastifyReply, code: number, msg: string) => reply.code(code).send({ error: msg });
/** Step-up shares the login brute-force limits (per client + global), so it can no longer be guessed freely. */
const stepUp = (req: FastifyRequest, body: any) => verifyStepUp(
  // Legacy API clients still use the "password" field for their step-up
  // entry; in Privy mode that field is ONLY an authenticator code, never the
  // original passphrase. Canonical verifier decides based on server auth mode.
  authMode() === 'privy' ? { otp: body?.otp ?? body?.password } : { password: body?.password },
  'session:' + sha256(tokenOf(req) ?? '')
);
const passphraseOnly = () => {
  if (!passphraseSignInAllowed()) throw httpError(403, 'passphrase authentication is disabled; connect a wallet with Privy');
};
const PW = z.string().min(1).max(1024);
const INTERVAL = z.enum(['15m', '1h', '4h']);
/** Path ids and short query tokens: one string, bounded. Repeated query keys (arrays) are rejected as 400, never bound to SQL. */
const ID = z.string().min(1).max(150);
const idOf = (req: FastifyRequest) => z.object({ id: ID }).parse(req.params).id;
const TOKEN = z.string().trim().min(1).max(60);
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');
const httpError = (code: number, msg: string) => Object.assign(new Error(msg), { statusCode: code });
/** Programming/infrastructure faults: these are server errors (500, logged), never "bad request". */
const isServerFault = (e: any) => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError
  || /^ERR_SQLITE|^SQLITE/.test(String(e?.code ?? '')) || /SQLITE_|database is locked/i.test(String(e?.message ?? ''));
// Per-session budgets for routes that call paid APIs, many upstream endpoints, or run long CPU work.
const LIMITS = { joe: limiter(10, 5), backtest: limiter(6, 2), analyze: limiter(30, 10), instrument: limiter(60, 20), news: limiter(4, 2) };

export async function routes(app: FastifyInstance) {
  /**
   * Error classification: 400 validation · 401/403/404/409/429 typed errors · 502/503 upstream provider failures ·
   * 500 for programming/database faults (logged with the request id, internal message NOT sent to the client).
   * Other plain Errors are business-rule rejections ("cannot remove more than available paper cash") → 400.
   * Previously every error, including crashes, became 400 and nothing was logged.
   */
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    if (err instanceof RateLimitError) return reply.code(429).header('retry-after', String(err.retryAfterSec)).send({ error: err.message });
    // This is an upstream identity verification outage, not an incorrect owner token or a MIA code crash.
    // Preserve retryable 503 without echoing key material, JWTs or verifier internals to the browser.
    if (err instanceof privy.PrivyVerificationUnavailable) {
      req.log.warn({ requestId: req.id }, 'Privy identity verification service unavailable');
      return reply.code(503).send({ error: 'Privy verification is unavailable. Retry when the service recovers.' });
    }
    if (err instanceof ProviderError) {
      req.log.warn({ provider: err.providerId, status: err.status }, 'upstream provider failure');
      return reply.code(err.status === 404 ? 404 : err.status === 429 ? 503 : 502).send({ error: `upstream market-data provider unavailable (${err.providerId})` });
    }
    if (err instanceof oms.OmsError) return reply.code(409).send({ error: err.message });
    if (err instanceof IncidentError) return reply.code(err.statusCode).send({ error: err.message });
    if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: String(err.message ?? err) });
    if (isServerFault(err) || (Number.isInteger(err?.statusCode) && err.statusCode >= 500)) {
      req.log.error({ err }, 'unhandled server error');
      return reply.code(500).send({ error: 'internal server error', requestId: req.id });
    }
    return reply.code(400).send({ error: String(err?.message ?? err) });
  });
  /**
   * Route-aware authentication and CSRF: only enumerated bootstrap/login/status endpoints are public.
   * NEVER exempt the entire /api/auth/* namespace: a future owner-management endpoint could otherwise
   * become publicly callable. Use Fastify's matched route (not the raw, potentially encoded URL).
   * Existing bootstrap/login clients may submit without the CSRF header; they cannot modify an
   * authenticated session other than issuing a new, verified owner login. Logout and every other
   * state-changing endpoint require the CSRF header, including future /api/auth/* endpoints.
   */
  const publicRoutes = new Set([
    '/api/health', '/api/ready',
    '/api/auth/state', '/api/auth/privy/config',
    '/api/auth/setup', '/api/auth/login', '/api/auth/privy/login', '/api/auth/logout',
  ]);
  const csrfExemptSignIn = new Set(['/api/auth/setup', '/api/auth/login', '/api/auth/privy/login']);
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions?.url ?? '';
    if (!publicRoutes.has(route) && !auth.validSession(tokenOf(req)))
      return bad(reply, 401, 'authentication required');
    if (req.method !== 'GET' && !csrfExemptSignIn.has(route) && req.headers['x-mia-csrf'] !== '1')
      return bad(reply, 403, 'missing CSRF header');
  });
  const limit = (req: FastifyRequest, l: keyof typeof LIMITS, what: string) => LIMITS[l].take(sha256(tokenOf(req) ?? req.ip), what);

  await ditasRoutes(app);
  await knowledgeRoutes(app);
  // ── protection incidents (persistent; owner acknowledgement) ──
  app.get('/api/risk/incidents', async (req) => listIncidents(z.object({ all: z.enum(['0', '1']).default('0') }).parse(req.query).all === '1'));
  app.post('/api/risk/incidents/:id/ack', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(80) }).parse(req.params);
    const { note } = z.object({ note: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
    return acknowledgeIncident('owner', id, note);
  });

  // ── auth ──
  // Readiness (unauthenticated, states and ages only): 200 when every check passes, 503 otherwise.
  app.get('/api/ready', async (_req, reply) => { const r = readiness(botStatus); return reply.code(r.ready ? 200 : 503).send(r); });
  app.get('/api/health', async () => ({ ok: true, version: '4.1.0', schema: SCHEMA_VERSION, setup: auth.isSetup(), offline: config.offline }));
  app.get('/api/auth/state', async (req) => ({
    mode: authMode(), setup: auth.isSetup(), authenticated: auth.validSession(tokenOf(req)),
    privy: privy.privyPublicConfig(),
    ...(auth.validSession(tokenOf(req)) ? { stepUp: stepUpMethod() } : {}),
  }));
  app.post('/api/auth/setup', async (req, reply) => {
    // First-run setup is only accepted from this machine: on a 0.0.0.0 bind any visitor could otherwise claim ownership.
    // Containers/Codespaces reach MIA through a port forwarder (never loopback), so they are allowed too.
    passphraseOnly();
    if (!auth.isSetup() && !isLoopback(req.ip) && !inContainer() && process.env.MIA_ALLOW_REMOTE_SETUP !== '1') throw httpError(403, 'first-time setup must be done from the machine running MIA (open http://localhost:' + config.port + '/), or set MIA_ALLOW_REMOTE_SETUP=1');
    const { password } = z.object({ password: PW }).parse(req.body); auth.setupOwner(password); return issue(reply, auth.login(password, req.ip));
  });
  app.post('/api/auth/login', async (req, reply) => {
    passphraseOnly();
    const { password } = z.object({ password: PW }).parse(req.body);
    return issue(reply, auth.login(password, req.ip));
  });
  // Real Privy identity verification: never trust an address, a client-side
  // "connected" flag, or a browser-supplied owner role.
  app.post('/api/auth/privy/login', async (req, reply) => {
    if (authMode() !== 'privy') throw httpError(403, 'wallet login is disabled in offline recovery mode');
    const { accessToken } = z.object({ accessToken: z.string().min(20).max(4096) }).strict().parse(req.body);
    const token = await privy.loginWithPrivy(accessToken, req.ip, { backup: () => { createBackup(); } });
    return issue(reply, token);
  });
  app.get('/api/auth/privy/config', async () => privy.privyPublicConfig());
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${config.secureCookie ? '; Secure' : ''}`;
  app.post('/api/auth/logout', async (req, reply) => { auth.logout(tokenOf(req)); reply.header('set-cookie', `${COOKIE}=; ${cookieFlags}; Max-Age=0`); return { ok: true }; });
  app.post('/api/settings/password', async (req) => {
    passphraseOnly();
    const b = z.object({ current: PW, next: PW }).parse(req.body);
    auth.changePassword(b.current, b.next, req.ip); return { ok: true };
  });
  app.get('/api/security/2fa', async () => totp.twoFactorStatus());
  app.post('/api/security/2fa/begin', async (req) => {
    const input = z.object({
      consoleCode: z.string().max(64).optional(), otp: z.string().max(16).optional(),
      password: z.string().max(1024).optional(),
    }).strict().parse(req.body ?? {});
    // Never regard a proxy/forwarded source address as independent physical
    // control of the server. Initial enrollment needs the server console code.
    return totp.beginEnrollment(
      { consoleCode: input.consoleCode, otp: input.otp, ...(passphraseSignInAllowed() ? { password: input.password } : {}) },
      'session:' + sha256(tokenOf(req) ?? ''), { directLocal: false, log: (line) => app.log.warn(line) }
    );
  });
  app.post('/api/security/2fa/confirm', async (req) => {
    const { otp } = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
    return totp.confirmEnrollment(otp, 'session:' + sha256(tokenOf(req) ?? ''));
  });
  function issue(reply: FastifyReply, token: string) { reply.header('set-cookie', `${COOKIE}=${token}; ${cookieFlags}; Max-Age=43200`); return { ok: true }; }

  // ── live stream (SSE) ──
  let streams = 0;
  app.get('/api/stream', (req, reply) => {
    if (streams >= 20) return bad(reply, 503, 'too many open live streams');
    const token = tokenOf(req);
    reply.hijack(); // we own the raw socket from here; Fastify must not try to send a second response
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff', 'x-request-id': String(req.id) });
    streams++;
    reply.raw.write(': connected\n\n');
    let closed = false; let backlog = 0;
    const close = () => { if (closed) return; closed = true; streams--; bus.off('*', send); clearInterval(ka); reply.raw.end(); };
    const write = (s: string) => { if (closed) return; if (reply.raw.write(s)) backlog = 0; else if (++backlog > 200) close(); /* stalled client: drop it instead of buffering forever */ };
    const send = (e: { topic: string; payload: unknown }) => write(`event: ${e.topic}\ndata: ${JSON.stringify(e.payload)}\n\n`);
    // Logout, passphrase change and "revoke other sessions" now end open streams at the next keep-alive.
    const ka = setInterval(() => (auth.validSession(token) ? write(': ka\n\n') : close()), 20_000);
    bus.on('*', send);
    req.raw.on('close', close);
  });

  // ── shell / overview ──
  app.get('/api/shell', async () => {
    const ctl = getControl(); const acct = accountState(); const pv = providers(); const gates = releaseGates(); const pol = currentPolicy()?.policy;
    const stale = market.tickersFetchedAt ? Date.now() - market.tickersFetchedAt > 60_000 : true;
    return { mode: ctl.mode, display: displayMode(ctl), control: ctl, bot: botStatusView(), account: { equity: acct.equity, dailyPnlPct: acct.dailyPnlPct, weeklyPnlPct: acct.weeklyPnlPct, drawdownPct: acct.drawdownPct, openRiskPct: acct.openRiskPct, openCount: acct.openCount, deposits: acct.deposits, consecutiveLosses: acct.consecutiveLosses, marksMissing: acct.marksMissing.length },
      policyAccepted: !!pol, riskLimits: pol ? { dailyLossPct: pol.dailyLossPct, weeklyLossPct: pol.weeklyLossPct, drawdownWarnPct: pol.drawdownWarnPct, drawdownHaltPct: pol.drawdownHaltPct, maxOpenRiskPct: pol.maxOpenRiskPct, maxConsecutiveLosses: pol.maxConsecutiveLosses } : null,
      dataHealth: { stale, tickersAt: market.tickersFetchedAt, scanAt: market.lastScanAt, live: pv.filter((p) => p.status === 'LIVE').length, degraded: pv.filter((p) => p.status === 'DEGRADED' || p.status === 'DOWN').length },
      unread: get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE read=0')!.n, gates: gates.summary, liveAllowed: gates.liveAllowed, offline: config.offline, scanIntervalMs: config.scanIntervalMs, tickerIntervalMs: config.tickerIntervalMs, serverTime: Date.now() };
  });
  app.get('/api/overview', async () => overviewSnapshot());

  // ── markets ──
  app.get('/api/markets', async () => ({ tickers: [...market.tickers.values()].filter((t) => t.quoteVolume > 1e6 && isEligibleSpot(t.base, t.quote)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 300), universe: market.universe, asOf: market.tickersFetchedAt }));
  app.get('/api/markets/search', async (req) => { const q = z.object({ q: z.string().max(30).default('') }).parse(req.query).q.toUpperCase(); return [...market.instruments.values()].filter((i) => i.symbol.includes(q) || i.base.startsWith(q)).slice(0, 20).map((i) => ({ id: i.id, symbol: i.symbol, base: i.base })); });
  app.get('/api/instrument/:symbol', async (req, reply) => {
    // Validated BEFORE indexing d.engines: an unknown value (5m, 1d, __proto__) used to crash the handler.
    const { interval: iv } = z.object({ interval: INTERVAL.default('1h') }).parse(req.query ?? {});
    const symbol = z.object({ symbol: z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/) }).parse(req.params).symbol;
    const i = market.bySymbol(symbol);
    // Unknown symbol (catalogue loaded) ⇒ 404. Offline / catalogue still loading is a normal state the page polls
    // through, so it stays 200 with `unavailable` (a 503 every 15 s would read as a fault during every startup).
    if (!i) { const reason = market.instruments.size ? 'Symbol is not a listed Binance spot pair.' : config.offline ? 'Market data is disabled (offline mode).' : 'Market data is still loading — try again in a few seconds.'; return reply.code(market.instruments.size ? 404 : 200).send({ unavailable: true, reason, error: reason }); }
    if (!market.deep.has(i.id) && !config.offline) {
      limit(req, 'instrument', 'loading a new instrument');
      const { refreshDeep } = await import('../market/fabric.js'); await refreshDeep([i.id]);
      if (!market.deep.get(i.id)?.engines['1h'].last) { const reason = 'Market data provider did not return candles for this symbol — try again shortly.'; return reply.code(503).send({ unavailable: true, reason, error: reason }); }
    }
    const d = market.deep.get(i.id);
    const f = d ? { '15m': d.engines['15m'].last, '1h': d.engines['1h'].last, '4h': d.engines['4h'].last } : {};
    return { chartIntelligence: analyzeChart(i.id, iv, d?.engines[iv].candles ?? [], Date.now()), instrument: i, ticker: market.tickers.get(i.id) ?? null, candles: d ? [...d.engines[iv].candles.slice(-300), ...(d.forming[iv] ? [{ ...d.forming[iv], forming: true }] : [])] : [], features: d?.engines[iv].last ?? null,
      book: d?.book ? { bids: d.book.bids.slice(0, 20), asks: d.book.asks.slice(0, 20), ts: d.book.ts } : null, impact: bookImpact(d?.book ?? null, 'buy', 10_000), cross: d?.cross ?? {},
      quality: assessQuality(i.id), safety: assessCexAsset(i.id), regime: classifyRegime(d?.engines['1h'].last ?? null), indicators: readIndicators(f), prints: recentPrints(500).filter((p) => p.instrumentId === i.id).slice(0, 30) };
  });
  // Bounded research-only replay. Uses owner-supplied history and the existing auth/CSRF gate.
  app.post('/api/chart/replay', async (req) => {
    const candle = z.object({ t: z.number().finite().nonnegative(), o: z.number().positive(), h: z.number().positive(), l: z.number().positive(), c: z.number().positive(), v: z.number().nonnegative(), closeTime: z.number().finite().optional() });
    const b = z.object({ instrument: z.string().min(1).max(100), timeframe: z.enum(['15m', '1h', '4h']), candles: z.array(candle).min(1).max(2000), visibleBars: z.number().int().positive().max(2000) }).parse(req.body);
    return replayChart(b.instrument, b.timeframe, b.candles, b.visibleBars);
  });
  app.get('/api/fx', async () => ({ series: market.fx, asOf: market.fxFetchedAt, note: 'ECB daily reference rates via Frankfurter — not tradeable quotes.' }));
  app.get('/api/bubbles', async (req) => bubbleMap(z.object({ limit: z.coerce.number().int().min(1).max(500).default(150), minVolume: z.coerce.number().min(0).default(1e6) }).parse(req.query ?? {})));
  app.get('/api/dex', async () => ({ pairs: dexBoard(), asOf: market.dexFetchedAt, note: 'DEX tokens are never automation-eligible: contract-level honeypot checks require an on-chain provider (pending).' }));

  // ── scanner / decisions ──
  app.get('/api/scanner', async () => ({ board: [...board.values()].sort((a, b) => b.quoteVolume - a.quoteVolume), decisions: recentDecisions().map(slim), rejections: rejections.slice(-150).reverse(), lastScanAt: market.lastScanAt, strategies: STRATEGIES.map((s) => ({ id: s.id, name: s.name, version: s.version, interval: s.interval, regimes: s.suitableRegimes, description: s.description })) }));
  app.get('/api/decisions', async (req) => { const q = z.object({ decision: TOKEN.optional() }).parse(req.query); return all<any>(`SELECT id, instrument, strategy, decision, score, risk_decision, created_at FROM decisions ${q.decision ? 'WHERE decision=?' : ''} ORDER BY created_at DESC LIMIT 300`, ...(q.decision ? [q.decision] : [])); });
  app.get('/api/decisions/:id', async (req, reply) => { const r = get<any>('SELECT report, consensus_id FROM decisions WHERE id=?', idOf(req)); if (!r) return bad(reply, 404, 'not found'); const c = get<any>('SELECT record FROM consensus_records WHERE id=?', r.consensus_id); return { report: P(r.report), consensus: c ? P(c.record) : null }; });
  app.post('/api/analyze', async (req) => { const { symbol, strategyId } = z.object({ symbol: z.string().min(1).max(20), strategyId: z.string().max(60).optional() }).parse(req.body); const i = market.bySymbol(symbol); if (!i) throw httpError(404, 'unknown symbol'); limit(req, 'analyze', 'analysis'); return analyzeInstrument(i.id, strategyId); });

  // ── AI intelligence (workers / QCI) ──
  app.get('/api/intelligence', async () => {
    const stats = new Map(all<any>('SELECT * FROM worker_stats').map((s) => [s.worker_id, s]));
    const recs = all<any>('SELECT id, instrument, state, created_at, record FROM consensus_records ORDER BY created_at DESC LIMIT 40').map((r) => { const x = P<any>(r.record); delete x.packets; return x; });
    return { workers: WORKERS.map((w) => ({ id: w.id, name: w.name, domain: w.domain, version: w.version, dependencyGroup: w.dependencyGroup, sources: w.sourceIds, mandatory: !!w.mandatory, canVeto: !!w.canVeto, quarantined: quarantined.has(w.id), stats: stats.get(w.id) ?? null, capability: w.capability, pending: w.capability === 'PROVIDER_BLOCKED' })),
      effectiveness: workerEffectiveness().summary,
      indicatorSpecialists: [...INDICATOR_SPECIALISTS.map((x) => ({ id: x.id, name: x.s.name, interval: x.iv })), { id: 'IND-49', name: 'EMA20 vs EMA50', interval: '1h' }, { id: 'IND-50', name: 'EMA50 vs EMA200', interval: '4h' }],
      domains: DOMAINS.map((d) => ({ domain: d, weight: DOMAIN_WEIGHTS[d], required: REQUIRED_DOMAINS.includes(d), workers: WORKERS.filter((w) => w.domain === d).length })), policy: QCI_POLICY, pool: POOL, consensus: recs,
      note: 'Workers are deterministic, versioned evaluators running in a bounded pool — not LLM agents. Confidence is NOT_CALIBRATED until walk-forward calibration is performed.' };
  });
  app.get('/api/consensus/:id', async (req, reply) => { const r = get<any>('SELECT record FROM consensus_records WHERE id=?', idOf(req)); return r ? P(r.record) : bad(reply, 404, 'not found'); });
  app.post('/api/workers/:id/release', async (req) => {
    const id = idOf(req); const b = z.object({ password: PW.optional() }).strict().parse(req.body ?? {});
    stepUp(req, b); releaseQuarantine('owner', id); audit('owner', 'worker.release', { id }); return { ok: true };
  });

  // ── risk center ──
  app.get('/api/risk', async () => {
    const acct = accountState(); const pos = openPositions();
    const corr = pos.map((a) => pos.map((b) => correlation(a.instrument, b.instrument)));
    return { policy: currentPolicy(), defaults: DEFAULT_POLICY, history: policyHistory().slice(0, 20), account: acct, control: getControl(), display: displayMode(), positions: pos, correlation: { instruments: pos.map((p) => p.instrument), matrix: corr }, protection: oms.protectPositions(), incidents: listIncidents(), gates: releaseGates() };
  });
  app.post('/api/risk/policy', async (req) => { const b = z.object({ policy: z.unknown(), password: PW.optional() }).strict().parse(req.body ?? {}); stepUp(req, b); return acceptPolicy('owner', b.policy); });
  app.post('/api/control', async (req) => {
    const b = z.object({ mode: z.enum(['OBSERVE', 'PAPER', 'APPROVAL', 'BOUNDED_LIVE']).optional(), pausedNewOrders: z.boolean().optional(), emergency: z.boolean().optional(), disabledStrategies: z.array(z.string().max(60)).max(50).optional(), password: PW.optional() }).parse(req.body);
    const { password, ...patch } = b;
    // Anything that INCREASES risk needs the passphrase: mode changes, clearing an emergency, resuming after a pause,
    // and re-enabling strategies (the last two previously needed only a session).
    const cur = getControl();
    const reEnables = !!patch.disabledStrategies && cur.disabledStrategies.some((s) => !patch.disabledStrategies!.includes(s));
    if (patch.mode || patch.emergency === false || patch.pausedNewOrders === false || reEnables) stepUp(req, b);
    return updateControl('owner', patch, (m) => {
      if (m === 'BOUNDED_LIVE') { const g = releaseGates(); if (!g.liveAllowed) return { ok: false, reason: `BOUNDED_LIVE blocked: ${g.summary}. No live venue adapter or isolated signer exists in this build.` }; }
      if ((m === 'PAPER' || m === 'APPROVAL') && !currentPolicy()) return { ok: false, reason: 'accept a risk policy before enabling paper execution' };
      return { ok: true };
    });
  });
  app.post('/api/emergency/:action', async (req) => {
    const a = z.object({ action: z.string().max(40) }).parse(req.params).action; const b = z.object({ confirm: z.string().max(40).optional(), password: PW.optional() }).strict().parse(req.body ?? {});
    if (a === 'pause') return oms.pauseNewOrders('owner');
    if (a === 'cancel-pending') return oms.cancelPendingEntries('owner');
    if (a === 'protect') return oms.protectPositions(true);
    if (a === 'stop') return oms.emergencyStop('owner');
    if (a === 'close-all') { stepUp(req, b); return oms.closeAllPositions('owner', b.confirm ?? ''); }
    throw httpError(404, 'unknown emergency action');
  });

  // ── bot account / portfolio / orders ──
  app.get('/api/bot', async () => ({ status: botStatusView(), account: accountState(), positions: oms.listPositions('OPEN'), pending: all("SELECT * FROM orders WHERE status='PENDING_APPROVAL' ORDER BY created_at DESC"), strategies: lab.listStrategies(), ledger: all('SELECT * FROM ledger_entries WHERE account=? ORDER BY ts DESC LIMIT 100', PAPER_ACCOUNT) }));
  app.post('/api/bot/allocation', async (req) => {
    const b = z.object({ amount: z.number().positive().max(10_000_000), direction: z.enum(['DEPOSIT', 'WITHDRAW']) }).parse(req.body);
    if (b.direction === 'WITHDRAW' && b.amount > accountState().cash) throw new Error('cannot remove more than available paper cash');
    ledger(PAPER_ACCOUNT, b.direction, b.direction === 'DEPOSIT' ? b.amount : -b.amount, undefined, 'owner paper allocation change');
    audit('owner', 'bot.allocation', b); return accountState();
  });
  app.get('/api/portfolio', async () => {
    const acct = accountState(); const pos = oms.listPositions();
    const curve = all<any>("SELECT closed_at t, realized_pnl p FROM positions WHERE status='CLOSED' ORDER BY closed_at"); let eq = acct.deposits; const equityCurve = curve.map((c) => ({ t: c.t, equity: (eq += c.p) }));
    return { account: acct, open: pos.filter((p) => p.status === 'OPEN'), closed: pos.filter((p) => p.status === 'CLOSED').slice(0, 200), equityCurve, reconciliation: reconcile(), external: { wallets: 'PENDING: on-chain RPC not configured', exchanges: 'PENDING: read-only exchange API keys not configured' } };
  });
  app.get('/api/orders', async () => oms.listOrders(300));
  app.post('/api/orders/:id/approve', async (req) => oms.decideApproval(idOf(req), true));
  app.post('/api/orders/:id/reject', async (req) => oms.decideApproval(idOf(req), false));
  app.post('/api/positions/:id/close', async (req) => oms.closePosition('owner', idOf(req)));

  // ── journal / calendar ──
  app.get('/api/journal', async (req) => listJournal(400, z.object({ kind: TOKEN.optional() }).parse(req.query).kind));
  app.get('/api/calendar', async (req) => calendar(z.object({ month: MONTH.default(new Date().toISOString().slice(0, 7)) }).parse(req.query ?? {}).month));
  app.post('/api/calendar/tz', async (req) => { const { offsetMin } = z.object({ offsetMin: z.number().int().min(-720).max(840) }).parse(req.body); setSetting('calendarTzOffsetMin', offsetMin); return { ok: true }; });

  // ── strategy lab ──
  app.get('/api/lab', async () => ({ strategies: lab.listStrategies(), backtests: lab.listBacktests(30), universe: lab._universeSymbols() }));
  app.post('/api/lab/backtest', async (req) => { const b = z.object({ strategyId: z.string().max(60), symbol: z.string().min(1).max(20).regex(/^[A-Za-z0-9]+$/), bars: z.number().int().min(500).max(8000).optional() }).parse(req.body); limit(req, 'backtest', 'backtests'); return lab.runBacktest('owner', b.strategyId, b.symbol.toUpperCase(), b.bars); });
  app.post('/api/lab/strategy/:id/status', async (req) => {
    const id = idOf(req);
    const b = z.object({ status: z.enum(['RESEARCH', 'BACKTESTED', 'PAPER', 'LIVE_CANDIDATE', 'SUSPENDED', 'RETIRED']), note: z.string().max(300).optional(), password: PW.optional() }).strict().parse(req.body);
    const current = get<{ status: lab.StrategyStatus }>('SELECT status FROM strategies WHERE id=?', id);
    if (b.status === 'LIVE_CANDIDATE' || (b.status === 'PAPER' && (current?.status !== 'PAPER' || getSetting<string[]>('suspendedStrategies', []).includes(id)))) stepUp(req, b);
    lab.setStrategyStatus('owner', id, b.status, b.note); return { ok: true };
  });

  // ── news / whales ──
  app.get('/api/news', async () => ({ items: recentNews(300), asOf: getSetting('newsAt', null), license: 'Google News RSS — personal, non-commercial use only.' }));
  app.post('/api/news/refresh', async (req) => { limit(req, 'news', 'news refresh'); const n = await refreshNews(); setSetting('newsAt', Date.now()); return { added: n }; });
  app.get('/api/whales', async () => ({ prints: recentPrints(300), thresholds: market.universe.slice(0, 12).map((id) => ({ symbol: market.instruments.get(id)?.symbol, threshold: printThreshold(market.tickers.get(id)?.quoteVolume ?? 0) })), walletTracking: 'PENDING_CREDENTIALS: wallet-level whale tracking and copy trading require an on-chain provider.' }));

  // ── wallet ──
  app.get('/api/wallet', async () => ({ networks: wallet.NETWORKS, addresses: wallet.listAddresses(), withdrawals: wallet.listWithdrawals(), frozen: wallet.withdrawalFrozen(), custody: 'READ-ONLY build: no keys, no signer. Seed phrases are never requested.' }));
  app.post('/api/wallet/validate', async (req) => { const b = z.object({ network: z.string(), address: z.string().max(120) }).parse(req.body); return wallet.validateAddress(b.network, b.address); });
  app.post('/api/wallet/address', async (req) => { const b = z.object({ label: z.string().min(1).max(60), network: z.string(), address: z.string().max(120), memo: z.string().max(100).optional() }).parse(req.body); return wallet.addAddress('owner', b.label, b.network, b.address, b.memo); });
  app.post('/api/wallet/address/:id/verify', async (req) => { stepUp(req, req.body); wallet.verifyAddress('owner', idOf(req)); return { ok: true }; });
  app.delete('/api/wallet/address/:id', async (req) => { wallet.removeAddress('owner', idOf(req)); return { ok: true }; });
  app.post('/api/wallet/withdraw/preview', async (req) => {
    const { password, ...input } = z.object({ network: z.string().max(40), asset: z.string().max(20), amount: z.number().finite(), addressId: z.string().max(64), password: PW }).parse(req.body);
    stepUp(req, { password }); return wallet.previewWithdrawal('owner', input); // the passphrase never reaches the audit log
  });
  app.post('/api/wallet/freeze', async (req) => { const b = z.object({ on: z.boolean(), password: PW.optional() }).parse(req.body); if (!b.on) stepUp(req, b); wallet.setWithdrawalFreeze('owner', b.on); return { frozen: b.on }; });

  // ── connections / notifications / settings / QA ──
  app.get('/api/connections', async () => ({ providers: providers(), latency: latencyReport() }));

  // ── Phase 1 workspaces ──
  app.get('/api/qhef', async () => qhefReport());
  app.get('/api/security', async (req) => securityOverview(tokenOf(req)));
  app.post('/api/security/sessions/revoke-others', async (req) => { stepUp(req, req.body); return revokeOtherSessions(tokenOf(req)); });
  app.get('/api/discover', async (req) => discover(z.object({ minVolume: z.coerce.number().min(0).default(1e6) }).parse(req.query ?? {}).minVolume));
  const histFilter = (q: any): HistoryFilter => z.object({ from: z.coerce.number().int().positive().optional(), to: z.coerce.number().int().positive().optional(),
    instrument: z.string().max(20).regex(/^[A-Za-z0-9]*$/).optional(), status: z.enum(['NEW', 'FILLED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ACTIVE', 'PENDING_APPROVAL']).optional(),
    purpose: z.enum(['ENTRY', 'EXIT', 'PROTECTIVE_STOP']).optional() }).parse(q);
  app.get('/api/history', async (req) => tradingHistory(histFilter(req.query)));
  app.get('/api/history.csv', async (req, reply) => {
    const { kind, ...rest } = z.object({ kind: TOKEN.optional() }).passthrough().parse(req.query ?? {}); const q = { kind }; const h = tradingHistory(histFilter(rest));
    const csv = q.kind === 'trades'
      ? toCsv(h.trades, ['id', 'instrument', 'strategy', 'opened_at', 'closed_at', 'entry_price', 'exit_price', 'realized_pnl', 'fees', 'exit_reason', 'planned_risk'])
      : toCsv(h.orders, ['id', 'client_order_id', 'created_at', 'instrument', 'side', 'type', 'purpose', 'qty', 'filled_qty', 'avg_price', 'fees', 'status', 'reject_reason']);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="mia-${q.kind === 'trades' ? 'trades' : 'orders'}-paper.csv"`);
    return csv;
  });
  app.get('/api/copy', async () => {
    const evm = provider('evm_rpc'); const sol = provider('solana_rpc');
    return { status: 'BLOCKED', trackedWallets: [], copyRules: [],
      requirements: [
        { name: 'EVM RPC + explorer (wallet discovery, transfers, ranking)', providerId: 'evm_rpc', status: evm?.status ?? 'PENDING_CREDENTIALS' },
        { name: 'Solana RPC (wallet activity, token authorities)', providerId: 'solana_rpc', status: sol?.status ?? 'PENDING_CREDENTIALS' },
      ],
      pipeline: ['Discover candidate whale wallets from on-chain transfers', 'Rank by verified, cost-adjusted historical performance (Part 4.3)', 'Detect a new trade by a followed wallet',
        'Treat it as a candidate: asset safety → 100-worker QCI → decision engine → deterministic risk gate', 'Paper-execute only within your limits; never mirror size blindly'],
      note: 'No wallet data is simulated. Copy trading activates only after an on-chain provider is connected and the feature is tested.',
      win: getWinCopyStatus(PAPER_ACCOUNT) };
  });
  // WIN-01: read-only follow management. Global route hook already enforces
  // the owner session and CSRF. No order or wallet signer is reachable here.
  app.post('/api/copy/follow', async (req) => {
    limit(req, 'instrument', 'win follow configuration');
    const { walletAddress } = z.object({
      walletAddress: z.string().trim().min(32).max(44)
    }).strict().parse(req.body);
    const follow = followOneWalletReadOnly(PAPER_ACCOUNT, walletAddress);
    audit('owner', 'win.follow.read_only', { walletHash: sha256(follow.walletAddress) });
    return getWinCopyStatus(PAPER_ACCOUNT);
  });
  app.delete('/api/copy/follow', async (req) => {
    limit(req, 'instrument', 'win unfollow');
    unfollowWalletReadOnly(PAPER_ACCOUNT);
    audit('owner', 'win.unfollow.read_only');
    return getWinCopyStatus(PAPER_ACCOUNT);
  });
  app.get('/api/copy/profile', async (req) => {
    limit(req, 'instrument', 'read-only whale profile');
    return getWinReadOnlyProfile(PAPER_ACCOUNT);
  });
  app.get('/api/copy/observations', async (req) => {
    const { limit: count } = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100)
    }).strict().parse(req.query ?? {});
    return { status: 'READ_ONLY', events: recentWhaleObservations(PAPER_ACCOUNT, count),
      provider: 'NOT_WIRED', executable: false };
  });
  app.get('/api/whales/deep', async () => ({
    status: 'RESEARCH_ONLY', attribution: 'INFERRED_ENTITY',
    method: 'ANONYMOUS_CEX_LARGE_PRINT',
    note: 'These Binance prints do not reveal trader identities, strategy, or profitable positions.',
    footprints: reconstructReadOnlyDeepFootprints(recentPrints(100), Date.now()),
    calibratedStrategy: null, executable: false
  }));
  app.get('/api/latency', async () => latencyReport());
  app.get('/api/notifications', async () => listNotifications(300));
  app.post('/api/notifications/read', async (req) => { const { id } = z.object({ id: z.string().min(1).max(64).optional() }).parse(req.body ?? {}); markRead(id); return { ok: true }; });
  app.post('/api/notifications/test', async () => ({ id: notify('INFO', 'Test notification', 'Delivery check from Settings', 'settings') }));
  app.get('/api/settings', async () => ({ notifyPrefs: getSetting('notifyPrefs', { telegramMinSeverity: 'WARNING', quietHoursUtc: null }), calendarTzOffsetMin: getSetting('calendarTzOffsetMin', 0), joe: { model: config.joeModel, llm: !!config.anthropicApiKey, tools: JOE_TOOL_NAMES }, telegram: { configured: !!config.telegramBotToken } }));
  app.post('/api/settings/notify', async (req) => { const b = z.object({ telegramMinSeverity: z.enum(['INFO', 'WARNING', 'CRITICAL']), quietHoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).nullable() }).parse(req.body); setSetting('notifyPrefs', b); return { ok: true }; });
  /** Read-only parity witness. Uses existing mode, policy and G01–G14 sources; NEVER authorizes a trade. */
  app.get('/api/trading/parity', async () => {
    const control = getControl();
    const acceptedPolicy = !!currentPolicy();
    const release = releaseGates();
    return {
      readOnly: true,
      canonical: { market: 'server/src/market/fabric.ts', decision: 'server/src/decision/engine.ts',
        risk: 'server/src/risk/gate.ts', mode: 'server/src/core/mode.ts',
        paperOms: 'server/src/exec/oms.ts', release: 'server/src/qa/gates.ts' },
      demo: { environment: 'DEMO', mode: 'PAPER', account: PAPER_ACCOUNT,
        simulationOnly: true, botRunning: botStatus.running, policyAccepted: acceptedPolicy,
        entryPermittedByControl: control.mode === 'PAPER' && !control.emergency &&
          !control.pausedNewOrders && acceptedPolicy },
      live: { environment: 'LIVE', mode: 'BOUNDED_LIVE', account: null,
        canPlaceRealOrders: false, releaseEligible: release.liveAllowed,
        unmetGates: release.gates.filter((g) => g.status !== 'PASS').map((g) => g.id),
        reason: 'Certified live adapter, isolated signer, durable reservation and external authorization are not installed in this build.' },
      releaseSummary: release.summary,
    };
  });
  app.get('/api/qa', async () => ({ ...releaseGates(), audit: verifyAuditChain() }));
  app.get('/api/audit', async () => recentAudit(200));

  // ── Trader Joe ──
  app.get('/api/joe', async () => ({ history: chatHistory(100), llm: !!config.anthropicApiKey, model: config.joeModel }));
  app.post('/api/joe', async (req) => { const { message } = z.object({ message: z.string().min(1).max(4000) }).parse(req.body); limit(req, 'joe', 'Trader Joe'); return askJoe(message); });
}
const slim = (r: any) => ({ id: r.id, asset: r.asset, instrumentId: r.instrumentId, strategy: r.strategy, regime: r.regime, decision: r.decision, finalDecision: r.finalDecision, score: r.opportunity.score, consensus: r.consensus, createdAt: r.createdAt, entryCondition: r.entryCondition, invalidation: r.invalidation, stopLoss: r.stopLoss, takeProfit: r.takeProfit, risk: r.risk ? { decision: r.risk.decision, reasonCodes: r.risk.reasonCodes } : null, missing: r.missingInformation });
const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
