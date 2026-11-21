/**
 * MIA5-ID-01..04, adapted from the user's exact archived bootstrap.
 *
 * This shared-memory contract is OBSERVABILITY ONLY. Do not confuse the
 * proposed 10ms engineering budget with measured execution performance.
 * The canonical MIA decision engine, risk gate and OMS retain all authority.
 *
 * Key fix: source used a 250ms heartbeat but tripped at >50ms. This version
 * defaults to a 25ms heartbeat and a conservative 200ms stall threshold.
 */
export const REFLEX_BUDGET_NS = 10_000_000n;
export const REFLEX_STALL_TIMEOUT_NS = 200_000_000n;
export const REFLEX_WARMUP_TICKS = 5_000n;
export const TELEMETRY_SAB_BYTES = 16 * BigInt64Array.BYTES_PER_ELEMENT;

export const ReflexWorkerState = {
  INIT: 0n, WARMING_UP: 1n, HEALTHY: 2n, DEGRADED_LATENCY: 3n, HALTED: 4n,
} as const;
export type ReflexWorkerStateValue = typeof ReflexWorkerState[keyof typeof ReflexWorkerState];

export const ReflexSlot = {
  HEARTBEAT_SEQ: 0, LAST_HEARTBEAT_NS: 1, WORKER_STATE: 2, TICK_COUNT: 3,
  BREACH_COUNT: 4, RESERVED_0: 5, RESERVED_1: 6, RESERVED_2: 7,
  WIRE_TO_DECISION_LAST_NS: 8, WIRE_TO_DECISION_MAX_NS: 9,
  WAKEUP_JITTER_LAST_NS: 10, COMPUTE_ONLY_LAST_NS: 11,
  COMPUTE_ONLY_MAX_NS: 12, ELD_P99_NS: 13, ELD_MAX_NS: 14, RESERVED_3: 15,
} as const;
type ReflexSlotValue = typeof ReflexSlot[keyof typeof ReflexSlot];

export function createReflexTelemetryBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(TELEMETRY_SAB_BYTES);
}

const updateMaximum = (view: BigInt64Array, slot: ReflexSlotValue, value: bigint) => {
  let previous = Atomics.load(view, slot);
  while (value > previous) {
    const found = Atomics.compareExchange(view, slot, previous, value);
    if (found === previous) return;
    previous = found;
  }
};

export interface ReflexHealthSnapshot {
  version: 'mia5-reflex-telemetry-v1';
  healthy: boolean;
  stalled: boolean;
  warmingUp: boolean;
  state: ReflexWorkerStateValue;
  heartbeatSeq: string;
  heartbeatAgeMs: number | null;
  tickCount: string;
  breachCount: string;
  wireToDecisionLastMs: number | null;
  wireToDecisionMaxMs: number | null;
  wakeupJitterLastMs: number | null;
  computeOnlyLastMs: number | null;
  computeOnlyMaxMs: number | null;
  eldP99Ms: number | null;
  targetBudgetMs: 10;
  /** True only if a genuine upstream ingress clock was supplied to recordSpan. */
  wireTimingObserved: boolean;
  authority: 'TELEMETRY_ONLY';
}

const ms = (value: bigint) => Number(value) / 1_000_000;

/**
 * Process.hrtime values must be from a single monotonic clock domain.
 * A missing heartbeat is NOT healthy; warming up is also NOT certified.
 */
