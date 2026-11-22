import type { LargePrint } from './prints.js';

/** A CEX print is an anonymous market trade, never an identified whale wallet. */
export interface DeepFootprint {
  readonly attribution: 'INFERRED_ENTITY';
  readonly source: 'CEX_LARGE_PRINT';
  readonly instrumentId: string;
  readonly symbol: string;
  readonly observedAt: number;
  /** Public aggregate print timestamp is NOT a verified first-availability timestamp. */
  readonly availableAt: null;
  readonly direction: 'BUY' | 'SELL';
  readonly notionalUsd: number;
  readonly status: 'RESEARCH_ONLY';
}

export function reconstructReadOnlyDeepFootprints(
  prints: readonly LargePrint[],
  asOfTime: number,
  maxAgeMs = 6 * 3_600_000
): DeepFootprint[] {
  if (!Number.isSafeInteger(asOfTime) || asOfTime < 0 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) return [];
  return prints
    .filter((p) => Number.isSafeInteger(p.ts) && p.ts >= 0 && p.ts <= asOfTime &&
      asOfTime - p.ts <= maxAgeMs && Number.isFinite(p.notional) && p.notional > 0)
    .map((p) => ({
      attribution: 'INFERRED_ENTITY' as const,
      source: 'CEX_LARGE_PRINT' as const,
      instrumentId: p.instrumentId,
      symbol: p.symbol,
      observedAt: p.ts,
      availableAt: null,
      direction: p.side,
      notionalUsd: p.notional,
      status: 'RESEARCH_ONLY' as const
    }));
}
