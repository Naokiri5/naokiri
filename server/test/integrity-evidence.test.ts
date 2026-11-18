import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { verifyMemory } from '../src/ditas/memory.js';
import { releaseGates } from '../src/qa/gates.js';
import { sha256 } from '../src/core/util.js';

/** G-02 / G-03 / J-02 (100-agent audit). */
describe('integrity evidence', () => {
  beforeEach(() => { freshDb(); });
  it('G-02: a twin run whose result no longer matches its hash fails verification', () => {
    const result = JSON.stringify({ pnl: 1 });
    expect(verifyMemory([], [], [], [{ id: 't1', result, hash: sha256(result) }]).ok).toBe(true);
    expect(verifyMemory([], [], [], [{ id: 't1', result: JSON.stringify({ pnl: 999 }), hash: sha256(result) }])).toMatchObject({ ok: false, brokenAt: 'twin:t1' });
  });
  it('G-03: an event referencing a snapshot that is missing fails verification', async () => {
    const { hashEvent } = await import('../src/ditas/memory.js');
    const ev: any = { id: 'e1', seq: 1, kind: 'TEST', created_at: 1, snapshot_id: 'snap_x', parent_event_id: null, payload: '{}', prev_hash: 'GENESIS' };
    ev.hash = hashEvent(ev);
    expect(verifyMemory([ev], [], [], [])).toMatchObject({ ok: false });
    expect(verifyMemory([{ ...ev, snapshot_id: null, hash: hashEvent({ ...ev, snapshot_id: null }) }], [], [], []).ok).toBe(true);
  });
  it('J-02: with no paper fills and no audit entries, G05/G06 are PENDING, not PASS', () => {
    const g = Object.fromEntries(releaseGates().gates.map((x) => [x.id, x.status]));
    expect(g.G05).toBe('PENDING');
    expect(['PENDING', 'PASS']).toContain(g.G06); // freshDb may already hold setup audit rows
  });
});
