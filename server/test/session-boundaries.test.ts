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
import { acquireOrRenewLease, type LeaseFence } from '../src/ops/lease.js';
import { paperSpotCapitalDenial } from '../src/ops/paperSpotEntry.js';
import type { EngineView } from '../src/ops/readiness.js';
import { sessionBoundaryUsage, type SessionBoundaryInput } from '../src/ops/sessionBoundaries.js';
import { paperSpotSessionPreflight } from '../src/ops/sessionPreflight.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { cashBalance, ledger, openPositions, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { eligiblePaperDecision } from './paperDecision.js';

const START = Date.UTC(2026, 10, 25, 1);
const LIMITS: SessionBoundaryInput = { capitalLimitUsd: 5_000, maxSessionLossUsd: 20 };
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

function pendingApproval(id: string, at = Date.now()) {
  run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at)
    VALUES (?,?,?,'binance-paper','crypto:binance:BTCUSDT','BUY','MARKET',1,'PENDING_APPROVAL','ENTRY',?,?)`, id, `${id}-client`, PAPER_ACCOUNT, at, at);
}
const orderStatus = (id: string) => get<{ status: string }>('SELECT status FROM orders WHERE id=?', id)?.status;
const boundaryCheck = (engine: EngineView) =>
  paperSpotSessionPreflight(engine, Date.now()).checks.find((check) => check.id === 'session-boundaries');

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
      fence_epoch: 1, capital_limit_usd: 5_000, max_loss_usd: 20, start_equity_usd: 10_000, start_performance_usd: 0,
      set_at: START, breached_at: null, breach_reason: null,
    });
    expect(orderStatus('pre-session')).toBe('CANCELLED');
    expect(paperSpotSessionPreflight(engine, Date.now()).boundaries).toMatchObject({
      capitalLimitUsd: 5_000, maxSessionLossUsd: 20, capitalUsedUsd: 0, sessionPnlUsd: 0, breachedAt: null,
    });
    expect(boundaryCheck(engine)).toMatchObject({ status: 'PASS', detail: expect.stringContaining('Capital in use $0.00 of $5000.00') });
  });

  it('rejects an entry whose executed notional would exceed the session capital, without touching the ledger', async () => {
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

  it('suspends entries through REFLEX when verified session loss reaches the limit, while protection continues', async () => {
    const { eth, sol, fence, engine, open } = setup();
    open();
    vi.setSystemTime(START + 1_000);
    const first = await eligiblePaperDecision(eth);
    const second = await eligiblePaperDecision(sol);
    expect(submitEntry(first, 'bot', undefined, fence)).toMatchObject({ ok: true });
    const [position] = openPositions();

    // Capital in use counts every open position at its entry cost.
    const used = position.qty * position.entry_price;
    expect(sessionBoundaryUsage(activeSessionBoundaries()!, Date.now()).capitalUsedUsd).toBeCloseTo(used, 9);
    expect(paperSpotCapitalDenial(LIMITS.capitalLimitUsd - used + 1, Date.now())).toMatch(/^SESSION_CAPITAL_LIMIT/);
    expect(paperSpotCapitalDenial(LIMITS.capitalLimitUsd - used - 1, Date.now())).toBeNull();
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();

    // The price falls 4%: still above the 5% stop, so the position stays open with an unrealized loss beyond $20.
    vi.setSystemTime(START + 2_000);
    setBook(eth.inst.id, eth.last * 0.96);
    expect(sessionBoundaryUsage(activeSessionBoundaries()!, Date.now()).sessionPnlUsd).toBeLessThanOrEqual(-LIMITS.maxSessionLossUsd);
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
    expect(all<{ kind: string }>("SELECT kind FROM brainos_session_events WHERE kind='SESSION_LOSS_LIMIT_REACHED'")).toHaveLength(1);
    expect(paperSpotSessionPreflight(engine, Date.now())).toMatchObject({
      state: 'ENTRY_SUSPENDED_RISK_HALT', canRun: false, canClose: true, boundaries: { breachedAt: START + 2_000 },
    });
    expect(boundaryCheck(engine)).toMatchObject({ status: 'BLOCKED', detail: expect.stringContaining('reached its $20.00 loss limit') });

    // A breach never weakens protection: the stop still exits the position and the ledger reconciles.
    vi.setSystemTime(START + 3_000);
    setBook(eth.inst.id, eth.last * 0.94);
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

  it('fails closed without tripping the REFLEX when a position price is missing', async () => {
    const { eth, fence, engine, open } = setup();
    open();
    vi.setSystemTime(START + 1_000);
    expect(submitEntry(await eligiblePaperDecision(eth), 'bot', undefined, fence)).toMatchObject({ ok: true });
    vi.setSystemTime(START + 2_000);
    market.tickers.delete(eth.inst.id);
    market.deep.get(eth.inst.id)!.book = { bids: [], asks: [], ts: Date.now() };
    expect(sessionBoundaryUsage(activeSessionBoundaries()!, Date.now())).toMatchObject({ sessionPnlUsd: null, marksMissing: [eth.inst.id] });
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_LOSS_UNVERIFIABLE');
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();
    expect(durableSessionStatus()?.state).toBe('RUNNING');
    expect(boundaryCheck(engine)).toMatchObject({ status: 'UNVERIFIED' });
  });

  it('never counts owner deposits or withdrawals as session profit or loss', () => {
    const { fence, open } = setup();
    open();
    vi.setSystemTime(START + 1_000);
    ledger(PAPER_ACCOUNT, 'WITHDRAW', -3_000);
    expect(sessionBoundaryUsage(activeSessionBoundaries()!, Date.now()).sessionPnlUsd).toBeCloseTo(0, 9);
    expect(paperSpotEntryDenial(fence, Date.now())).toBeNull();
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1_000);
    expect(sessionBoundaryUsage(activeSessionBoundaries()!, Date.now()).sessionPnlUsd).toBeCloseTo(0, 9);
    expect(paperSpotEntryDenial(fence, Date.now())).toBeNull();
  });

  it('blocks entries for a running session that predates boundaries', () => {
    const { fence, engine } = setup();
    run(`INSERT INTO brainos_sessions(session_id,version,state,environment,mind,lease_holder,lease_acquired_at,fence_epoch,
      suspend_reason,started_at,closed_at,updated_at) VALUES ('brainos-autopilot',1,'RUNNING','PAPER','SPOT_PAPER',?,?,1,'NONE',?,NULL,?)`,
    fence.holder, fence.acquired_at, START, START);
    expect(paperSpotEntryDenial(fence, Date.now())).toBe('SESSION_BOUNDARIES_MISSING');
    expect(paperSpotCapitalDenial(100, Date.now())).toBe('SESSION_BOUNDARIES_MISSING');
    expect(enforceSessionLossBoundary(Date.now())).toBeNull();
    expect(boundaryCheck(engine)).toMatchObject({ status: 'BLOCKED', detail: expect.stringContaining('no capital or loss limits') });
  });

  it('runs the REFLEX from the engine protection lane and alerts the owner', async () => {
    const { eth, open } = setup(botStatus.instanceId);
    const fence = get<LeaseFence>("SELECT * FROM runtime_leases WHERE name='engine'")!;
    open();
    vi.setSystemTime(START + 1_000);
    expect(submitEntry(await eligiblePaperDecision(eth), 'bot', undefined, { ...fence, name: 'engine' })).toMatchObject({ ok: true });
    vi.setSystemTime(START + 2_000);
    setBook(eth.inst.id, eth.last * 0.96);
    config.offline = false;
    botStatus.running = true;
    await scheduler.protectionLane();
    expect(botStatus.role).toBe('LEADER');
    expect(durableSessionStatus()).toMatchObject({ state: 'ENTRY_SUSPENDED_RISK_HALT' });
    expect(openPositions()).toHaveLength(1);
    expect(get<{ severity: string }>("SELECT severity FROM notifications WHERE title='Session loss limit reached'")).toEqual({ severity: 'CRITICAL' });
    expect(get("SELECT kind FROM journal WHERE summary LIKE 'Session loss limit reached%'")).toEqual({ kind: 'SYSTEM' });
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