export function readReflexTelemetry(
  sab: SharedArrayBuffer,
  nowNs: bigint = process.hrtime.bigint(),
  stallNs: bigint = REFLEX_STALL_TIMEOUT_NS,
): ReflexHealthSnapshot {
  if (sab.byteLength !== TELEMETRY_SAB_BYTES) throw new Error('REFLEX_TELEMETRY_SIZE_INVALID');
  if (stallNs <= 0n) throw new Error('REFLEX_STALL_THRESHOLD_INVALID');
  const view = new BigInt64Array(sab);
  const beat = Atomics.load(view, ReflexSlot.LAST_HEARTBEAT_NS);
  const state = Atomics.load(view, ReflexSlot.WORKER_STATE) as ReflexWorkerStateValue;
  const age = beat > 0n && nowNs >= beat ? nowNs - beat : null;
  const stalled = beat > 0n && (age === null || age > stallNs);
  const warmingUp = state === ReflexWorkerState.WARMING_UP;
  const p99 = Atomics.load(view, ReflexSlot.ELD_P99_NS);
  const wireObserved = Atomics.load(view, ReflexSlot.WIRE_TO_DECISION_LAST_NS) > 0n;
  const hasTicks = Atomics.load(view, ReflexSlot.TICK_COUNT) > 0n;
  const valueOrNull = (slot: ReflexSlotValue) => {
    const n = Atomics.load(view, slot);
    return n > 0n ? ms(n) : null;
  };
  return {
    version: 'mia5-reflex-telemetry-v1',
    healthy: beat > 0n && hasTicks && !stalled &&
      state === ReflexWorkerState.HEALTHY && p99 <= REFLEX_BUDGET_NS,
    stalled, warmingUp, state,
    heartbeatSeq: Atomics.load(view, ReflexSlot.HEARTBEAT_SEQ).toString(),
    heartbeatAgeMs: age === null ? null : ms(age),
    tickCount: Atomics.load(view, ReflexSlot.TICK_COUNT).toString(),
    breachCount: Atomics.load(view, ReflexSlot.BREACH_COUNT).toString(),
    wireToDecisionLastMs: wireObserved ? valueOrNull(ReflexSlot.WIRE_TO_DECISION_LAST_NS) : null,
    wireToDecisionMaxMs: wireObserved ? valueOrNull(ReflexSlot.WIRE_TO_DECISION_MAX_NS) : null,
    wakeupJitterLastMs: wireObserved ? valueOrNull(ReflexSlot.WAKEUP_JITTER_LAST_NS) : null,
    computeOnlyLastMs: valueOrNull(ReflexSlot.COMPUTE_ONLY_LAST_NS),
    computeOnlyMaxMs: valueOrNull(ReflexSlot.COMPUTE_ONLY_MAX_NS),
    eldP99Ms: valueOrNull(ReflexSlot.ELD_P99_NS),
    targetBudgetMs: 10, wireTimingObserved: wireObserved, authority: 'TELEMETRY_ONLY',
  };
}

/** Optional writer; it does not launch workers or grant trading permission. */
export class ReflexTelemetryRecorder {
  private readonly view: BigInt64Array;
  private beatTimer: NodeJS.Timeout | null = null;
  private started = false;
  private warmed = false;

  constructor(
    readonly buffer: SharedArrayBuffer,
    private readonly warmupTicks: bigint = REFLEX_WARMUP_TICKS,
  ) {
    if (buffer.byteLength !== TELEMETRY_SAB_BYTES || warmupTicks < 1n)
      throw new Error('REFLEX_TELEMETRY_INVALID_CONFIGURATION');
    this.view = new BigInt64Array(buffer);
  }

  start(intervalMs = 25) {
    if (this.started) return;
    if (!Number.isInteger(intervalMs) || intervalMs < 5 || intervalMs > 100)
      throw new Error('REFLEX_HEARTBEAT_INTERVAL_INVALID');
    this.started = true;
    Atomics.store(this.view, ReflexSlot.WORKER_STATE, ReflexWorkerState.WARMING_UP);
    this.pulse();
    this.beatTimer = setInterval(() => this.pulse(), intervalMs);
    this.beatTimer.unref();
  }

  pulse(nowNs = process.hrtime.bigint()) {
    if (nowNs <= 0n) throw new Error('REFLEX_CLOCK_INVALID');
    Atomics.store(this.view, ReflexSlot.LAST_HEARTBEAT_NS, nowNs);
    Atomics.add(this.view, ReflexSlot.HEARTBEAT_SEQ, 1n);
  }

