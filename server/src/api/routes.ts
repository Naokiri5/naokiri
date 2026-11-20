import { filingRoutes } from '../fundamentals/routes.js';
import { ditasRoutes } from '../ditas/routes.js';
import { knowledgeRoutes } from '../knowledge/routes.js';
import { VikeNotConfiguredError } from '../providers/vike.js';
import * as privy from '../security/privy.js';
import { catalogSummary } from '../fabric/catalog.js';
import { outboxHealth } from '../fabric/relay.js';
import * as totp from '../security/totp.js';
import { authMode, passphraseSignInAllowed, stepUpMethod, verifyStepUp } from '../security/stepUp.js';
import { createBackup } from '../ops/backup.js';
import { assessAll, autoPauseEnabled, containmentStatus } from '../security/guardian/response.js';
import { startGuardian, stopGuardian } from '../security/guardian/runner.js';
import { alertSettings, setAlerts } from '../security/guardian/alerts.js';
import { lastEvidencePass } from '../security/guardian/events.js';
import { endStream } from './sse.js';
import { posture, recentGuardianActions } from '../security/guardian/posture.js';
import { ccxtRoutes } from '../research/ccxtRoutes.js';
import { defiRoutes } from '../research/defiRoutes.js';
import { predictionRoutes } from '../prediction/routes.js';
import { buildCertificate } from '../decision/certificate.js';
import { replayDecision, ReplayError } from '../ditas/replay.js';
import { vikeRoutes } from '../research/vikeRoutes.js';
import { environmentsOverview } from '../exec/environment.js';
import { analyzeChart } from '../chart/analysis.js';
import { summarizeTimeframes } from '../chart/timeframes.js';
import { replayChart } from '../chart/replay.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as auth from './auth.js';
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
import { noTradeBoard } from '../decision/noTrade.js';
import { QCI_POLICY, DOMAIN_WEIGHTS } from '../qci/coordinator.js';
import { providers } from '../providers/http.js';
import { latencyReport } from '../core/latency.js';
import { getControl, updateControl, displayMode } from '../core/mode.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY, policyHistory } from '../risk/policy.js';
import { accountState, cashBalance, ledger, PAPER_ACCOUNT, openPositions } from '../portfolio/ledger.js';
import { portfolioStress } from '../portfolio/stress.js';
import { correlation } from '../portfolio/correlation.js';
import { calendar, calendarTimeZone, reconcile, setCalendarTimeZone, tzOffsetMin } from '../portfolio/calendar.js';
import * as oms from '../exec/oms.js';
import { listIncidents, acknowledgeIncident, IncidentError } from '../exec/incidents.js';
import { listJournal } from '../journal/journal.js';
import { recentNews, refreshNews } from '../news/news.js';
import { recentPrints, printThreshold } from '../whales/prints.js';
import * as lab from '../lab/lab.js';
import { STRATEGIES } from '../lab/strategies.js';
import * as wallet from '../wallet/wallet.js';
import { listNotifications, markRead, notify, notificationCenter, criticalSummary, ackNotificationGroup } from '../notify/notify.js';
import { releaseGates, modeGate } from '../qa/gates.js';
import { recentAudit, verifyAuditChain } from '../core/audit.js';
import { botStatus, botStatusView } from '../bot/bot.js';
import { readiness } from '../ops/readiness.js';
import { askJoe, chatHistory, dailyBriefing, JOE_TOOL_NAMES } from '../joe/joe.js';
import { decodeCursor, joeEvents, joeEventsForPosition } from '../joe/live/projection.js';
import { all, get, P, run, tx } from '../db/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { audit } from '../core/audit.js';
import { config } from '../config.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { qhefReport } from '../qhef/qhef.js';
import { securityOverview, revokeOtherSessions } from '../security/security.js';
import { timeZoneName } from '../core/time.js';
import { readCexActivity } from '../market/cexActivity.js';
import { marketCoverage } from '../market/coverage.js';
import { discover } from '../market/discover.js';
import { tradingHistory, toCsv, type HistoryFilter } from '../journal/history.js';
import { provider, ProviderError } from '../providers/http.js';
import { limiter, RateLimitError } from '../core/ratelimit.js';
import { sha256 } from '../core/util.js';

import { clearGoogleFlow, GOOGLE_CALLBACK, googleConfig, googleSubject, readGoogleFlow, startGoogleFlow } from './google.js';

