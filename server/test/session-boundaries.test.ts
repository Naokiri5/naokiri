import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { setupOwner } from '../src/api/auth.js';
import { _test as scheduler, botStatus, stopBot } from '../src/bot/bot.js';
import { config } from '../src/config.js';
import { updateControl } from '../src/core/mode.js';
import { all, closeDb, get, run } from '../src/db/db.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';
import { monitorPositions, submitEntry } from '../src/exec/oms.js';
import { market } from '../src/market/store.js';
import {
  activeSessionBoundaries, durableSessionStatus, enforceSessionLossBoundary, finishDurableClose,
  openPaperSpotSession, paperSpotEntryDenial, requestPaperSpotClose,
} from '../src/ops/durableSession.js';
import { acquireOrRenewLease } from '../src/ops/lease.js';
import { paperSpotSizeDenial } from '../src/ops/paperSpotEntry.js';
import type { EngineView } from '../src/ops/readiness.js';
import { paperLiquidationValue, sessionBoundaryUsage, type SessionBoundaryInput } from '../src/ops/sessionBoundaries.js';
import { paperSpotSessionPreflight } from '../src/ops/sessionPreflight.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { cashBalance, ledger, openPositions, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { eligiblePaperDecision } from './paperDecision.js';

const START = Date.UTC(2026, 10, 25, 1);
// 2% of the $10,000 fixture account: room for a few default-policy trades (each plans to lose at most ~$50).
const LIMITS: SessionBoundaryInput = { capitalLimitUsd: 5_000, maxSessionLossUsd: 200 };
// A 40% gap through the 5% stop: the realized loss exceeds the $200 limit before any exit can happen.
const GAP = 0.6;
const offline = config.offline;

afterEach(() => {
  config.offline = offline;
  stopBot();
  vi.useRealTimers();
  closeDb();
  market.reset();
});

/** A funded paper account with an accepted policy, PAPER mode and a leased engine, at START. */
function setup(holder = 'boundary-fixture') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START - 1_000);
  freshDb(true);
  market.reset();
  seedInstrument('BTCUSDT');
  const eth = seedInstrument('ETHUSDT');
  const sol = seedInstrument('SOLUSDT');
  setupOwner('session boundary fixture passphrase');
  acceptPolicy('owner', DEFAULT_POLICY);
  updateControl('owner', { mode: 'PAPER' });
  ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  const fence = acquireOrRenewLease('engine', holder, 600_000)!;
  const engine: EngineView = {
    running: true, role: 'LEADER', startedAt: START - 1_000,
    lastTickerAt: START, lastScanAt: START, lastMonitorAt: START, monitorFailing: false,
  };
  vi.setSystemTime(START);
  const open = (limits: unknown = LIMITS, at = Date.now()) => {
    // Exercise the production opener without network services (the preflight refuses offline engines).
    config.offline = false;
    try { return openPaperSpotSession(engine, fence, limits as SessionBoundaryInput, at); } finally { config.offline = offline; }
  };
  return { eth, sol, fence, engine, open };
}

/** Open the default session and fill one ETH entry a second later. */
async function sessionWithPosition(holder?: string) {
  const fixture = setup(holder);
  fixture.open();
  vi.setSystemTime(START + 1_000);
  const second = await eligiblePaperDecision(fixture.sol);
  expect(submitEntry(await eligiblePaperDecision(fixture.eth), 'bot', undefined, fixture.fence)).toMatchObject({ ok: true });
  return { ...fixture, second, position: openPositions()[0] };
}

