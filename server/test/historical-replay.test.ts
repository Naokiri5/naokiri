import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MAX_TAPE_LINE_BYTES, streamCompressedMarketTape, type HistoricalEvent } from '../src/lab/tape-reader.js';
import { replayBookProbes, replayTradeEvidence, type ReplayObservation, type TradeEvidenceAssessment } from '../src/lab/eventReplay.js';
import { TradeBarBuilder } from '../src/market/tradeBars.js';

const fp = 1_000_000_000n;
const book = (tsMs: number, ask = 100n * fp, quantity = 2n * fp, symbol = 'BTCUSDT') => ({
  type: 'BOOK_TICK' as const, venue: 'BINANCE_SPOT' as const, symbol, tsMs,
  bidFp: ask - fp, askFp: ask, availableTopQtyFp: quantity,
});
const encode = (v: unknown) => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? value.toString() : value);
async function collect(path: string, opts?: Parameters<typeof streamCompressedMarketTape>[1]) {
  const rows: HistoricalEvent[] = [];
  for await (const row of streamCompressedMarketTape(path, opts)) rows.push(row);
  return rows;
}
describe('compressed historical tape evidence', () => {
  let dir: string, file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mia-tape-')); file = join(dir, 'tape.ndjson.gz'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const launch = {
    type: 'MEMECOIN_LAUNCH_AUDIT', tsMs: 20, venue: 'SOLANA_JUPITER', symbol: 'TOKEN/SOL',
    mintAddress: '11111111111111111111111111111111', poolLiquiditySolFp: '100000000000',
    top10HolderBps: 2000, bundledSniperBps: 1000, mintAuthorityRevoked: false,
    freezeAuthorityRevoked: true, hasPermanentDelegate: false, hasTransferHook: false, transferFeeBps: 0,
  };
  it('preserves exact bigint values, equal-time order and false flags without coercion', async () => {
    const rows = [book(10, 9_007_199_254_740_993n), book(10), launch];
    writeFileSync(file, gzipSync(rows.map(encode).join('\r\n')));
    const result = await collect(file);
    expect(result[0]).toEqual(rows[0]);
    expect(result[1]).toEqual(rows[1]);
    expect(result[2]).toMatchObject({ mintAuthorityRevoked: false, poolLiquiditySolFp: 100_000_000_000n });
    expect(await collect(file, { startTsMs: 10, endTsMs: 10, venues: new Set(['BINANCE_SPOT']) })).toEqual(rows.slice(0, 2));
  });
  it.each([
    { ...book(10), tsMs: '10' },
    { ...book(10), tsMs: 1.5 },
    { ...book(10), venue: 'UNKNOWN' },
    { ...book(10), bidFp: 200n * fp },
    { ...book(10), availableTopQtyFp: -1n },
    { ...book(10), askFp: 100 },
    { ...book(10), askFp: '0x100' },
    { ...book(10), type: 'UNKNOWN' },
    { ...launch, mintAuthorityRevoked: 'false' },
    { ...launch, top10HolderBps: 10_001 },
    { type: 'FUNDING_TICK', tsMs: 10, venue: 'BINANCE_SPOT', symbol: 'BTCUSDT', fundingRateBpsFp: '1' },
  ])('rejects invalid typed evidence', async invalid => {
    writeFileSync(file, gzipSync(encode(invalid)));
    await expect(collect(file)).rejects.toThrow('TAPE_INVALID_EVENT');
  });
  it('validates an out-of-window suffix rather than hiding nonmonotonic events', async () => {
    writeFileSync(file, gzipSync([book(10), book(30), book(5)].map(encode).join('\n')));
    await expect(collect(file, { endTsMs: 10 })).rejects.toThrow('TAPE_NON_MONOTONIC');
  });
  it('rejects oversized records, invalid gzip, missing file and malformed JSON', async () => {
    writeFileSync(file, gzipSync(' '.repeat(MAX_TAPE_LINE_BYTES + 1)));
    await expect(collect(file)).rejects.toThrow('TAPE_LINE_TOO_LONG');
    writeFileSync(file, gzipSync('{'));
    await expect(collect(file)).rejects.toThrow('TAPE_PARSE_ERROR');
    writeFileSync(file, Buffer.from('not gzip'));
    await expect(collect(file)).rejects.toThrow();
    await expect(collect(join(dir, 'missing.gz'))).rejects.toThrow();
  });
  it('closes the stream on early consumer cancellation', async () => {
    writeFileSync(file, gzipSync([book(10), book(20)].map(encode).join('\n')));
    for await (const row of streamCompressedMarketTape(file)) { expect(row.tsMs).toBe(10); break; }
    expect(await collect(file)).toHaveLength(2);
  });
});
describe('causal historical book replay', () => {
  const options = { venue: 'BINANCE_SPOT' as const, symbol: 'BTCUSDT', latencyMs: 10, maxWaitMs: 50, feeBps: 10, slippageBps: 5 };
  it('uses only later relevant observations, charges costs and never fills at EOF', async () => {
    const events = [book(100), book(100), book(105), book(110, 800n * fp, 2n * fp, 'ETHUSDT'), book(120, 105n * fp), book(130)];
    const run = async () => {
      const observations: ReplayObservation[] = [];
      let calls = 0;
      const result = await replayBookProbes(events, options, () =>
        ++calls === 1 || calls === 5 ? { side: 'buy', qtyFp: fp } : null, row => observations.push(row));
      return { result, observations };
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(first.result).toMatchObject({ observed: 1, endOfTape: 1, tradingAuthority: false, evidence: 'RESEARCH_UNVERIFIED_TAPE' });
    expect(first.observations[0]).toMatchObject({ signalTsMs: 100, dueTsMs: 110, observedTsMs: 120,
      priceFp: 105_052_500_000n, feeQuoteFp: 105_052_500n });
    expect(first.observations[1]).toMatchObject({ status: 'END_OF_TAPE', observedTsMs: null, priceFp: null });
  });
  it('does not spend the same observed top depth twice', async () => {
    const result = await replayBookProbes([book(100), book(101), book(120, 100n * fp, fp)], options,
      event => event.tsMs < 120 ? { side: 'buy', qtyFp: fp } : null);
    expect(result).toMatchObject({ probes: 2, observed: 1, insufficient: 1 });
  });
  it('expires stale probes and rejects reversed clocks and invalid latency', async () => {
    const signal = () => ({ side: 'sell' as const, qtyFp: fp });
    expect(await replayBookProbes([book(100), book(200)], options, signal)).toMatchObject({ expired: 1, endOfTape: 1 });
    await expect(replayBookProbes([book(100), book(99)], options, signal)).rejects.toThrow('REPLAY_NON_MONOTONIC');
    await expect(replayBookProbes([], { ...options, latencyMs: 0 }, signal)).rejects.toThrow('INVALID_REPLAY_OPTIONS');
  });
});

describe('trade-evidence replay (live/replay parity)', () => {
  let dir: string, file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mia-trade-tape-')); file = join(dir, 'trades.ndjson.gz'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const T = 1_800_000_000_000;
  const BARS = {
    baseIntervalMs: 1_000, intervalsMs: [1_000, 5_000, 15_000], allowedLatenessMs: 1_000, maxFutureSkewMs: 1_000,
    maxFinalBars: 200, maxTradesPerBaseBar: 1_000, maxParticipantsPerBar: 1_000, retractionWindowMs: 10_000, maxSeenIds: 100_000,
  };
  const options = { venue: 'SOLANA_JUPITER' as const, symbol: 'MEME/SOL', bars: BARS, detectorIntervalsMs: [1_000, 5_000, 15_000], launchTsMs: T - 3_600_000 };
  /** Deterministic bursty baseline for 20 minutes, then 15 seconds of broad-based buying, then a quiet tail. */
  function tape() {
    let state = 7, n = 0;
    const random = () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32;
    const rows: object[] = [];
    const tick = (tsMs: number, qty: bigint, participant: string, aggressor: 'buy' | 'sell') => rows.push({
      type: 'TRADE_TICK', tsMs, venue: 'SOLANA_JUPITER', symbol: 'MEME/SOL', eventId: `sig${++n}:0`,
      priceFp: fp.toString(), baseQtyFp: qty.toString(), aggressor, participant, finality: 'final',
    });
    for (let s = 0; s < 1_200; s++) {
      const count = Math.floor(random() * 7);
      for (let k = 0; k < count; k++) tick(T + s * 1_000 + k * 100, fp * BigInt(1 + Math.floor(random() ** 3 * 9)), `organic${(s * 7 + k) % 40}`, random() < 0.55 ? 'buy' : 'sell');
    }
    for (let s = 0; s < 15; s++) for (let i = 0; i < 20; i++) tick(T + 1_200_000 + s * 1_000 + i * 10, 5n * fp, `buyer${i}`, 'buy');
    // An unrelated instrument keeps the virtual clock moving, so the final bars close without more MEME trades.
    rows.push(book(T + 1_220_000));
    return rows;
  }
  const write = (rows: object[]) => writeFileSync(file, gzipSync(rows.map(encode).join('\n') + '\n'));

  it('replays a compressed tape deterministically through the live bar builder and detector', async () => {
    write(tape());
    const seen: TradeEvidenceAssessment[] = [];
    const first = await replayTradeEvidence(streamCompressedMarketTape(file), options, (row) => seen.push(row));
    const second = await replayTradeEvidence(streamCompressedMarketTape(file), options);
    expect(second.determinismHash).toBe(first.determinismHash);
    expect(first).toMatchObject({ tradingAuthority: false, evidence: 'RESEARCH_UNVERIFIED_TAPE', policyVersion: 'volume-spike.v1' });
    expect(first.ingest).toEqual({ ACCEPTED: first.trades });
    expect(first.verdicts.AUTHENTIC_SPIKE).toBeGreaterThanOrEqual(1);
    const spike = seen.find((row) => row.assessment.verdict === 'AUTHENTIC_SPIKE')!;
    expect(spike.barStartMs).toBeGreaterThanOrEqual(T + 1_200_000);
    expect(spike.assessment.tradingAuthority).toBe(false);
  });

  it('produces the same bars as feeding the live builder directly', async () => {
    const rows = tape();
    write(rows);
    const replay = await replayTradeEvidence(streamCompressedMarketTape(file), options);
    const live = new TradeBarBuilder({ ...BARS, instrumentId: 'SOLANA_JUPITER:MEME.SOL' });
    for await (const event of streamCompressedMarketTape(file)) {
      if (event.type !== 'TRADE_TICK') { live.advance(event.tsMs); continue; }
      live.ingest({ instrumentId: live.config.instrumentId, eventId: event.eventId, eventTimeMs: event.tsMs, priceFp: event.priceFp,
        baseQtyFp: event.baseQtyFp, aggressor: event.aggressor, participant: event.participant, finality: event.finality }, event.tsMs);
    }
    expect(live.digest()).toBe(replay.barsDigest);
  });

  it('rejects malformed trade ticks instead of defaulting them', async () => {
    const valid = { type: 'TRADE_TICK', tsMs: 1, venue: 'SOLANA_JUPITER', symbol: 'MEME/SOL', eventId: 'sig1:0',
      priceFp: '1000000000', baseQtyFp: '1000000000', aggressor: 'buy', finality: 'final' };
    for (const bad of [
      { ...valid, priceFp: '0' }, { ...valid, priceFp: 1_000_000_000 }, { ...valid, aggressor: 'long' },
      { ...valid, finality: undefined }, { ...valid, participant: 'not a wallet!' }, { ...valid, extra: true },
    ]) {
      write([bad]);
      await expect(collect(file)).rejects.toThrow('TAPE_INVALID_EVENT');
    }
    write([valid]);
    expect(await collect(file)).toEqual([{ ...valid, priceFp: fp, baseQtyFp: fp }]);
  });

  it('rejects options whose detector windows are not built', async () => {
    await expect(replayTradeEvidence([], { ...options, detectorIntervalsMs: [60_000] })).rejects.toThrow('INVALID_TRADE_REPLAY_OPTIONS');
  });
});