/** Codex #25 direct Google sign-in: passphrase mode only. In Privy mode, Google login is a Privy login method instead. */
const googleAvailable = () => (passphraseSignInAllowed() ? googleConfig() : null);
const googleIdentity = () => getSetting<{ clientId: string; subject: string } | null>('auth.google.owner', null);
const COOKIE = 'mia_session';
const tokenOf = (req: FastifyRequest) => (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const bad = (reply: FastifyReply, code: number, msg: string) => reply.code(code).send({ error: msg });
/**
 * Step-up runs on an AUTHENTICATED session, so its per-client budget is keyed by that session (hash of the token), not by
 * IP. Behind a reverse proxy or container gateway every client shares one IP, and a stranger's failed logins used to lock
 * the owner's step-up too (MA-07). A session's own failures still lock that session (5 misses → exponential backoff).
 */
const stepUpClient = (req: FastifyRequest) => `session:${sha256(tokenOf(req) ?? '')}`;
/** Step-up (authenticator code, or the legacy passphrase until one is enrolled) shares the login brute-force limits
 *  (per session + global), so it cannot be guessed freely. See security/stepUp.ts. */
const stepUp = (req: FastifyRequest, body: any) => verifyStepUp(body, stepUpClient(req), { exemptFromGlobalLockout: isDirectLocal(req) });
/** Step-up for actions that only REDUCE risk or exposure (close all, revoke other sessions): never blocked by the
 *  server-wide failure budget that unauthenticated strangers can exhaust (SEC-14), nor by another client's failures. */
const stepUpRiskReducing = (req: FastifyRequest, body: any) => verifyStepUp(body, stepUpClient(req), { exemptFromGlobalLockout: true });
const PW = z.string().min(1).max(1024);
/** Step-up proof fields accepted by every protected action: an authenticator code, or the legacy passphrase. */
const OTP = z.string().trim().regex(/^\d{6}$/, 'authenticator code must be 6 digits');
const SU = { password: PW.optional(), otp: OTP.optional() };
/** Passphrase routes exist only when the administrator explicitly chose MIA_AUTH_MODE=passphrase. */
const requirePassphraseMode = () => { if (!passphraseSignInAllowed()) throw httpError(403, 'passphrase sign-in is turned off on this server: sign in with Privy (an administrator can set MIA_AUTH_MODE=passphrase for offline recovery)'); };
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
    if (err instanceof ProviderError) {
      req.log.warn({ provider: err.providerId, status: err.status }, 'upstream provider failure');
      return reply.code(err.status === 404 ? 404 : err.status === 429 ? 503 : 502).send({ error: `upstream market-data provider unavailable (${err.providerId})` });
    }
    if (err instanceof VikeNotConfiguredError) return reply.code(503).send({ error: `${err.message}. Research data is unavailable until the owner configures it.` });
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
   * Auth gate + CSRF header for state-changing requests. Decided on the MATCHED ROUTE, not the raw URL: the router
   * percent-decodes the path, so `/%61pi/audit` matched `/api/audit` while `req.url.startsWith('/api/')` was false and
   * the old gate let the request through unauthenticated. Every route in this plugin is an API route.
   */
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions?.url ?? '';
    if (route.startsWith('/api/auth/') || route === '/api/health' || route === '/api/ready') return;
    if (!auth.validSession(tokenOf(req))) return bad(reply, 401, 'authentication required');
    if (req.method !== 'GET' && req.headers['x-mia-csrf'] !== '1') return bad(reply, 403, 'missing CSRF header');
  });
  const limit = (req: FastifyRequest, l: keyof typeof LIMITS, what: string) => LIMITS[l].take(sha256(tokenOf(req) ?? req.ip), what);

  await ditasRoutes(app);
  await knowledgeRoutes(app);
  await vikeRoutes(app); // read-only Vike research (owner session required by the gate below)
  await ccxtRoutes(app); // read-only CCXT exchange research (GET-only transport, keyless)
  await defiRoutes(app); // read-only DefiLlama yields/TVL and Aave V3 flash-loan research (no transactions)
  await predictionRoutes(app); // read-only Polymarket/Kalshi research, analytics and book replay (no order path)
  /** Paper/Live environments for the shared UI layout. Read-only; Live is reported as LOCKED, never as available. */
  app.get('/api/trading/environments', async () => ({ environments: environmentsOverview() }));
  await filingRoutes(app); // Codex: read-only SEC EDGAR filings research
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
  app.get('/api/auth/state', async (req) => {
    // Codex hardening: a loopback connection can come from a forwarder, so only the console code authorizes first-owner setup.
    const mode = authMode();
    const setup = auth.isSetup();
    if (!setup && passphraseSignInAllowed()) auth.ensureSetupCode(); // created (and printed once) when setup is first needed
    const authenticated = auth.validSession(tokenOf(req));
    const google = googleAvailable();
    return {
      mode, setup, authenticated, setupCodeRequired: mode === 'passphrase' && !setup,
      privy: privy.privyPublicConfig(),
      googleSignIn: !!google && googleIdentity()?.clientId === google.clientId,
      // How sensitive actions are confirmed; only told to the signed-in owner.
      ...(authenticated ? { stepUp: stepUpMethod() } : {}),
    };
  });
  app.post('/api/auth/setup', async (req, reply) => {
    requirePassphraseMode();
    const { password, setupCode } = z.object({
      password: PW.min(10, 'passphrase must be at least 10 characters'),
      setupCode: z.string().max(64).optional(),
    }).strict().parse(req.body);
    if (auth.isSetup()) throw httpError(400, 'owner already configured');
    auth.ensureSetupCode();
    auth.verifySetupCode(setupCode, req.ip);
    const token = tx(() => {
      auth.setupOwner(password);
      auth.clearSetupCode();
      return auth.createSession(req.ip, 'passphrase');
    });
    return issue(reply, token);
  });
  app.post('/api/auth/login', async (req, reply) => { requirePassphraseMode(); const { password } = z.object({ password: PW }).parse(req.body); return issue(reply, auth.login(password, req.ip, { directLocal: isDirectLocal(req) })); });
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${config.secureCookie ? '; Secure' : ''}`;
  app.post('/api/auth/google/start', async (req, reply) => {
    if (req.headers['x-mia-csrf'] !== '1') return bad(reply, 403, 'missing CSRF header');
    const cfg = googleAvailable();
    if (!cfg || googleIdentity()?.clientId !== cfg.clientId) return bad(reply, 404, 'Google sign-in is unavailable');
    const flow = startGoogleFlow(cfg);
    return reply.header('set-cookie', flow.cookie).send({ url: flow.url });
  });
  app.get('/api/settings/google', async () => ({ configured: !!googleAvailable(), linked: !!googleIdentity() }));
  app.post('/api/settings/google/link', async (req, reply) => {
    const cfg = googleAvailable();
    if (!cfg) return bad(reply, 404, 'Google is not configured');
    if (googleIdentity()) return bad(reply, 409, 'Unlink your current Google account first');
    stepUp(req, z.object({ password: PW }).strict().parse(req.body));
    const flow = startGoogleFlow(cfg, tokenOf(req));
    return reply.header('set-cookie', flow.cookie).send({ url: flow.url });
  });
  app.post('/api/settings/google/unlink', async (req, reply) => {
    stepUpRiskReducing(req, z.object({ password: PW }).strict().parse(req.body));
    if (!googleIdentity()) return { ok: true };
    const token = tx(() => {
      setSetting('auth.google.owner', null);
      run('DELETE FROM sessions');
      audit('owner', 'auth.google.unlinked');
      return auth.createSession(req.ip, 'passphrase');
    });
    return issue(reply, token);
  });
  app.get(GOOGLE_CALLBACK, async (req, reply) => {
    const cfg = googleAvailable();
    const query = z.object({ state: z.string().length(43), code: z.string().min(1).max(4096).optional() }).safeParse(req.query);
    const flow = cfg && query.success ? readGoogleFlow(cfg, req.headers.cookie ?? '', query.data.state) : null;
    const destination = flow?.sessionHash ? '/settings' : '/';
    const fail = () => reply.redirect(`${destination}?google=failed`, 303);
    reply.header('cache-control', 'no-store');
    if (!cfg || !flow || !query.success) return fail();
    reply.header('set-cookie', clearGoogleFlow);
    if (!query.data.code) return fail();
    if (flow.sessionHash && !auth.validSessionHash(flow.sessionHash)) return fail();

    let subject: string;
    try { subject = await googleSubject(cfg, query.data.code, flow.verifier); } catch { return fail(); }
    if (!auth.isSetup()) return fail();
    if (flow.sessionHash) {
      // Recheck after the network round trip. Linking may have been canceled by logout or passphrase rotation.
      if (!auth.validSessionHash(flow.sessionHash) || googleIdentity()) return fail();
      tx(() => {
        setSetting('auth.google.owner', { clientId: cfg.clientId, subject });
        audit('owner', 'auth.google.linked');
      });
      return reply.redirect(destination, 303);
    }
    const linked = googleIdentity();
    if (linked?.clientId !== cfg.clientId || linked.subject !== subject) return fail();
    issue(reply, auth.createSession(req.ip, 'google'));
    return reply.redirect(destination, 303);
  });
  // Privy sign-in (optional). Login requires a Privy identity the owner already linked; link/unlink need a session + step-up.
  app.get('/api/auth/privy/config', async () => privy.privyPublicConfig());
  app.post('/api/auth/privy/login', async (req, reply) => {
    const { accessToken } = z.object({ accessToken: z.string().min(20).max(4096) }).strict().parse(req.body);
    return issue(reply, await privy.loginWithPrivy(accessToken, req.ip, { directLocal: isDirectLocal(req), backup: () => { createBackup(); } }));
  });
  app.post('/api/security/privy/link', async (req) => {
    const b = z.object({ accessToken: z.string().min(20).max(4096), ...SU }).strict().parse(req.body);
    stepUp(req, b); return privy.linkPrivy(b.accessToken);
  });
  app.post('/api/security/privy/embedded-wallet-intent', async (req) => {
    const b = z.object({ ...SU }).strict().parse(req.body ?? {});
    if (!privy.embeddedWalletsAllowed()) return privy.embeddedWalletIntent(); // 403 before asking for a code
    stepUp(req, b); return privy.embeddedWalletIntent();
  });
  app.post('/api/security/privy/unlink', async (req) => {
    const b = z.object({ ...SU }).strict().parse(req.body ?? {});
    stepUp(req, b); return privy.unlinkPrivy(authMode() === 'privy');
  });
  app.post('/api/auth/logout', async (req, reply) => { auth.logout(tokenOf(req)); reply.header('set-cookie', `${COOKIE}=; ${cookieFlags}; Max-Age=0`); return { ok: true }; });
  app.post('/api/settings/password', async (req) => { requirePassphraseMode(); const b = z.object({ current: PW, next: PW }).parse(req.body); auth.changePassword(b.current, b.next, stepUpClient(req), { exemptFromGlobalLockout: true }); /* I-01: keyed by the authenticated session, like step-up */ return { ok: true }; });
  // Owner two-factor (authenticator app) for step-up. Session required (gate above); enrolling needs independent proof.
  app.get('/api/security/2fa', async () => totp.twoFactorStatus());
  app.post('/api/security/2fa/begin', async (req) => {
    const b = z.object({ ...SU, consoleCode: z.string().max(64).optional() }).strict().parse(req.body ?? {});
    return totp.beginEnrollment(b, stepUpClient(req), { log: (m) => req.log.warn(m) });
  });
  app.post('/api/security/2fa/confirm', async (req) => {
    const { otp } = z.object({ otp: OTP }).strict().parse(req.body);
    return totp.confirmEnrollment(otp, stepUpClient(req));
  });
  function issue(reply: FastifyReply, token: string) { reply.header('set-cookie', `${COOKIE}=${token}; ${cookieFlags}; Max-Age=43200`); return { ok: true }; }

  // ── live stream (SSE) ──
  let streams = 0;
  // MIA-OPS-007: an open live stream kept app.close() waiting, so every graceful stop with a browser tab open hung until
  // the 30 s hard limit, exited 1 and skipped closing the database. Streams are ended before the server closes.
  const openStreams = new Set<() => void>();
  app.addHook('preClose', async () => { for (const end of [...openStreams]) end(); });
  app.get('/api/stream', (req, reply) => {
    if (streams >= 20) return bad(reply, 503, 'too many open live streams');
    const token = tokenOf(req);
    reply.hijack(); // we own the raw socket from here; Fastify must not try to send a second response
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff', 'x-request-id': String(req.id) });
    streams++;
    reply.raw.write(': connected\n\n');
    let closed = false; let backlog = 0;
    const close = () => { if (closed) return; closed = true; streams--; openStreams.delete(close); bus.off('*', send); clearInterval(ka); endStream(reply.raw); };
    openStreams.add(close);
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
  app.get('/api/markets/coverage', async () => marketCoverage(Date.now(), calendarTimeZone() ?? 'UTC'));
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
    const chartIntelligence = analyzeChart(i.id, iv, d?.engines[iv].candles ?? [], Date.now());
    const timeframeAgreement = summarizeTimeframes(chartIntelligence, d);
    const selectedReading = timeframeAgreement.readings.find(reading => reading.timeframe === iv);
    const featuresResearch = selectedReading?.status === 'VALID' ? d?.engines[iv].research ?? null : null;
    return { chartIntelligence, timeframeAgreement, featuresResearch, cexActivity: readCexActivity(i.id, chartIntelligence.asOf),
      instrument: i, ticker: market.tickers.get(i.id) ?? null, candles: d ? [...d.engines[iv].candles.slice(-300), ...(d.forming[iv] ? [{ ...d.forming[iv], forming: true }] : [])] : [], features: d?.engines[iv].last ?? null,
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
  app.get('/api/no-trade', async () => noTradeBoard());
  app.get('/api/decisions', async (req) => { const q = z.object({ decision: TOKEN.optional() }).parse(req.query); return all<any>(`SELECT id, instrument, strategy, decision, score, risk_decision, created_at FROM decisions ${q.decision ? 'WHERE decision=?' : ''} ORDER BY created_at DESC LIMIT 300`, ...(q.decision ? [q.decision] : [])); });
  /** THINK Reason-to-Trade Certificate: deterministic, read-only explanation of a stored decision (no authority). */
  app.get('/api/decisions/:id/certificate', async (req, reply) => {
    const r = get<{ report: string; consensus_id: string }>('SELECT report, consensus_id FROM decisions WHERE id=?', idOf(req)); if (!r) return bad(reply, 404, 'not found');
    const c = get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', r.consensus_id);
    return buildCertificate(r.report, c?.record ?? null);
  });
  /** THINK evidence replay from the frozen DITAS snapshot (read-only; no side effects). */
  app.get('/api/decisions/:id/replay', async (req, reply) => {
    try { return replayDecision(idOf(req)); } catch (e) { if (e instanceof ReplayError) return bad(reply, 404, e.message); throw e; }
  });
  app.get('/api/decisions/:id', async (req, reply) => {
    const id = idOf(req);
    const row = get<{ report: string; consensus_id: string | null; instrument: string }>(
      'SELECT report, consensus_id, instrument FROM decisions WHERE id=?', id);
    if (!row) return bad(reply, 404, 'not found');
    const consensus = get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', row.consensus_id);
    return { report: P(row.report), consensus: consensus ? P(consensus.record) : null, paperEntry: oms.paperEntryForDecision(id, row.instrument) };
  });
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
    const id = idOf(req); const b = z.object({ ...SU }).strict().parse(req.body ?? {});
    stepUp(req, b); releaseQuarantine('owner', id); audit('owner', 'worker.release', { id }); return { ok: true };
  });

  // ── risk center ──
  app.get('/api/risk/stress', async () => portfolioStress());
  app.get('/api/risk', async () => {
    const acct = accountState(); const pos = openPositions();
    const corr = pos.map((a) => pos.map((b) => correlation(a.instrument, b.instrument)));
    return { policy: currentPolicy(), defaults: DEFAULT_POLICY, history: policyHistory().slice(0, 20), account: acct, control: getControl(), display: displayMode(), positions: pos, correlation: { instruments: pos.map((p) => p.instrument), matrix: corr }, protection: oms.protectPositions(), incidents: listIncidents(), gates: releaseGates() };
  });
  app.post('/api/risk/policy', async (req) => { const b = z.object({ policy: z.unknown(), ...SU }).strict().parse(req.body ?? {}); stepUp(req, b); return acceptPolicy('owner', b.policy); });
  app.post('/api/control', async (req) => {
    const b = z.object({ mode: z.enum(['OBSERVE', 'PAPER', 'APPROVAL', 'BOUNDED_LIVE']).optional(), pausedNewOrders: z.boolean().optional(), emergency: z.boolean().optional(), disabledStrategies: z.array(z.string().max(60)).max(50).optional(),
      disableStrategy: z.string().min(1).max(60).optional(), enableStrategy: z.string().min(1).max(60).optional(), ...SU }).strict().parse(req.body); // H-08: unknown keys are errors on the control endpoint
    const { password, otp, disableStrategy, enableStrategy, ...patch } = b;
    // MIA-WEB-010: single-strategy operations computed from the server's CURRENT list. A client that sent a whole list
    // from a stale copy could re-enable a strategy the owner (or the health monitor) had just disabled.
    if (disableStrategy || enableStrategy) {
      if (patch.disabledStrategies) throw httpError(400, 'use either disabledStrategies or disableStrategy/enableStrategy, not both');
      const list = new Set(getControl().disabledStrategies);
      if (disableStrategy) list.add(disableStrategy); if (enableStrategy) list.delete(enableStrategy);
      patch.disabledStrategies = [...list];
    }
    // Anything that INCREASES risk needs the passphrase: mode changes, clearing an emergency, resuming after a pause,
    // and re-enabling strategies (the last two previously needed only a session).
    const cur = getControl();
    const reEnables = !!patch.disabledStrategies && cur.disabledStrategies.some((s) => !patch.disabledStrategies!.includes(s));
    if (patch.mode || patch.emergency === false || patch.pausedNewOrders === false || reEnables) stepUp(req, b);
    return updateControl('owner', patch, modeGate);
  });
  app.post('/api/emergency/:action', async (req) => {
    const a = z.object({ action: z.string().max(40) }).parse(req.params).action; const b = z.object({ confirm: z.string().max(40).optional(), ...SU }).strict().parse(req.body ?? {});
    if (a === 'pause') return oms.pauseNewOrders('owner');
    if (a === 'cancel-pending') return oms.cancelPendingEntries('owner');
    if (a === 'protect') return oms.protectPositions(true);
    if (a === 'stop') return oms.emergencyStop('owner');
    if (a === 'close-all') { stepUpRiskReducing(req, b); return oms.closeAllPositions('owner', b.confirm ?? ''); }
    throw httpError(404, 'unknown emergency action');
  });

  // ── bot account / portfolio / orders ──
  app.get('/api/bot', async () => ({ status: botStatusView(), account: accountState(), positions: oms.listPositions('OPEN'), pending: all("SELECT * FROM orders WHERE account=? AND venue=? AND status='PENDING_APPROVAL' ORDER BY created_at DESC", PAPER_ACCOUNT, oms.VENUE), strategies: lab.listStrategies(), ledger: all('SELECT * FROM ledger_entries WHERE account=? ORDER BY ts DESC LIMIT 100', PAPER_ACCOUNT) }));
  app.post('/api/bot/allocation', async (req) => {
    const b = z.object({ amount: z.number().positive().max(10_000_000), direction: z.enum(['DEPOSIT', 'WITHDRAW']) }).parse(req.body);
    tx(() => {
      if (b.direction === 'WITHDRAW' && b.amount > cashBalance(PAPER_ACCOUNT)) throw new Error('cannot remove more than available paper cash');
      ledger(PAPER_ACCOUNT, b.direction, b.direction === 'DEPOSIT' ? b.amount : -b.amount, undefined, 'owner paper allocation change');
      audit('owner', 'bot.allocation', b);
    });
    return accountState();
  });
  app.get('/api/portfolio', async () => {
    const acct = accountState(); const pos = oms.listPositions();
    const curve = all<{ t: number; p: number }>("SELECT closed_at t, realized_pnl p FROM positions WHERE account=? AND status='CLOSED' ORDER BY closed_at", PAPER_ACCOUNT); let eq = acct.deposits; const equityCurve = curve.map((c) => ({ t: c.t, equity: (eq += c.p) }));
    return { account: acct, open: pos.filter((p) => p.status === 'OPEN'), closed: pos.filter((p) => p.status === 'CLOSED').slice(0, 200), equityCurve, reconciliation: reconcile(), external: { wallets: 'PENDING: on-chain RPC not configured', exchanges: 'PENDING: read-only exchange API keys not configured' } };
  });
  app.get('/api/orders', async () => oms.listOrders(300));
  app.post('/api/orders/:id/approve', async (req) => oms.decideApproval(idOf(req), true));
  app.post('/api/orders/:id/reject', async (req) => oms.decideApproval(idOf(req), false));
  app.post('/api/positions/:id/close', async (req) => oms.closePosition('owner', idOf(req)));

  // ── journal / calendar ──
  app.get('/api/journal', async (req) => listJournal(400, z.object({ kind: TOKEN.optional() }).parse(req.query).kind));
  app.get('/api/calendar', async (req) => calendar(z.object({ month: MONTH.optional() }).parse(req.query ?? {}).month));
  app.post('/api/calendar/tz', async (req) => {
    const timezone = z.string().trim().max(64).transform(timeZoneName).pipe(z.string({ error: 'expected an IANA timezone identifier' }));
    const preference = z.union([
      z.strictObject({ timeZone: timezone }),
      z.strictObject({ offsetMin: z.number().int().min(-720).max(840) }),
    ]).parse(req.body);
    setCalendarTimeZone(preference);
    return { ok: true };
  });

  // ── strategy lab ──
  app.get('/api/lab', async () => ({ strategies: lab.listStrategies(), backtests: lab.listBacktests(30), universe: lab._universeSymbols() }));
  app.post('/api/lab/backtest', async (req) => { const b = z.object({ strategyId: z.string().max(60), symbol: z.string().min(1).max(20).regex(/^[A-Za-z0-9]+$/), bars: z.number().int().min(500).max(8000).optional() }).parse(req.body); limit(req, 'backtest', 'backtests'); return lab.runBacktest('owner', b.strategyId, b.symbol.toUpperCase(), b.bars); });
  app.post('/api/lab/strategy/:id/status', async (req) => {
    const id = idOf(req);
    const b = z.object({ status: z.enum(['RESEARCH', 'BACKTESTED', 'PAPER', 'LIVE_CANDIDATE', 'SUSPENDED', 'RETIRED']), note: z.string().max(300).optional(), ...SU }).strict().parse(req.body);
    const current = get<{ status: lab.StrategyStatus }>('SELECT status FROM strategies WHERE id=?', id);
    // Step-up for anything that increases risk (CodeRabbit PR #13): promotion to PAPER/LIVE_CANDIDATE, and ANY transition
    // that lifts a suspension — moving a suspended strategy to RESEARCH or BACKTESTED also removes it from the list.
    const suspended = getSetting<string[]>('suspendedStrategies', []).includes(id) || current?.status === 'SUSPENDED' || current?.status === 'RETIRED';
    const liftsSuspension = suspended && b.status !== 'SUSPENDED' && b.status !== 'RETIRED';
    if (b.status === 'LIVE_CANDIDATE' || liftsSuspension || (b.status === 'PAPER' && current?.status !== 'PAPER')) stepUp(req, b);
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
    const { password, otp, ...input } = z.object({ network: z.string().max(40), asset: z.string().max(20), amount: z.number().finite(), addressId: z.string().max(64), ...SU }).parse(req.body);
    stepUp(req, { password, otp }); return wallet.previewWithdrawal('owner', input); // the step-up secret never reaches the audit log
  });
  app.post('/api/wallet/freeze', async (req) => { const b = z.object({ on: z.boolean(), ...SU }).parse(req.body); if (!b.on) stepUp(req, b); wallet.setWithdrawalFreeze('owner', b.on); return { frozen: b.on }; });

  // ── connections / notifications / settings / QA ──
  app.get('/api/connections', async () => ({ providers: providers(), latency: latencyReport() }));

  // ── Phase 1 workspaces ──
  app.get('/api/qhef', async () => qhefReport());
  app.get('/api/security', async (req) => securityOverview(tokenOf(req)));
  // MIA NEXUS data fabric (N1): read-only topic catalog — owners, priorities, durability and honest status.
  app.get('/api/fabric/catalog', async () => catalogSummary());
  app.get('/api/fabric/outbox', async () => outboxHealth()); // N2: measured delivery health + dead letters (owner session)
  // Guardian's background runner owns opt-in containment. Dashboard reads only report its status.
  app.addHook('onReady', async () => { startGuardian(); });
  app.addHook('onClose', async () => { stopGuardian(); });
  app.get('/api/security/guardian', async () => {
    const items = assessAll();
    const containment = containmentStatus(items);
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const i of items) counts[i.assessment.severity]++;
    const alerts = { ...alertSettings(), telegramConfigured: !!(config.telegramBotToken && config.telegramChatId) };
    return { generatedAt: Date.now(), counts, events: items.slice(0, 100), containment, autoPause: autoPauseEnabled(), alerts, evidence: lastEvidencePass(), layers: posture(), actions: recentGuardianActions(),
      authority: { canAuthorizeTrading: false, canSignTransactions: false, canWithdraw: false, canResume: false } };
  });
  // Opt-in Guardian alerts (in-app + Telegram when configured). Turning them OFF lowers visibility, so it needs step-up.
  app.post('/api/security/guardian/alerts', async (req) => {
    const b = z.object({ telegram: z.boolean() }).passthrough().parse(req.body ?? {});
    if (!b.telegram) stepUp(req, req.body);
    return setAlerts(b.telegram);
  });
  app.post('/api/security/sessions/revoke-others', async (req) => { stepUpRiskReducing(req, req.body); return revokeOtherSessions(tokenOf(req)); });
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
      note: 'No wallet data is simulated. Copy trading activates only after an on-chain provider is connected and the feature is tested.' };
  });
  app.get('/api/latency', async () => latencyReport());
  app.get('/api/notifications', async () => listNotifications(300));
  app.post('/api/notifications/read', async (req) => { const { id } = z.object({ id: z.string().min(1).max(64).optional() }).parse(req.body ?? {}); markRead(id); return { ok: true }; });
  app.get('/api/notifications/center', async (req) => notificationCenter({ hideInfo: z.object({ hideInfo: z.enum(['0', '1']).default('0') }).strict().parse(req.query ?? {}).hideInfo === '1' }));
  app.get('/api/notifications/critical', async () => criticalSummary());
  app.post('/api/notifications/ack', async (req) => ackNotificationGroup('owner', z.object({ source: z.string().min(1).max(100), title: z.string().min(1).max(200), severity: z.enum(['INFO', 'WARNING', 'CRITICAL']), throughId: z.string().regex(/^\d{1,15}$/) }).strict().parse(req.body)));
  app.post('/api/notifications/test', async () => ({ id: notify('INFO', 'Test notification', 'Delivery check from Settings', 'settings') }));
  app.get('/api/settings', async () => ({ notifyPrefs: getSetting('notifyPrefs', { telegramMinSeverity: 'WARNING', quietHoursUtc: null }), calendarTzOffsetMin: tzOffsetMin(), calendarTimeZone: calendarTimeZone(), joe: { model: config.joeModel, llm: !!config.anthropicApiKey, tools: JOE_TOOL_NAMES }, telegram: { configured: !!config.telegramBotToken } }));
  app.post('/api/settings/notify', async (req) => { const b = z.object({ telegramMinSeverity: z.enum(['INFO', 'WARNING', 'CRITICAL']), quietHoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).nullable() }).parse(req.body); setSetting('notifyPrefs', b); return { ok: true }; });
  app.get('/api/qa', async () => ({ ...releaseGates(), audit: verifyAuditChain() }));
  app.get('/api/audit', async () => recentAudit(200));

  // ── Trader Joe ──
  app.get('/api/joe', async () => ({ history: chatHistory(100), llm: !!config.anthropicApiKey, model: config.joeModel }));
  // Trader Joe Live (V4 M1): read-only lifecycle story built from committed paper records. Owner session required.
  app.get('/api/joe/events', async (req) => {
    const q = z.object({ after: z.string().max(240).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(req.query);
    const after = q.after === undefined ? null : decodeCursor(q.after);
    if (q.after !== undefined && !after) throw httpError(400, 'invalid cursor');
    return joeEvents({ after, limit: q.limit });
  });
  app.get('/api/joe/events/by-position/:id', async (req) => {
    const { id } = z.object({ id: z.string().regex(/^[A-Za-z0-9_\-]{1,80}$/) }).strict().parse(req.params);
    return joeEventsForPosition(id);
  });
  app.post('/api/joe', async (req) => { const { message } = z.object({ message: z.string().min(1).max(4000) }).parse(req.body); limit(req, 'joe', 'Trader Joe'); return askJoe(message); });
}
const slim = (r: any) => ({ id: r.id, asset: r.asset, instrumentId: r.instrumentId, strategy: r.strategy, regime: r.regime, decision: r.decision, finalDecision: r.finalDecision, score: r.opportunity.score, consensus: r.consensus, createdAt: r.createdAt, entryCondition: r.entryCondition, invalidation: r.invalidation, stopLoss: r.stopLoss, takeProfit: r.takeProfit, risk: r.risk ? { decision: r.risk.decision, reasonCodes: r.risk.reasonCodes } : null, missing: r.missingInformation });
const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
/** A loopback socket carrying proxy headers is a forwarded remote visitor (port forwarder, reverse proxy), not a local one. */
/** Any of these means the loopback socket belongs to a proxy relaying someone else (reverse proxy, port forwarder,
 *  Tailscale Serve/Funnel), so the request is NOT the owner sitting at the machine. */
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-funnel-request', 'tailscale-user-login'];
const isDirectLocal = (req: FastifyRequest) => isLoopback(req.ip) && !PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
