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
import { QCI_POLICY, DOMAIN_WEIGHTS } from '../qci/coordinator.js';
import { providers } from '../providers/http.js';
import { latencyReport } from '../core/latency.js';
import { getControl, updateControl, displayMode } from '../core/mode.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY, policyHistory } from '../risk/policy.js';
import { accountState, ledger, PAPER_ACCOUNT, openPositions } from '../portfolio/ledger.js';
import { correlation } from '../portfolio/correlation.js';
import { calendar, reconcile } from '../portfolio/calendar.js';
import * as oms from '../exec/oms.js';
import { listJournal } from '../journal/journal.js';
import { recentNews, refreshNews } from '../news/news.js';
import { recentPrints, printThreshold } from '../whales/prints.js';
import * as lab from '../lab/lab.js';
import { STRATEGIES } from '../lab/strategies.js';
import * as wallet from '../wallet/wallet.js';
import { listNotifications, markRead, notify } from '../notify/notify.js';
import { releaseGates } from '../qa/gates.js';
import { recentAudit, verifyAuditChain } from '../core/audit.js';
import { botStatusView } from '../bot/bot.js';
import { askJoe, chatHistory, dailyBriefing, JOE_TOOL_NAMES } from '../joe/joe.js';
import { all, get, P } from '../db/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { audit } from '../core/audit.js';
import { config } from '../config.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { qhefReport } from '../qhef/qhef.js';
import { securityOverview, revokeOtherSessions } from '../security/security.js';
import { discover } from '../market/discover.js';
import { tradingHistory, toCsv, type HistoryFilter } from '../journal/history.js';
import { provider } from '../providers/http.js';