  /**
   * IMPORTANT: ingressNs must come from the *actual* provider arrival time.
   * Pass null when only a compute span is known. This prevents fake wire SLA.
   */
  recordSpan(computeStartNs: bigint, finishedNs: bigint = process.hrtime.bigint(),
    ingressNs: bigint | null = null) {
    if (!this.started) throw new Error('REFLEX_RECORDER_NOT_STARTED');
    if (computeStartNs < 0n || finishedNs < computeStartNs ||
      (ingressNs !== null && (ingressNs < 0n || ingressNs > computeStartNs)))
      throw new Error('REFLEX_CLOCK_ORDER_INVALID');

    const compute = finishedNs - computeStartNs;
    const ticks = Atomics.add(this.view, ReflexSlot.TICK_COUNT, 1n) + 1n;
    if (!this.warmed && ticks >= this.warmupTicks) {
      this.warmed = true;
      Atomics.store(this.view, ReflexSlot.WIRE_TO_DECISION_MAX_NS, 0n);
      Atomics.store(this.view, ReflexSlot.COMPUTE_ONLY_MAX_NS, 0n);
      Atomics.store(this.view, ReflexSlot.ELD_MAX_NS, 0n);
      Atomics.store(this.view, ReflexSlot.WORKER_STATE, ReflexWorkerState.HEALTHY);
    }
    Atomics.store(this.view, ReflexSlot.COMPUTE_ONLY_LAST_NS, compute);
    updateMaximum(this.view, ReflexSlot.COMPUTE_ONLY_MAX_NS, compute);
    if (ingressNs !== null) {
      const total = finishedNs - ingressNs;
      Atomics.store(this.view, ReflexSlot.WIRE_TO_DECISION_LAST_NS, total);
      Atomics.store(this.view, ReflexSlot.WAKEUP_JITTER_LAST_NS, computeStartNs - ingressNs);
      updateMaximum(this.view, ReflexSlot.WIRE_TO_DECISION_MAX_NS, total);
      if (this.warmed && total > REFLEX_BUDGET_NS) {
        Atomics.add(this.view, ReflexSlot.BREACH_COUNT, 1n);
        Atomics.store(this.view, ReflexSlot.WORKER_STATE, ReflexWorkerState.DEGRADED_LATENCY);
      }
    } else if (this.warmed && compute > REFLEX_BUDGET_NS) {
      // Slow compute is a warning, but not a measured wire-to-decision breach.
      Atomics.store(this.view, ReflexSlot.WORKER_STATE, ReflexWorkerState.DEGRADED_LATENCY);
    }
    this.pulse(finishedNs || process.hrtime.bigint());
  }

  recordEventLoopDelay(p99Ns: bigint, maxNs: bigint) {
    if (p99Ns < 0n || maxNs < 0n) throw new Error('REFLEX_ELD_INVALID');
    Atomics.store(this.view, ReflexSlot.ELD_P99_NS, p99Ns);
    updateMaximum(this.view, ReflexSlot.ELD_MAX_NS, maxNs);
    if (this.warmed && p99Ns > REFLEX_BUDGET_NS)
      Atomics.store(this.view, ReflexSlot.WORKER_STATE, ReflexWorkerState.DEGRADED_LATENCY);
  }

  resetWatermarks() {
    for (const slot of [ReflexSlot.WIRE_TO_DECISION_MAX_NS,
      ReflexSlot.COMPUTE_ONLY_MAX_NS, ReflexSlot.ELD_MAX_NS, ReflexSlot.BREACH_COUNT])
      Atomics.store(this.view, slot, 0n);
    // Do not automatically clear DEGRADED: recovery must be verified externally.
  }

  stop() {
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.beatTimer = null;
    this.started = false;
    Atomics.store(this.view, ReflexSlot.WORKER_STATE, ReflexWorkerState.HALTED);
  }
}
