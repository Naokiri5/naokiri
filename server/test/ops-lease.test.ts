import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { DatabaseSync } from 'node:sqlite';
import { tryAcquireLease, releaseLease, currentLease, acquireOrRenewLease, assertWriteFence, LeaseLostError } from '../src/ops/lease.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations.js';
import { tx } from '../src/db/db.js';
import { run } from '../src/db/db.js';
import { botStatus, drainBot, ENGINE_LEASE, _test } from '../src/bot/bot.js';

describe('runtime lease (single-runner engine lock)', () => {
  beforeEach(() => freshDb());
  it('only one of two holders wins while the lease is live', () => {
    const t = 1_000_000;
    expect(tryAcquireLease('engine', 'A', 45_000, t)).toBe(true);
    expect(tryAcquireLease('engine', 'B', 45_000, t + 1)).toBe(false);
    expect(tryAcquireLease('engine', 'A', 45_000, t + 10_000)).toBe(true); // renewal extends
    expect(currentLease('engine')).toMatchObject({ holder: 'A', acquired_at: t, expires_at: t + 55_000 });
    expect(tryAcquireLease('engine', 'B', 45_000, t + 50_000)).toBe(false); // still inside the renewed window
  });
  it('a standby takes over only after expiry, and the old holder cannot renew afterwards', () => {
    expect(tryAcquireLease('engine', 'A', 1_000, 0)).toBe(true);
    expect(tryAcquireLease('engine', 'B', 1_000, 1_000)).toBe(false); // expires_at == now is not yet expired
    expect(tryAcquireLease('engine', 'B', 1_000, 1_001)).toBe(true);
    expect(tryAcquireLease('engine', 'A', 1_000, 1_002)).toBe(false);
    expect(currentLease('engine')!.holder).toBe('B');
  });
  it('release frees the lease only for its own holder', () => {
    tryAcquireLease('engine', 'A', 60_000, 0);
    expect(releaseLease('engine', 'B')).toBe(false);
    expect(releaseLease('engine', 'A')).toBe(true);
    expect(tryAcquireLease('engine', 'B', 60_000, 1)).toBe(true);
  });
  it('rejects a non-positive ttl', () => { expect(() => tryAcquireLease('engine', 'A', 0)).toThrow(); });
});

describe('lease fencing epoch', () => {
  beforeEach(() => freshDb());
  it('takeover after expiry increases the epoch', () => {
    const a = acquireOrRenewLease('engine', 'A', 1_000, 0)!;
    const b = acquireOrRenewLease('engine', 'B', 1_000, 1_001)!;
    expect(b.epoch).toBeGreaterThan(a.epoch);
    expect(currentLease('engine')!.epoch).toBe(b.epoch);
  });
  it('release then re-acquire never reuses an epoch', () => {
    const a = acquireOrRenewLease('engine', 'A', 60_000, 0)!;
    expect(releaseLease('engine', 'A')).toBe(true);
    const again = acquireOrRenewLease('engine', 'A', 60_000, 1)!;
    expect(again.epoch).toBeGreaterThan(a.epoch);
  });
  it('two acquisitions at the same injected clock get distinct epochs', () => {
    const a = acquireOrRenewLease('engine', 'A', 1_000, 5_000)!;
    expect(releaseLease('engine', 'A')).toBe(true);
    const b = acquireOrRenewLease('engine', 'B', 1_000, 5_000)!;
    expect(b.acquired_at).toBe(a.acquired_at);
    expect(b.epoch).not.toBe(a.epoch);
  });
  it('a renewal by the same holder keeps the epoch', () => {
    const a = acquireOrRenewLease('engine', 'A', 60_000, 0)!;
    const r = acquireOrRenewLease('engine', 'A', 60_000, 10)!;
    expect(r.epoch).toBe(a.epoch);
    expect(r.acquired_at).toBe(a.acquired_at);
  });
  it('a stale fence with the same holder and acquired_at is rejected', () => {
    const old = acquireOrRenewLease('engine', 'A', 60_000, Date.now())!;
    releaseLease('engine', 'A');
    // Same holder and timestamp, new generation: only the epoch tells them apart.
    run('INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at,epoch) VALUES (?,?,?,?,?,?)',
      'engine', 'A', old.acquired_at, old.renewed_at, old.expires_at, old.epoch + 1);
    expect(() => tx(() => assertWriteFence(old))).toThrow(LeaseLostError);
    expect(() => tx(() => assertWriteFence({ ...old, epoch: old.epoch + 1 }))).not.toThrow();
  });
  it('a corrupted epoch makes the lease invalid (fail closed) instead of being trusted', () => {
    const l = acquireOrRenewLease('epoch-corrupt', 'a', 1000, 1000)!;
    run("UPDATE runtime_leases SET epoch=-1 WHERE name='epoch-corrupt'");
    expect(acquireOrRenewLease('epoch-corrupt', 'b', 1000, 5000)).toBeNull(); // malformed row: no takeover
    expect(() => tx(() => assertWriteFence({ ...l, epoch: -1 }))).toThrow(LeaseLostError);
  });

  it('upgrades from the previous schema, keeping existing leases', () => {
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 11); // the schema just before the lease-epoch migration (12)
    raw.prepare("INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at) VALUES ('engine','old',1,1,2)").run();
    migrate(raw);
    expect(raw.prepare("SELECT holder, epoch FROM runtime_leases WHERE name='engine'").get()).toMatchObject({ holder: 'old', epoch: 0 });
    expect(raw.prepare('SELECT COUNT(*) n FROM runtime_lease_epochs').get()).toMatchObject({ n: 1 });
    raw.close();
  });
});

describe('engine lanes respect the lease', () => {
  beforeEach(() => freshDb());
  it('a running instance that does not hold the lease is STANDBY and its lanes do nothing', async () => {
    run('INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at) VALUES (?,?,?,?,?)', ENGINE_LEASE, 'other-host:1:x', Date.now(), Date.now(), Date.now() + 600_000);
    botStatus.running = true; botStatus.role = 'STOPPED';
    const before = botStatus.lastTickerAt;
    try {
      expect(_test.holdEngine()).toBe(false);
      expect(botStatus.role).toBe('STANDBY');
      await _test.hotLane(); await _test.scanLane(); await _test.backgroundLane();
      expect(botStatus.lastTickerAt).toBe(before); // no market work done without the lease
      expect(currentLease(ENGINE_LEASE)!.holder).toBe('other-host:1:x');
    } finally { botStatus.running = false; botStatus.role = 'STOPPED'; }
  });
  it('the leader acquires, and a graceful drain releases the lease for a successor', async () => {
    botStatus.running = true;
    expect(_test.holdEngine()).toBe(true);
    expect(botStatus.role).toBe('LEADER');
    expect(currentLease(ENGINE_LEASE)!.holder).toBe(botStatus.instanceId);
    expect(await drainBot(1_000)).toBe(true);
    expect(botStatus.role).toBe('STOPPED');
    expect(currentLease(ENGINE_LEASE)).toBeNull();
  });
});