const COOKIE = 'mia_session';
const tokenOf = (req: FastifyRequest) => (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const bad = (reply: FastifyReply, code: number, msg: string) => reply.code(code).send({ error: msg });
const stepUp = (body: any) => { if (!auth.checkPassword(body?.password)) throw Object.assign(new Error('step-up authentication failed: passphrase required for this action'), { statusCode: 403 }); };

export async function routes(app: FastifyInstance) {
  app.setErrorHandler((err: any, _req, reply) => {
    const code = err.statusCode && err.statusCode < 600 ? err.statusCode : err instanceof z.ZodError ? 400 : 400;
    reply.code(code).send({ error: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err.message ?? err) });
  });
  // Auth gate + CSRF header for state-changing requests
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/auth/') || req.url === '/api/health') return;
    if (!auth.validSession(tokenOf(req))) return bad(reply, 401, 'authentication required');
    if (req.method !== 'GET' && req.headers['x-mia-csrf'] !== '1') return bad(reply, 403, 'missing CSRF header');
  });

  // ── auth ──
  app.get('/api/health', async () => ({ ok: true, version: '4.1.0', schema: SCHEMA_VERSION, setup: auth.isSetup(), offline: config.offline }));
  app.get('/api/auth/state', async (req) => ({ setup: auth.isSetup(), authenticated: auth.validSession(tokenOf(req)) }));
  app.post('/api/auth/setup', async (req, reply) => { const { password } = z.object({ password: z.string() }).parse(req.body); auth.setupOwner(password); return issue(reply, auth.login(password, req.ip)); });
  app.post('/api/auth/login', async (req, reply) => { const { password } = z.object({ password: z.string() }).parse(req.body); return issue(reply, auth.login(password, req.ip)); });
  app.post('/api/auth/logout', async (req, reply) => { auth.logout(tokenOf(req)); reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`); return { ok: true }; });
  app.post('/api/settings/password', async (req) => { const b = z.object({ current: z.string(), next: z.string() }).parse(req.body); auth.changePassword(b.current, b.next); return { ok: true }; });
  function issue(reply: FastifyReply, token: string) { reply.header('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`); return { ok: true }; }

  // ── live stream (SSE) ──
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (e: { topic: string; payload: unknown }) => reply.raw.write(`event: ${e.topic}\ndata: ${JSON.stringify(e.payload)}\n\n`);
    bus.on('*', send); const ka = setInterval(() => reply.raw.write(': ka\n\n'), 20_000);
    req.raw.on('close', () => { bus.off('*', send); clearInterval(ka); });
  });

  // ── shell / overview ──
  app.get('/api/shell', async () => {
    const ctl = getControl(); const acct = accountState(); const pv = providers();
    const stale = market.tickersFetchedAt ? Date.now() - market.tickersFetchedAt > 60_000 : true;
    return { mode: ctl.mode, display: displayMode(ctl), control: ctl, bot: botStatusView(), account: { equity: acct.equity, dailyPnlPct: acct.dailyPnlPct, drawdownPct: acct.drawdownPct, openRiskPct: acct.openRiskPct, openCount: acct.openCount, deposits: acct.deposits },
      policyAccepted: !!currentPolicy(), dataHealth: { stale, tickersAt: market.tickersFetchedAt, scanAt: market.lastScanAt, live: pv.filter((p) => p.status === 'LIVE').length, degraded: pv.filter((p) => p.status === 'DEGRADED' || p.status === 'DOWN').length },
      unread: get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE read=0')!.n, gates: releaseGates().summary, offline: config.offline };
  });
  app.get('/api/overview', async () => {
    const b = bubbleMap({ limit: 60 }); const btc = market.deep.get('crypto:binance:BTCUSDT')?.engines['1h'].last ?? null;
    return { breadth: b.breadth, btcRegime: classifyRegime(btc), account: accountState(), opportunities: recentDecisions().slice(0, 8), alerts: listNotifications(8), briefing: dailyBriefing(), movers: [...b.crypto].sort((x, y) => y.changePct - x.changePct), asOf: b.asOf };
  });

  // ── markets ──
  app.get('/api/markets', async () => ({ tickers: [...market.tickers.values()].filter((t) => t.quoteVolume > 1e6 && isEligibleSpot(t.base, t.quote)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 300), universe: market.universe, asOf: market.tickersFetchedAt }));
  app.get('/api/markets/search', async (req) => { const q = String((req.query as any).q ?? '').toUpperCase(); return [...market.instruments.values()].filter((i) => i.symbol.includes(q) || i.base.startsWith(q)).slice(0, 20).map((i) => ({ id: i.id, symbol: i.symbol, base: i.base })); });
  app.get('/api/instrument/:symbol', async (req, reply) => {
    const i = market.bySymbol((req.params as any).symbol);
    if (!i) return reply.code(200).send({ unavailable: true, reason: market.instruments.size ? 'Symbol is not a listed Binance spot pair.' : config.offline ? 'Market data is disabled (offline mode).' : 'Market data is still loading — try again in a few seconds.' });
    if (!market.deep.has(i.id) && !config.offline) { const { refreshDeep } = await import('../market/fabric.js'); await refreshDeep([i.id]); }
    const d = market.deep.get(i.id);
    const { interval: iv } = z.object({ interval: z.enum(['15m', '1h', '4h']).default('1h') }).parse(req.query);
    const f = d ? { '15m': d.engines['15m'].last, '1h': d.engines['1h'].last, '4h': d.engines['4h'].last } : {};
    return { instrument: i, ticker: market.tickers.get(i.id) ?? null, candles: d ? [...d.engines[iv].candles.slice(-300), ...(d.forming[iv] ? [{ ...d.forming[iv], forming: true }] : [])] : [], features: d?.engines[iv].last ?? null,
      book: d?.book ? { bids: d.book.bids.slice(0, 20), asks: d.book.asks.slice(0, 20), ts: d.book.ts } : null, impact: bookImpact(d?.book ?? null, 'buy', 10_000), cross: d?.cross ?? {},
      quality: assessQuality(i.id), safety: assessCexAsset(i.id), regime: classifyRegime(d?.engines['1h'].last ?? null), indicators: readIndicators(f), prints: recentPrints(500).filter((p) => p.instrumentId === i.id).slice(0, 30) };
  });
  app.get('/api/fx', async () => ({ series: market.fx, asOf: market.fxFetchedAt, note: 'ECB daily reference rates via Frankfurter — not tradeable quotes.' }));
  app.get('/api/bubbles', async (req) => bubbleMap({ limit: Number((req.query as any).limit ?? 150), minVolume: Number((req.query as any).minVolume ?? 1e6) }));
  app.get('/api/dex', async () => ({ pairs: dexBoard(), asOf: market.dexFetchedAt, note: 'DEX tokens are never automation-eligible: contract-level honeypot checks require an on-chain provider (pending).' }));

  // ── scanner / decisions ──
  app.get('/api/scanner', async () => ({ board: [...board.values()].sort((a, b) => b.quoteVolume - a.quoteVolume), decisions: recentDecisions().map(slim), rejections: rejections.slice(-150).reverse(), lastScanAt: market.lastScanAt, strategies: STRATEGIES.map((s) => ({ id: s.id, name: s.name, version: s.version, interval: s.interval, regimes: s.suitableRegimes, description: s.description })) }));
  app.get('/api/decisions', async (req) => { const q = req.query as any; return all<any>(`SELECT id, instrument, strategy, decision, score, risk_decision, created_at FROM decisions ${q.decision ? 'WHERE decision=?' : ''} ORDER BY created_at DESC LIMIT 300`, ...(q.decision ? [q.decision] : [])); });
  app.get('/api/decisions/:id', async (req, reply) => { const r = get<any>('SELECT report, consensus_id FROM decisions WHERE id=?', (req.params as any).id); if (!r) return bad(reply, 404, 'not found'); const c = get<any>('SELECT record FROM consensus_records WHERE id=?', r.consensus_id); return { report: P(r.report), consensus: c ? P(c.record) : null }; });
  app.post('/api/analyze', async (req) => { const { symbol, strategyId } = z.object({ symbol: z.string().max(20), strategyId: z.string().optional() }).parse(req.body); const i = market.bySymbol(symbol); if (!i) throw new Error('unknown symbol'); return analyzeInstrument(i.id, strategyId); });

  // ── AI intelligence (workers / QCI) ──
  app.get('/api/intelligence', async () => {
    const stats = new Map(all<any>('SELECT * FROM worker_stats').map((s) => [s.worker_id, s]));
    const recs = all<any>('SELECT id, instrument, state, created_at, record FROM consensus_records ORDER BY created_at DESC LIMIT 40').map((r) => { const x = P<any>(r.record); delete x.packets; return x; });
    return { workers: WORKERS.map((w) => ({ id: w.id, name: w.name, domain: w.domain, version: w.version, dependencyGroup: w.dependencyGroup, sources: w.sourceIds, mandatory: !!w.mandatory, canVeto: !!w.canVeto, quarantined: quarantined.has(w.id), stats: stats.get(w.id) ?? null, pending: w.sourceIds.some((s) => ['evm_rpc', 'x_api', 'pending'].includes(s)) })),
      indicatorSpecialists: [...INDICATOR_SPECIALISTS.map((x) => ({ id: x.id, name: x.s.name, interval: x.iv })), { id: 'IND-49', name: 'EMA20 vs EMA50', interval: '1h' }, { id: 'IND-50', name: 'EMA50 vs EMA200', interval: '4h' }],
      domains: DOMAINS.map((d) => ({ domain: d, weight: DOMAIN_WEIGHTS[d], required: REQUIRED_DOMAINS.includes(d), workers: WORKERS.filter((w) => w.domain === d).length })), policy: QCI_POLICY, pool: POOL, consensus: recs,
      note: 'Workers are deterministic, versioned evaluators running in a bounded pool — not LLM agents. Confidence is NOT_CALIBRATED until walk-forward calibration is performed.' };
  });
  app.get('/api/consensus/:id', async (req, reply) => { const r = get<any>('SELECT record FROM consensus_records WHERE id=?', (req.params as any).id); return r ? P(r.record) : bad(reply, 404, 'not found'); });
  app.post('/api/workers/:id/release', async (req) => { releaseQuarantine((req.params as any).id); audit('owner', 'worker.release', { id: (req.params as any).id }); return { ok: true }; });

  // ── risk center ──
  app.get('/api/risk', async () => {
    const acct = accountState(); const pos = openPositions();
    const corr = pos.map((a) => pos.map((b) => correlation(a.instrument, b.instrument)));
    return { policy: currentPolicy(), defaults: DEFAULT_POLICY, history: policyHistory().slice(0, 20), account: acct, control: getControl(), display: displayMode(), positions: pos, correlation: { instruments: pos.map((p) => p.instrument), matrix: corr }, protection: oms.protectPositions(), gates: releaseGates() };
  });
  app.post('/api/risk/policy', async (req) => { const b = req.body as any; stepUp(b); return acceptPolicy('owner', b.policy); });
  app.post('/api/control', async (req) => {
    const b = z.object({ mode: z.enum(['OBSERVE', 'PAPER', 'APPROVAL', 'BOUNDED_LIVE']).optional(), pausedNewOrders: z.boolean().optional(), emergency: z.boolean().optional(), disabledStrategies: z.array(z.string()).optional(), password: z.string().optional() }).parse(req.body);
    const { password, ...patch } = b;
    if (patch.mode || patch.emergency === false) stepUp(b);
    return updateControl('owner', patch, (m) => {
      if (m === 'BOUNDED_LIVE') { const g = releaseGates(); if (!g.liveAllowed) return { ok: false, reason: `BOUNDED_LIVE blocked: ${g.summary}. No live venue adapter or isolated signer exists in this build.` }; }
      if ((m === 'PAPER' || m === 'APPROVAL') && !currentPolicy()) return { ok: false, reason: 'accept a risk policy before enabling paper execution' };
      return { ok: true };
    });
  });
  app.post('/api/emergency/:action', async (req) => {
    const a = (req.params as any).action; const b = req.body as any;
    if (a === 'pause') return oms.pauseNewOrders('owner');
    if (a === 'cancel-pending') return oms.cancelPendingEntries('owner');
    if (a === 'protect') return oms.protectPositions(true);
    if (a === 'stop') return oms.emergencyStop('owner');
    if (a === 'close-all') { stepUp(b); return oms.closeAllPositions('owner', b?.confirm); }
    throw new Error('unknown emergency action');
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
  app.post('/api/orders/:id/approve', async (req) => oms.decideApproval((req.params as any).id, true));
  app.post('/api/orders/:id/reject', async (req) => oms.decideApproval((req.params as any).id, false));
  app.post('/api/positions/:id/close', async (req) => oms.closePosition('owner', (req.params as any).id));

  // ── journal / calendar ──
  app.get('/api/journal', async (req) => listJournal(400, (req.query as any).kind));
  app.get('/api/calendar', async (req) => calendar(String((req.query as any).month ?? new Date().toISOString().slice(0, 7))));
  app.post('/api/calendar/tz', async (req) => { const { offsetMin } = z.object({ offsetMin: z.number().int().min(-720).max(840) }).parse(req.body); setSetting('calendarTzOffsetMin', offsetMin); return { ok: true }; });

  // ── strategy lab ──
  app.get('/api/lab', async () => ({ strategies: lab.listStrategies(), backtests: lab.listBacktests(30), universe: lab._universeSymbols() }));
  app.post('/api/lab/backtest', async (req) => { const b = z.object({ strategyId: z.string(), symbol: z.string(), bars: z.number().int().min(500).max(8000).optional() }).parse(req.body); return lab.runBacktest('owner', b.strategyId, b.symbol.toUpperCase(), b.bars); });
  app.post('/api/lab/strategy/:id/status', async (req) => { const b = z.object({ status: z.enum(['RESEARCH', 'BACKTESTED', 'PAPER', 'LIVE_CANDIDATE', 'SUSPENDED', 'RETIRED']), note: z.string().max(300).optional() }).parse(req.body); lab.setStrategyStatus('owner', (req.params as any).id, b.status, b.note); return { ok: true }; });

  // ── news / whales ──
  app.get('/api/news', async () => ({ items: recentNews(300), asOf: getSetting('newsAt', null), license: 'Google News RSS — personal, non-commercial use only.' }));
  app.post('/api/news/refresh', async () => { const n = await refreshNews(); setSetting('newsAt', Date.now()); return { added: n }; });
  app.get('/api/whales', async () => ({ prints: recentPrints(300), thresholds: market.universe.slice(0, 12).map((id) => ({ symbol: market.instruments.get(id)?.symbol, threshold: printThreshold(market.tickers.get(id)?.quoteVolume ?? 0) })), walletTracking: 'PENDING_CREDENTIALS: wallet-level whale tracking and copy trading require an on-chain provider.' }));

  // ── wallet ──
  app.get('/api/wallet', async () => ({ networks: wallet.NETWORKS, addresses: wallet.listAddresses(), withdrawals: wallet.listWithdrawals(), frozen: wallet.withdrawalFrozen(), custody: 'READ-ONLY build: no keys, no signer. Seed phrases are never requested.' }));
  app.post('/api/wallet/validate', async (req) => { const b = z.object({ network: z.string(), address: z.string().max(120) }).parse(req.body); return wallet.validateAddress(b.network, b.address); });
  app.post('/api/wallet/address', async (req) => { const b = z.object({ label: z.string().min(1).max(60), network: z.string(), address: z.string().max(120), memo: z.string().max(100).optional() }).parse(req.body); return wallet.addAddress('owner', b.label, b.network, b.address, b.memo); });
  app.post('/api/wallet/address/:id/verify', async (req) => { stepUp(req.body); wallet.verifyAddress('owner', (req.params as any).id); return { ok: true }; });
  app.delete('/api/wallet/address/:id', async (req) => { wallet.removeAddress('owner', (req.params as any).id); return { ok: true }; });
  app.post('/api/wallet/withdraw/preview', async (req) => { const b = z.object({ network: z.string(), asset: z.string(), amount: z.number(), addressId: z.string(), password: z.string() }).parse(req.body); stepUp(b); return wallet.previewWithdrawal('owner', b); });
  app.post('/api/wallet/freeze', async (req) => { const b = z.object({ on: z.boolean(), password: z.string().optional() }).parse(req.body); if (!b.on) stepUp(b); wallet.setWithdrawalFreeze('owner', b.on); return { frozen: b.on }; });

  // ── connections / notifications / settings / QA ──
  app.get('/api/connections', async () => ({ providers: providers(), latency: latencyReport() }));

  // ── Phase 1 workspaces ──
  app.get('/api/qhef', async () => qhefReport());
  app.get('/api/security', async (req) => securityOverview(tokenOf(req)));
  app.post('/api/security/sessions/revoke-others', async (req) => { stepUp(req.body); return revokeOtherSessions(tokenOf(req)); });
  app.get('/api/discover', async (req) => discover(Number((req.query as any).minVolume ?? 1e6)));
  const histFilter = (q: any): HistoryFilter => z.object({ from: z.coerce.number().int().positive().optional(), to: z.coerce.number().int().positive().optional(),
    instrument: z.string().max(20).regex(/^[A-Za-z0-9]*$/).optional(), status: z.enum(['NEW', 'FILLED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ACTIVE', 'PENDING_APPROVAL']).optional(),
    purpose: z.enum(['ENTRY', 'EXIT', 'PROTECTIVE_STOP']).optional() }).parse(q);
  app.get('/api/history', async (req) => tradingHistory(histFilter(req.query)));
  app.get('/api/history.csv', async (req, reply) => {
    const q = req.query as any; const h = tradingHistory(histFilter({ ...q, kind: undefined }));
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
  app.post('/api/notifications/read', async (req) => { markRead((req.body as any)?.id); return { ok: true }; });
  app.post('/api/notifications/test', async () => ({ id: notify('INFO', 'Test notification', 'Delivery check from Settings', 'settings') }));
  app.get('/api/settings', async () => ({ notifyPrefs: getSetting('notifyPrefs', { telegramMinSeverity: 'WARNING', quietHoursUtc: null }), calendarTzOffsetMin: getSetting('calendarTzOffsetMin', 0), joe: { model: config.joeModel, llm: !!config.anthropicApiKey, tools: JOE_TOOL_NAMES }, telegram: { configured: !!config.telegramBotToken } }));
  app.post('/api/settings/notify', async (req) => { const b = z.object({ telegramMinSeverity: z.enum(['INFO', 'WARNING', 'CRITICAL']), quietHoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).nullable() }).parse(req.body); setSetting('notifyPrefs', b); return { ok: true }; });
  app.get('/api/qa', async () => ({ ...releaseGates(), audit: verifyAuditChain() }));
  app.get('/api/audit', async () => recentAudit(200));

  // ── Trader Joe ──
  app.get('/api/joe', async () => ({ history: chatHistory(100), llm: !!config.anthropicApiKey, model: config.joeModel }));
  app.post('/api/joe', async (req) => { const { message } = z.object({ message: z.string().min(1).max(4000) }).parse(req.body); return askJoe(message); });
}
const slim = (r: any) => ({ id: r.id, asset: r.asset, instrumentId: r.instrumentId, strategy: r.strategy, regime: r.regime, decision: r.decision, finalDecision: r.finalDecision, score: r.opportunity.score, consensus: r.consensus, createdAt: r.createdAt, entryCondition: r.entryCondition, invalidation: r.invalidation, stopLoss: r.stopLoss, takeProfit: r.takeProfit, risk: r.risk ? { decision: r.risk.decision, reasonCodes: r.risk.reasonCodes } : null, missing: r.missingInformation });
