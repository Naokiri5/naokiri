import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { listOrders } from '../src/exec/oms.js';
import { get, run } from '../src/db/db.js';
import { config } from '../src/config.js';
import { EngineLease } from '../src/bot/lease.js';
import { runStartupChecks } from '../src/core/startup.js';
import { startBot, stopBot, botStatus, botStatusView, engineLease, _test } from '../src/bot/bot.js';
import { buildApp } from '../src/index.js';
import type { DecisionReport } from '../src/decision/engine.js';

const net = vi.hoisted(() => ({ tickers: vi.fn(async () => {}) }));
vi.mock('../src/market/fabric.js', async (orig) => ({ ...(await orig<object>()), ensureRules: async () => {}, refreshTickers: net.tickers, refreshDeep: async () => {}, refreshBackground: async () => {} }));
vi.mock('../src/market/scanner.js', async (orig) => ({ ...(await orig<object>()), scanOnce: async () => {} }));
vi.mock('../src/news/news.js', async (orig) => ({ ...(await orig<object>()), refreshNews: async () => 0 }));
vi.mock('../src/whales/prints.js', async (orig) => ({ ...(await orig<object>()), scanPrints: async () => {} }));

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}
const entries = () => listOrders().filter((o: any) => o.purpose === 'ENTRY').length;
const lease = () => JSON.parse(get<any>("SELECT value FROM settings WHERE key='engine.lease'")!.value);

