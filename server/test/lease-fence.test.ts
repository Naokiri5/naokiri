import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { acquireOrRenewLease, withWriteFence, assertWriteFence, LeaseLostError, currentLease } from '../src/ops/lease.js';
import { run, tx } from '../src/db/db.js';

/** CodeRabbit PR #12: takeover decided from the persisted lease; bot writes fenced inside their own transaction. */
describe('engine lease: acquisition vs renewal, and the write fence', () => {
  beforeEach(() => freshDb());
  it('re-taking an expired lease this holder once had is an ACQUISITION, not a renewal', () => {
    expect(acquireOrRenewLease('engine', 'A', 1_000, 0)).toBe('ACQUIRED');
    expect(acquireOrRenewLease('engine', 'A', 1_000, 500)).toBe('RENEWED');
    expect(acquireOrRenewLease('engine', 'B', 1_000, 2_000)).toBe('ACQUIRED'); // A paused; B took over
    expect(acquireOrRenewLease('engine', 'A', 1_000, 2_500)).toBe('HELD_ELSEWHERE');
    // B stops renewing; A resumes and takes B's expired lease: A's cached role may still say LEADER, the outcome must not.
    expect(acquireOrRenewLease('engine', 'A', 1_000, 4_000)).toBe('ACQUIRED');
    // A holder's own EXPIRED lease is also an acquisition (others may have acted in between).
    expect(acquireOrRenewLease('engine', 'A', 1_000, 10_000)).toBe('ACQUIRED');
  });
  it('a fenced write aborts inside its transaction once the lease belongs to someone else', () => {
    run('CREATE TABLE fence_probe (n INTEGER)');
    acquireOrRenewLease('engine', 'A', 60_000);
    withWriteFence('engine', 'A', () => tx(() => { assertWriteFence(); run('INSERT INTO fence_probe VALUES (1)'); }));
    run("UPDATE runtime_leases SET holder='B' WHERE name='engine'"); // another instance took over while A was paused
    expect(() => withWriteFence('engine', 'A', () => tx(() => { assertWriteFence(); run('INSERT INTO fence_probe VALUES (2)'); }))).toThrow(LeaseLostError);
    expect(currentLease('engine')!.holder).toBe('B');
    // Outside a fence (owner API actions) the check is a no-op.
    tx(() => { assertWriteFence(); run('INSERT INTO fence_probe VALUES (3)'); });
  });
  it('an expired own lease also fails the fence', () => {
    acquireOrRenewLease('engine', 'A', 1, Date.now() - 10_000);
    expect(() => withWriteFence('engine', 'A', () => assertWriteFence())).toThrow(LeaseLostError);
  });
});
