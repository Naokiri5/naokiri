/**
 * MIA5 feature 02: bounded, single-writer, multi-reader feature snapshots.
 * The existing reflexTelemetry.ts remains the ONLY Reflex health recorder.
 *
 * Metadata uses a 64-byte cache-line stride per symbol. A writer marks its
 * version odd before publishing and even afterward; readers accept only a
 * stable even version, otherwise return null (fail closed, not mixed ticks).
 *
 * Shared buffers are NOT a new QCI, worker pool, risk governor or OMS. No
 * guarantees about end-to-end <4 ms execution are made here.
 */
import { HIVE_FEATURE_SLOTS } from '../market/hiveFeatureVector.js';

export const HIVE_META_STRIDE = 16;
const META_VERSION = 0;
const META_SOURCE_SEQUENCE = 1;
export interface HiveSharedBuffers {
  readonly features: SharedArrayBuffer;
  readonly metadata: SharedArrayBuffer;
}
export interface HiveFeatureSnapshot {
  readonly sequence: number;
  readonly sourceSequence: number;
  /** Defensive copy: safe after the writer publishes a subsequent tick. */
  readonly features: Float64Array;
  readonly authority: 'OBSERVATION_ONLY';
}

const validIndex = (index: number, count: number) =>
  Number.isSafeInteger(index) && index >= 0 && index < count;

/**
 * This is intentionally synchronous and bounded. Under contention readers
 * return null and must abstain; they do not spin indefinitely on a hot lane.
 */
export function readHiveSnapshot(
  buffers: HiveSharedBuffers, symbolIndex: number, retries = 8,
): HiveFeatureSnapshot | null {
  if (!(buffers.features instanceof SharedArrayBuffer) ||
      !(buffers.metadata instanceof SharedArrayBuffer) ||
      buffers.features.byteLength % (HIVE_FEATURE_SLOTS * Float64Array.BYTES_PER_ELEMENT) !== 0 ||
      buffers.features.byteLength === 0 ||
      buffers.metadata.byteLength !== (buffers.features.byteLength /
        (HIVE_FEATURE_SLOTS * Float64Array.BYTES_PER_ELEMENT)) *
        HIVE_META_STRIDE * Int32Array.BYTES_PER_ELEMENT) {
    throw new Error('HIVE_SHARED_BUFFER_SHAPE_INVALID');
  }
  const count = buffers.features.byteLength / (HIVE_FEATURE_SLOTS * Float64Array.BYTES_PER_ELEMENT);
  if (!validIndex(symbolIndex, count) || !Number.isSafeInteger(retries) || retries < 1 || retries > 100)
    throw new RangeError('HIVE_SHARED_READER_ARGUMENT_INVALID');
  const data = new Float64Array(buffers.features);
  const meta = new Int32Array(buffers.metadata);
  const m = symbolIndex * HIVE_META_STRIDE;
  const start = symbolIndex * HIVE_FEATURE_SLOTS;
  for (let attempt = 0; attempt < retries; attempt++) {
    const first = Atomics.load(meta, m + META_VERSION);
    if (first === 0 || (first & 1)) continue;
    const sourceSequence = Atomics.load(meta, m + META_SOURCE_SEQUENCE);
    const copy = data.slice(start, start + HIVE_FEATURE_SLOTS);
    const second = Atomics.load(meta, m + META_VERSION);
    if (first === second && !(second & 1) && copy.every(Number.isFinite)) {
      return { sequence: second >>> 0, sourceSequence, features: copy, authority: 'OBSERVATION_ONLY' };
    }
  }
  return null;
}

export class HiveSharedSnapshotRouter {
  private readonly features: Float64Array;
  private readonly meta: Int32Array;
  private readonly indices = new Map<string, number>();

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536)
      throw new RangeError('HIVE_SHARED_CAPACITY_INVALID');
    this.features = new Float64Array(
      new SharedArrayBuffer(capacity * HIVE_FEATURE_SLOTS * Float64Array.BYTES_PER_ELEMENT)
    );
    this.meta = new Int32Array(
      new SharedArrayBuffer(capacity * HIVE_META_STRIDE * Int32Array.BYTES_PER_ELEMENT)
    );
  }

  buffers(): HiveSharedBuffers {
    return { features: this.features.buffer as SharedArrayBuffer, metadata: this.meta.buffer as SharedArrayBuffer };
  }

  /** Register a canonical instrument identifier; never silently recycle a slot. */
  register(instrumentId: string): number {
    if (typeof instrumentId !== 'string' || !instrumentId.trim())
      throw new Error('HIVE_INSTRUMENT_ID_INVALID');
    const existing = this.indices.get(instrumentId);
    if (existing !== undefined) return existing;
    if (this.indices.size === this.capacity) throw new Error('HIVE_SHARED_CAPACITY_EXCEEDED');
    const index = this.indices.size;
    this.indices.set(instrumentId, index);
    return index;
  }

  /**
   * Publish only complete, source-validated vectors. Sequence numbers are
   * bounded Int32 identifiers, not exchange timestamps or trading permits.
   */
  publish(symbolIndex: number, vector: Float64Array, sourceSequence: number): boolean {
    if (!validIndex(symbolIndex, this.capacity) ||
        !Number.isSafeInteger(sourceSequence) || sourceSequence < 1 ||
        sourceSequence > 0x7fffffff ||
        !(vector instanceof Float64Array) || vector.length !== HIVE_FEATURE_SLOTS ||
        !vector.every(Number.isFinite)) return false;
    const m = symbolIndex * HIVE_META_STRIDE;
    const version = Atomics.load(this.meta, m + META_VERSION);
    if (version & 1) return false; // another writer has the slot
    if (Atomics.compareExchange(this.meta, m + META_VERSION, version, version + 1) !== version)
      return false;
    try {
      this.features.set(vector, symbolIndex * HIVE_FEATURE_SLOTS);
      Atomics.store(this.meta, m + META_SOURCE_SEQUENCE, sourceSequence);
    } finally {
      // Atomic publish barrier; readers never accept the in-flight odd version.
      Atomics.store(this.meta, m + META_VERSION, (version + 2) | 0);
    }
    return true;
  }

  read(symbolIndex: number): HiveFeatureSnapshot | null {
    return readHiveSnapshot(this.buffers(), symbolIndex);
  }
}