describe('headless engine: lease fence, startup checks, lane errors', () => {
  let id = ''; let last = 0; let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  beforeEach(() => {
    config.offline = false; freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    Object.assign(botStatus, { lastTickerAt: 0, lastMonitorAt: 0, lastScanAt: 0, cycles: 0, decisionsTotal: 0, laneErrors: { ticker: null, monitor: null, scan: null, background: null, startup: null } });
    runStartupChecks(); net.tickers.mockReset(); net.tickers.mockImplementation(async () => {});
  });
  afterEach(() => { stopBot(); config.offline = true; });

  it('owner process trades; a standby process creates zero orders from the same decision', async () => {
    startBot();
    expect(botStatusView()).toMatchObject({ running: true, lease: { state: 'OWNER', epoch: 1 }, startup: { ok: true, failed: [] } });
    _test.onDecision(report(id, last)); expect(entries()).toBe(1);
    stopBot();
    const other = new EngineLease(); expect(other.tick()).toBe(true); // another process now owns the engine
    startBot();
    expect(botStatusView()).toMatchObject({ running: false, lease: { state: 'STANDBY', epoch: 2 } });
    _test.onDecision(report(id, last)); await _test.hotLane(); await _test.scanLane();
    expect(entries()).toBe(1); expect(botStatus.decisionsTotal).toBe(1);
    expect(get<any>("SELECT summary FROM journal WHERE summary LIKE 'engine lease acquired%'")?.summary).toBe('engine lease acquired (epoch 1)');
  });

  it('a failed startup check keeps the engine stopped and names the check', () => {
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    expect(runStartupChecks().ok).toBe(false);
    startBot();
    const v = botStatusView();
    expect(v.running).toBe(false); expect(v.lease.state).toBe('VACANT'); expect(v.startup).toEqual({ ok: false, failed: ['audit_chain'] });
    expect(v.laneErrors.startup).toBe('STARTUP_CHECKS_FAILED: audit_chain'); expect(v.lastError).toBe('startup: STARTUP_CHECKS_FAILED: audit_chain');
  });

  it('a lane clears its own error on its next success; lastError mirrors the first lane error', async () => {
    startBot(); await vi.waitFor(() => expect(botStatus.cycles).toBe(1)); // initial hot → background → scan chain settled
    net.tickers.mockRejectedValueOnce(new Error('feed down'));
    await _test.hotLane();
    expect(botStatus.laneErrors.ticker).toBe('TICKER_REFRESH_FAILED'); expect(botStatusView().lastError).toBe('ticker: TICKER_REFRESH_FAILED');
    expect(JSON.stringify(botStatusView())).not.toMatch(/feed down/);
    await _test.hotLane();
    expect(botStatus.laneErrors.ticker).toBeNull(); expect(botStatusView().lastError).toBeNull();
  });

  it('an ownership switch between holds() and the write produces zero orders, positions or ledger rows', () => {
    startBot(); expect(engineLease.holds()).toBe(true);
    const row = lease(); run("UPDATE settings SET value=? WHERE key='engine.lease'", JSON.stringify({ ...row, instanceId: 'eng_other', epoch: row.epoch + 1 }));
    const counts = () => ['orders', 'positions', 'ledger_entries'].map((t) => get<any>(`SELECT COUNT(*) n FROM ${t}`)!.n);
    const before = counts();
    _test.onDecision(report(id, last));
    expect(counts()).toEqual(before); expect(before).toEqual([0, 0, 1]);
  });

  it('a failing monitor pass does not refresh the heartbeat; readiness fails until it recovers', async () => {
    startBot(); await vi.waitFor(() => expect(botStatus.cycles).toBe(1));
    _test.onDecision(report(id, last)); expect(entries()).toBe(1);
    const ready = async () => (await (app ??= await buildApp()).inject({ url: '/api/ready' })).json();
    expect((await ready()).checks.heartbeat).toBe('PASS');
    const good = get<any>("SELECT targets FROM positions WHERE status='OPEN'")!.targets;
    run("UPDATE positions SET targets='{' WHERE status='OPEN'");
    const at = botStatus.lastMonitorAt;
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 5)); await _test.hotLane();
      expect(botStatus.lastMonitorAt).toBe(at); expect(botStatus.lastTickerAt).toBeGreaterThan(at);
      expect(botStatus.laneErrors.monitor).toBe('MONITOR_FAILED'); expect(botStatusView().lastError).toBe('monitor: MONITOR_FAILED');
      expect((await ready()).checks.heartbeat).toBe('FAIL');
    }
    expect(get<any>("SELECT COUNT(*) n FROM journal WHERE summary LIKE 'monitor lane failed%'")!.n).toBe(1);
    run("UPDATE positions SET targets=? WHERE status='OPEN'", good);
    await _test.hotLane();
    expect(botStatus.lastMonitorAt).toBeGreaterThan(at); expect(botStatus.laneErrors.monitor).toBeNull();
    expect((await ready()).checks.heartbeat).toBe('PASS');
  });

  it('taking over re-runs startup checks: a stale PASS cannot schedule lanes on a now-corrupt database', () => {
    const other = new EngineLease(); expect(other.tick()).toBe(true);
    startBot(); expect(botStatusView()).toMatchObject({ running: false, lease: { state: 'STANDBY' }, startup: { ok: true } });
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    other.release();
    _test.leaseStep();
    const v = botStatusView();
    expect(v).toMatchObject({ running: false, lease: { state: 'VACANT' }, startup: { ok: false, failed: ['audit_chain'] } });
    expect(v.laneErrors.startup).toBe('STARTUP_CHECKS_FAILED: audit_chain');
    expect(net.tickers).not.toHaveBeenCalled(); expect(botStatus.lastTickerAt).toBe(0);
    expect(get<any>("SELECT COUNT(*) n FROM journal WHERE summary LIKE 'engine lease acquired%'")!.n).toBe(0);
  });

  it('stopBot releases the lease so a standby can take over immediately', () => {
    startBot(); expect(engineLease.holds()).toBe(true); const epoch = engineLease.epoch;
    stopBot();
    expect(botStatusView()).toMatchObject({ running: false, lease: { state: 'VACANT', epoch } });
    expect(lease()).toMatchObject({ epoch, released: true });
    const next = new EngineLease(); expect(next.tick()).toBe(true); expect(next.epoch).toBe(epoch + 1);
  });
});
