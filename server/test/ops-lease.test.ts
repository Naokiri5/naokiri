import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { tryAcquireLease, releaseLease, currentLease } from '../src/ops/lease.js';
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
