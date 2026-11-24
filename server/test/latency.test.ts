import { afterEach, describe, expect, it } from 'vitest';
import { latencyReport, record, resetLatency, timed } from '../src/core/latency.js';

afterEach(resetLatency);
describe('canonical QHEF latency window', () => {
  it('keeps exactly the latest 2000 observations with the existing percentile convention', () => {
    for (let i = 0; i < 4500; i++) record('fixture.hot', i);
    expect(latencyReport()).toEqual([{ stage: 'fixture.hot', samples: 2000,
      p50: 3500, p95: 4400, p99: 4480, max: 4499 }]);
  });
  it('ignores invalid samples, keeps stages isolated, and resets cleanly', () => {
    for (const x of [NaN, Infinity, -Infinity, -1]) record('invalid', x);
    record('', 1); record('fixture.a', 0); record('fixture.b', 3);
    expect(latencyReport()).toEqual([
      { stage: 'fixture.a', samples: 1, p50: 0, p95: 0, p99: 0, max: 0 },
      { stage: 'fixture.b', samples: 1, p50: 3, p95: 3, p99: 3, max: 3 },
    ]);
    resetLatency(); expect(latencyReport()).toEqual([]);
    record('fixture.a', 7); expect(latencyReport()[0].max).toBe(7);
  });
  it('records asynchronous work and failed operations without swallowing errors', async () => {
    expect(await timed('fixture.ok', async () => 42)).toBe(42);
    await expect(timed('fixture.fail', () => { throw new Error('fixture'); })).rejects.toThrow('fixture');
    expect(latencyReport().map(x => [x.stage, x.samples])).toEqual([['fixture.fail', 1], ['fixture.ok', 1]]);
  });
});