function pendingApproval(id: string, at = Date.now()) {
  run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at)
    VALUES (?,?,?,'binance-paper','crypto:binance:BTCUSDT','BUY','MARKET',1,'PENDING_APPROVAL','ENTRY',?,?)`, id, `${id}-client`, PAPER_ACCOUNT, at, at);
}
const orderStatus = (id: string) => get<{ status: string }>('SELECT status FROM orders WHERE id=?', id)?.status;
const boundaryCheck = (engine: EngineView) =>
  paperSpotSessionPreflight(engine, Date.now()).checks.find((check) => check.id === 'session-boundaries');
const usageNow = () => sessionBoundaryUsage(activeSessionBoundaries()!, Date.now());

describe('owner-set session boundaries at Run Session', () => {
  it('rejects invalid boundaries atomically and records valid ones with the starting account value', () => {
    const { engine, open } = setup();
    pendingApproval('pre-session');
    expect(paperSpotSessionPreflight(engine, Date.now())).toMatchObject({ boundaries: null, paperEquityUsd: 10_000 });
    expect(boundaryCheck(engine)).toMatchObject({ status: 'INFO' });

    expect(() => open({ capitalLimitUsd: 20_000, maxSessionLossUsd: 100 })).toThrow('SESSION_CAPITAL_EXCEEDS_EQUITY');
    expect(() => open({ capitalLimitUsd: 1_000, maxSessionLossUsd: 2_000 })).toThrow('SESSION_LOSS_LIMIT_EXCEEDS_CAPITAL');
    for (const invalid of [
      { capitalLimitUsd: 0, maxSessionLossUsd: 10 }, { capitalLimitUsd: -1, maxSessionLossUsd: 10 },
      { capitalLimitUsd: Number.NaN, maxSessionLossUsd: 10 }, { capitalLimitUsd: Number.POSITIVE_INFINITY, maxSessionLossUsd: 10 },
      { capitalLimitUsd: 1_000 }, { capitalLimitUsd: 1_000, maxSessionLossUsd: 10, extra: true }, null,
    ]) expect(() => open(invalid)).toThrow();
    // Every refusal rolled back: no session, no boundaries and the pending approval is untouched.
    expect(durableSessionStatus()).toBeNull();
    expect(all('SELECT * FROM brainos_session_boundaries')).toEqual([]);
    expect(orderStatus('pre-session')).toBe('PENDING_APPROVAL');

    expect(open()).toMatchObject({ state: 'RUNNING', mind: 'SPOT_PAPER', fence_epoch: 1 });
    expect(activeSessionBoundaries()).toMatchObject({
      fence_epoch: 1, capital_limit_usd: 5_000, max_loss_usd: 200, start_equity_usd: 10_000, start_performance_usd: 0,
      set_at: START, breached_at: null, breach_reason: null,
    });
    expect(orderStatus('pre-session')).toBe('CANCELLED');
    expect(paperSpotSessionPreflight(engine, Date.now()).boundaries).toMatchObject({
      capitalLimitUsd: 5_000, maxSessionLossUsd: 200, capitalUsedUsd: 0, sessionPnlUsd: 0, openRiskToStopsUsd: 0, breachedAt: null,
    });
    expect(boundaryCheck(engine)).toMatchObject({ status: 'PASS', detail: expect.stringContaining('Capital in use $0.00 of $5000.00') });
  });

  it('rejects an entry beyond the session capital before any order, fill or ledger write', async () => {
    const { eth, fence, open } = setup();
    open({ capitalLimitUsd: 100, maxSessionLossUsd: 50 });
    vi.setSystemTime(START + 1_000);
    const decision = await eligiblePaperDecision(eth);
    const cash = cashBalance();
    const result = submitEntry(decision, 'bot', undefined, fence);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/^SESSION_CAPITAL_LIMIT: open 0\.00 \+ fill \d+\.\d{2} > limit 100\.00$/) });
    expect(get<{ status: string; reject_reason: string }>('SELECT status, reject_reason FROM orders WHERE decision_id=?', decision.id))
      .toMatchObject({ status: 'REJECTED', reject_reason: result.reason });
    expect(all('SELECT * FROM fills')).toEqual([]);
    expect(openPositions()).toEqual([]);
    expect(cashBalance()).toBe(cash);
    expect(reconcile().ok).toBe(true);
  });

  it('rejects an entry whose planned loss does not fit within the remaining loss headroom', async () => {
    const { eth, fence, open } = setup();
    open({ capitalLimitUsd: 5_000, maxSessionLossUsd: 10 });
    vi.setSystemTime(START + 1_000);
    const decision = await eligiblePaperDecision(eth);
    const result = submitEntry(decision, 'bot', undefined, fence);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/^SESSION_LOSS_HEADROOM: worst case -\d+\.\d{2} if every stop is hit < -10\.00 limit$/) });
    expect(get<{ status: string }>('SELECT status FROM orders WHERE decision_id=?', decision.id)).toEqual({ status: 'REJECTED' });
    expect(all('SELECT * FROM fills')).toEqual([]);
  });

  it('counts open positions and their stop risk toward the next entry', async () => {
    const { position } = await sessionWithPosition();
    const used = position.qty * position.entry_price;
    const usage = usageNow();
    expect(usage.capitalUsedUsd).toBeCloseTo(used, 9);
    // Liquidation value: right after entry the session is down by fees and half the spread, never up.
    expect(usage.sessionPnlUsd).toBeLessThan(0);
    expect(usage.sessionPnlUsd).toBeGreaterThan(-5);
    expect(usage.openRiskToStopsUsd).toBeGreaterThan(0);
    expect(usage.openRiskToStopsUsd).toBeLessThanOrEqual(position.planned_risk);
    expect(paperSpotSizeDenial(LIMITS.capitalLimitUsd - used + 1, 1, Date.now())).toMatch(/^SESSION_CAPITAL_LIMIT/);
    expect(paperSpotSizeDenial(LIMITS.capitalLimitUsd - used - 1, 1, Date.now())).toBeNull();
    const headroom = LIMITS.maxSessionLossUsd + usage.sessionPnlUsd! - usage.openRiskToStopsUsd!;
    expect(paperSpotSizeDenial(100, headroom - 0.01, Date.now())).toBeNull();
    expect(paperSpotSizeDenial(100, headroom + 0.01, Date.now())).toMatch(/^SESSION_LOSS_HEADROOM/);
    for (const [notional, loss] of [[0, 1], [100, 0], [Number.NaN, 1], [100, Number.POSITIVE_INFINITY]])
      expect(paperSpotSizeDenial(notional, loss, Date.now())).toBe('SESSION_ENTRY_INVALID');
  });

  it('includes a position opened before Run in the starting value and in capital in use', async () => {
    const { eth, fence, open } = setup();
    // No checkpoint yet: the existing owner-configured paper controls still allow this entry.
    expect(submitEntry(await eligiblePaperDecision(eth), 'bot', undefined, fence)).toMatchObject({ ok: true });
    const [carried] = openPositions();
    vi.setSystemTime(START + 1_000);
    const before = paperLiquidationValue(Date.now());
    open();
    expect(activeSessionBoundaries()).toMatchObject({ start_equity_usd: before.equityUsd, start_performance_usd: before.performanceUsd });
    expect(before.performanceUsd).toBeLessThan(0);
    expect(usageNow()).toMatchObject({ capitalUsedUsd: carried.qty * carried.entry_price, sessionPnlUsd: 0 });
  });

  it('suspends entries through REFLEX when a gap pushes session loss past the limit, while protection continues', async () => {
    const { eth, fence, engine, open, second } = await sessionWithPosition();
    vi.setSystemTime(START + 2_000);
    setBook(eth.inst.id, eth.last * GAP);
    expect(usageNow().sessionPnlUsd).toBeLessThanOrEqual(-LIMITS.maxSessionLossUsd);
    pendingApproval('waiting-approval');
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_LOSS_LIMIT_REACHED');
    expect(submitEntry(second, 'bot', undefined, fence)).toEqual({ ok: false, reason: 'SESSION_LOSS_LIMIT_REACHED' });
    expect(get('SELECT id FROM orders WHERE decision_id=?', second.id)).toBeUndefined();

    const halt = enforceSessionLossBoundary(Date.now())!;
    expect(halt.session).toMatchObject({ state: 'ENTRY_SUSPENDED_RISK_HALT', suspend_reason: 'RISK_HALT' });
    expect(halt.boundaries).toMatchObject({ breached_at: START + 2_000, breach_reason: 'SESSION_LOSS_LIMIT_REACHED' });
    expect(halt.sessionPnlUsd).toBeLessThanOrEqual(-LIMITS.maxSessionLossUsd);
    expect(orderStatus('waiting-approval')).toBe('CANCELLED');
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();
    expect(all("SELECT kind FROM brainos_session_events WHERE kind='SESSION_LOSS_LIMIT_REACHED'")).toHaveLength(1);
    expect(paperSpotSessionPreflight(engine, Date.now())).toMatchObject({
      state: 'ENTRY_SUSPENDED_RISK_HALT', canRun: false, canClose: true, boundaries: { breachedAt: START + 2_000 },
    });
    expect(boundaryCheck(engine)).toMatchObject({ status: 'BLOCKED', detail: expect.stringContaining('reached its $200.00 loss limit') });

    // A breach never weakens protection: the stop still exits the position and the ledger reconciles.
    vi.setSystemTime(START + 3_000);
    setBook(eth.inst.id, eth.last * GAP);
    monitorPositions(undefined, fence);
    expect(openPositions()).toEqual([]);
    expect(reconcile().ok).toBe(true);

    // Resuming needs an explicit close and a new authorization, which takes a fresh baseline.
    expect(requestPaperSpotClose()).toMatchObject({ state: 'CLOSING_DRAINING_ENTRIES' });
    expect(finishDurableClose(undefined, fence)).toMatchObject({ state: 'CLOSED' });
    vi.setSystemTime(START + 4_000);
    expect(open()).toMatchObject({ state: 'RUNNING', fence_epoch: 2 });
    const next = activeSessionBoundaries()!;
    expect(next).toMatchObject({ fence_epoch: 2, breached_at: null });
    expect(next.start_performance_usd).toBeCloseTo(cashBalance() - 10_000, 9);
    expect(paperSpotEntryDenial(fence, Date.now())).toBeNull();
    expect(get('SELECT breach_reason FROM brainos_session_boundaries WHERE fence_epoch=1')).toEqual({ breach_reason: 'SESSION_LOSS_LIMIT_REACHED' });
  });

  it('keeps a breach latched after the price recovers and after a failed state change', async () => {
    const { eth, fence, second } = await sessionWithPosition();
    vi.setSystemTime(START + 2_000);
    setBook(eth.inst.id, eth.last * GAP);
    // An entry check observes the breach before the REFLEX runs and latches it.
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_LOSS_LIMIT_REACHED');
    expect(activeSessionBoundaries()).toMatchObject({ breached_at: START + 2_000 });
    expect(durableSessionStatus()?.state).toBe('RUNNING');

    vi.setSystemTime(START + 3_000);
    setBook(eth.inst.id, eth.last);
    expect(usageNow().sessionPnlUsd).toBeGreaterThan(-LIMITS.maxSessionLossUsd);
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_LOSS_LIMIT_REACHED');
    expect(submitEntry(second, 'bot', undefined, fence)).toEqual({ ok: false, reason: 'SESSION_LOSS_LIMIT_REACHED' });

    // The state change fails (clock regression), yet entries stay blocked by the latch.
    run('UPDATE brainos_sessions SET updated_at=?', Date.now() + 60_000);
    expect(() => enforceSessionLossBoundary(Date.now())).toThrow('SESSION_CLOCK_REGRESSION');
    expect(durableSessionStatus()?.state).toBe('RUNNING');
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_LOSS_LIMIT_REACHED');

    // Once the clock is consistent again, the REFLEX completes from the latch even though the price recovered.
    vi.setSystemTime(START + 70_000);
    setBook(eth.inst.id, eth.last);
    const halt = enforceSessionLossBoundary(Date.now())!;
    expect(halt.session.state).toBe('ENTRY_SUSPENDED_RISK_HALT');
    expect(halt.boundaries.breached_at).toBe(START + 2_000);
    expect(halt.sessionPnlUsd).toBeGreaterThan(-LIMITS.maxSessionLossUsd);
  });

  it('fails closed without a breach when a position price is missing, stale or future-dated', async () => {
    const { eth, fence, engine } = await sessionWithPosition();
    const unverified = (label: string) => {
      expect(usageNow(), label).toMatchObject({ sessionPnlUsd: null, openRiskToStopsUsd: null, unverifiedMarks: [eth.inst.id] });
      expect(paperSpotEntryDenial(fence, Date.now()), label).toBe('SESSION_LOSS_UNVERIFIABLE');
      expect(paperSpotSizeDenial(100, 1, Date.now()), label).toBe('SESSION_LOSS_UNVERIFIABLE');
      expect(enforceSessionLossBoundary(Date.now()), label).toBeNull();
      expect(boundaryCheck(engine), label).toMatchObject({ status: 'UNVERIFIED' });
    };
    vi.setSystemTime(START + 2_000);
    const book = market.deep.get(eth.inst.id)!.book;
    market.tickers.delete(eth.inst.id);
    market.deep.get(eth.inst.id)!.book = { bids: [], asks: [], ts: Date.now() };
    unverified('missing');
    market.deep.get(eth.inst.id)!.book = book;
    vi.setSystemTime(START + 200_000);
    unverified('stale (a falling price frozen in the feed must not hide the loss)');
    setBook(eth.inst.id, eth.last, Date.now() + 5_000);
    unverified('future-dated');
    setBook(eth.inst.id, eth.last, Date.now());
    expect(paperSpotEntryDenial(fence, Date.now())).toBeNull();
    expect(durableSessionStatus()?.state).toBe('RUNNING');
    expect(activeSessionBoundaries()?.breached_at).toBeNull();
  });

  it('never counts owner deposits or withdrawals as session profit or loss', () => {
    const { fence, open } = setup();
    open();
    vi.setSystemTime(START + 1_000);
    ledger(PAPER_ACCOUNT, 'WITHDRAW', -3_000);
    expect(usageNow().sessionPnlUsd).toBeCloseTo(0, 9);
    expect(paperSpotEntryDenial(fence, Date.now())).toBeNull();
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1_000);
    expect(usageNow().sessionPnlUsd).toBeCloseTo(0, 9);
    expect(paperSpotEntryDenial(fence, Date.now())).toBeNull();
  });

  it('blocks entries for a running session that predates boundaries', () => {
    const { fence, engine } = setup();
    run(`INSERT INTO brainos_sessions(session_id,version,state,environment,mind,lease_holder,lease_acquired_at,fence_epoch,
      suspend_reason,started_at,closed_at,updated_at) VALUES ('brainos-autopilot',1,'RUNNING','PAPER','SPOT_PAPER',?,?,1,'NONE',?,NULL,?)`,
    fence.holder, fence.acquired_at, START, START);
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_BOUNDARIES_MISSING');
    expect(paperSpotSizeDenial(100, 1, Date.now())).toBe('SESSION_BOUNDARIES_MISSING');
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();
    expect(boundaryCheck(engine)).toMatchObject({ status: 'BLOCKED', detail: expect.stringContaining('no capital or loss limits') });
  });

  it('runs the REFLEX from the engine protection lane after the protective exit and alerts the owner', async () => {
    const { eth } = await sessionWithPosition(botStatus.instanceId);
    vi.setSystemTime(START + 2_000);
    setBook(eth.inst.id, eth.last * GAP);
    config.offline = false;
    botStatus.running = true;
    await scheduler.protectionLane();
    expect(botStatus.role).toBe('LEADER');
    // The protection pass ran first and exited at the gapped price; the REFLEX then suspended entries.
    expect(openPositions()).toEqual([]);
    expect(durableSessionStatus()).toMatchObject({ state: 'ENTRY_SUSPENDED_RISK_HALT' });
    expect(get<{ severity: string }>("SELECT severity FROM notifications WHERE title='Session loss limit reached'")).toEqual({ severity: 'CRITICAL' });
    expect(get("SELECT kind FROM journal WHERE summary LIKE 'Session loss limit of $200.00 reached%'")).toEqual({ kind: 'SYSTEM' });
  });
});

describe('schema v7 upgrade', () => {
  it('adds session boundaries to a v6 database without changing existing sessions', () => {
    closeDb();
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 6);
    raw.prepare(`INSERT INTO brainos_sessions(session_id,version,state,environment,mind,lease_holder,lease_acquired_at,fence_epoch,
      suspend_reason,started_at,closed_at,updated_at) VALUES ('brainos-autopilot',3,'RUNNING','PAPER','SPOT_PAPER','old',1,2,'NONE',1,NULL,2)`).run();
    migrate(raw);
    expect((raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
    expect(raw.prepare('SELECT state, version, fence_epoch FROM brainos_sessions').get()).toEqual({ state: 'RUNNING', version: 3, fence_epoch: 2 });
    expect(raw.prepare('SELECT COUNT(*) n FROM brainos_session_boundaries').get()).toEqual({ n: 0 });
    const insert = raw.prepare(`INSERT INTO brainos_session_boundaries(session_id,fence_epoch,capital_limit_usd,max_loss_usd,
      start_equity_usd,start_performance_usd,set_at) VALUES ('brainos-autopilot',?,?,?,100,0,1)`);
    expect(() => insert.run(3, 50, 60)).toThrow(/CHECK/);
    expect(() => insert.run(3, 0, 0)).toThrow(/CHECK/);
    insert.run(2, 50, 10);
    expect(() => insert.run(2, 50, 10)).toThrow(/UNIQUE|PRIMARY/);
    raw.close();
  });
});
