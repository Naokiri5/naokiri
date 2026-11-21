/**
 * MIA5-ID-05/06: bounded System-2 failure accounting, adapted as a PURE
 * supervisor policy. It does not spawn, re-arm or authorize trading workers.
 *
 * The canonical worker runtime, main bot lease, QCI, risk gate and OMS must
 * remain the only owners of processing and execution. A crash never replays
 * an order or manufactures a trade. No auto-unlock on READY.
 */
export type DeepFailureReason = 'OOM' | 'WORKER_EXIT' | 'TIMEOUT' | 'UNKNOWN';
export type DeepRecoveryState = 'OFFLINE' | 'BACKING_OFF' | 'EXHAUSTED' | 'READY';

export interface DeepRecoveryOptions {
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxRespawnAttempts: number;
  stabilityWindowMs: number;
}

export interface DeepRecoverySnapshot {
  version: 'mia5-deep-recovery-policy-v1';
  state: DeepRecoveryState;
  generation: number;
  attempt: number;
  maxAttempts: number;
  retryAfterMs: number | null;
  lastFailure: DeepFailureReason | null;
  readySinceMs: number | null;
  canAuthorizeTrade: false;
}

export const DEFAULT_DEEP_RECOVERY: Readonly<DeepRecoveryOptions> = {
  baseBackoffMs: 500, maxBackoffMs: 15_000,
  maxRespawnAttempts: 5, stabilityWindowMs: 10_000,
};

const nonnegativeFinite = (x: number) => Number.isFinite(x) && x >= 0;
const int = (x: number) => Number.isSafeInteger(x) && x > 0;

export class DeepRecoveryBudget {
  private state: DeepRecoveryState = 'OFFLINE';
  private generation = 0;
  private attempt = 0;
  private nextRetryAtMs: number | null = null;
  private lastFailure: DeepFailureReason | null = null;
  private readySinceMs: number | null = null;
  readonly config: Readonly<DeepRecoveryOptions>;

  constructor(config: Partial<DeepRecoveryOptions> = {}) {
    const c = { ...DEFAULT_DEEP_RECOVERY, ...config };
    if (![c.baseBackoffMs, c.maxBackoffMs, c.maxRespawnAttempts, c.stabilityWindowMs].every(int) ||
      c.maxBackoffMs < c.baseBackoffMs) throw new Error('DEEP_RECOVERY_CONFIG_INVALID');
    this.config = Object.freeze(c);
  }

  /** A failure only schedules a potential *reviewed* restart, never a trade. */
  recordFailure(reason: DeepFailureReason, nowMs = Date.now()): DeepRecoverySnapshot {
    if (!nonnegativeFinite(nowMs)) throw new Error('DEEP_RECOVERY_CLOCK_INVALID');
    if (this.state === 'EXHAUSTED') return this.snapshot(nowMs);
    if (this.state === 'BACKING_OFF') return this.snapshot(nowMs); // duplicate fault event
    this.readySinceMs = null;
    this.lastFailure = reason;
    if (this.attempt >= this.config.maxRespawnAttempts) {
      this.state = 'EXHAUSTED'; this.nextRetryAtMs = null;
      return this.snapshot(nowMs);
    }
    this.attempt += 1;
    // Bound the exponent against accidental Infinity.
    const delay = Math.min(this.config.maxBackoffMs,
      this.config.baseBackoffMs * Math.pow(2, Math.min(30, this.attempt - 1)));
    this.nextRetryAtMs = nowMs + delay;
    this.state = 'BACKING_OFF';
    return this.snapshot(nowMs);
  }

  /** Caller must perform OS worker creation; this policy only checks permission to attempt. */
  canAttemptRespawn(nowMs = Date.now()): boolean {
    return this.state === 'BACKING_OFF' &&
      this.nextRetryAtMs !== null && nonnegativeFinite(nowMs) &&
      nowMs >= this.nextRetryAtMs;
  }

  /** Fresh worker generation is required to prevent a stale READY event from clearing a fault. */
  observeReady(generation: number, nowMs = Date.now()): boolean {
    if (!int(generation) || generation <= this.generation || !nonnegativeFinite(nowMs) ||
      this.state === 'EXHAUSTED' || this.state !== 'BACKING_OFF' ||
      !this.canAttemptRespawn(nowMs)) return false;
    this.generation = generation;
    this.state = 'READY';
    this.readySinceMs = nowMs;
    this.nextRetryAtMs = null;
    // Does NOT clear canonical risk vetoes, OMS stops or quarantines.
    return true;
  }

  /**
   * Reset the retry counter only after an actual stable READY generation.
   * This does NOT grant a trade/venue permission.
   */
  markStable(nowMs = Date.now()): boolean {
    if (this.state !== 'READY' || this.readySinceMs === null ||
      !nonnegativeFinite(nowMs) || nowMs - this.readySinceMs < this.config.stabilityWindowMs)
      return false;
    this.attempt = 0;
    return true;
  }

  /** Only a reviewed owner action can recover from exhaustion. */
  resetAfterReview(actor: string): void {
    if (actor !== 'owner') throw new Error('DEEP_RECOVERY_OWNER_REVIEW_REQUIRED');
    this.attempt = 0;
    this.state = 'OFFLINE';
    this.nextRetryAtMs = null;
    this.readySinceMs = null;
    this.lastFailure = null;
  }

  snapshot(nowMs = Date.now()): DeepRecoverySnapshot {
    return {
      version: 'mia5-deep-recovery-policy-v1',
      state: this.state, generation: this.generation, attempt: this.attempt,
      maxAttempts: this.config.maxRespawnAttempts,
      retryAfterMs: this.nextRetryAtMs === null ? null : Math.max(0, this.nextRetryAtMs - nowMs),
      lastFailure: this.lastFailure, readySinceMs: this.readySinceMs,
      canAuthorizeTrade: false,
    };
  }
}
