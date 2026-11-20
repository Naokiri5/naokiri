import { describe, it, expect } from 'vitest';
import { liveEvidence, groupReasons } from './attention';

const TTL = 2 * 3600_000;
describe('no-trade evidence ageing', () => {
  it('ages monotonically from the request time and flips to STALE at the TTL between polls', () => {
    const row = { evidence: 'RECENT' as const, ageMs: TTL - 5_000 };
    expect(liveEvidence(row, 1_000, 1_000, TTL)).toEqual({ evidence: 'RECENT', ageMs: TTL - 5_000 });
    expect(liveEvidence(row, 1_000, 5_999, TTL).evidence).toBe('RECENT');
    expect(liveEvidence(row, 1_000, 6_000, TTL)).toEqual({ evidence: 'STALE', ageMs: TTL });
  });
  it('never turns fresher when the monotonic clock is behind the request time', () => {
    expect(liveEvidence({ evidence: 'STALE', ageMs: TTL + 1 }, 10_000, 5_000, TTL).evidence).toBe('STALE');
  });
  it('keeps UNKNOWN evidence and missing request times UNKNOWN', () => {
    expect(liveEvidence({ evidence: 'UNKNOWN', ageMs: null }, 1, 2, TTL).evidence).toBe('UNKNOWN');
    expect(liveEvidence({ evidence: 'RECENT', ageMs: 10 }, null, 2, TTL).evidence).toBe('UNKNOWN');
  });
  it('groups reasons in data, safety, consensus, risk, mode order and drops empty groups', () => {
    const g = groupReasons([{ group: 'risk', code: 'SPREAD', text: 'SPREAD 9bps' }, { group: 'data', code: 'NO_PRICE', text: 'NO_PRICE' }]);
    expect(g.map((x) => x.id)).toEqual(['data', 'risk']);
  });
});
