/**
 * Shared exit management (Part 17.4 / 26.4). Used by the backtester AND the live paper OMS.
 * Rules: stop never widens; trailing only tightens (to breakeven after trailAfterR);
 * stop-and-target in the same bar ⇒ stop assumed first (conservative); gaps fill at the open.
 */
export interface ExitState { entry: number; stop: number; initialStop: number; qtyLeft: number; qtyInit: number; targets: { price: number; fraction: number; done: boolean }[]; trailAfterR: number | null; barsHeld: number; maxHoldBars: number; mfe: number; mae: number }
export interface Bar { o: number; h: number; l: number; c: number; closeTimeMs?: number }
export interface ExitFill { reason: 'STOP' | 'TARGET' | 'TIME' | 'TRAIL_STOP'; price: number; qty: number }

/** Optional, read-only closed-bar ATR evidence. Supplying no evidence retains the original exit behavior. */
export interface ClosedBarChandelierEvidence {
  /** Highest high across the chosen lookback, including the fully closed bar being evaluated. */
  highestClosedHigh: number;
  atr: number;
  atrMultiple: number;
  /** Must exactly match Bar.closeTimeMs; otherwise the input cannot tighten the stop. */
  closedAtMs: number;
}
export type ChandelierAssessment =
  | { status: 'TIGHTEN'; proposedStop: number; reasonCode: 'VALID_CLOSED_BAR' }
  | { status: 'UNCHANGED' | 'UNKNOWN'; proposedStop: null; reasonCode: string };

/**
 * Pure Stage-3 stop proposal; never grants execution authority. Evidence is accepted only for the
 * current completed candle. The proposed stop applies to the NEXT candle, after this candle's
 * original stop / target / time ordering has been evaluated, preventing same-bar look-ahead.
 */
export function assessClosedBarChandelier(bar: Bar, currentStop: number, evidence: ClosedBarChandelierEvidence): ChandelierAssessment {
  if (!Number.isSafeInteger(bar.closeTimeMs) || !Number.isSafeInteger(evidence.closedAtMs) ||
      bar.closeTimeMs !== evidence.closedAtMs) {
    return { status: 'UNKNOWN', proposedStop: null, reasonCode: 'BAR_TIME_UNVERIFIED' };
  }
  if (![bar.o, bar.h, bar.l, bar.c, currentStop, evidence.highestClosedHigh, evidence.atr, evidence.atrMultiple].every(Number.isFinite) ||
      !(bar.o > 0 && bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c) &&
        bar.l > 0 && currentStop > 0 && evidence.atr > 0 && evidence.atrMultiple > 0 &&
        evidence.highestClosedHigh >= bar.h)) {
    return { status: 'UNKNOWN', proposedStop: null, reasonCode: 'INVALID_OR_INCOMPLETE_ATR_EVIDENCE' };
  }
  const proposal = evidence.highestClosedHigh - evidence.atrMultiple * evidence.atr;
  if (!Number.isFinite(proposal) || proposal <= 0 || proposal >= bar.c) {
    return { status: 'UNKNOWN', proposedStop: null, reasonCode: 'UNSAFE_STOP_LEVEL' };
  }
  if (proposal <= currentStop) return { status: 'UNCHANGED', proposedStop: null, reasonCode: 'NO_TIGHTENING' };
  return { status: 'TIGHTEN', proposedStop: proposal, reasonCode: 'VALID_CLOSED_BAR' };
}

export function stepExit(s: ExitState, b: Bar, stopSlipPct = 0.0005, countBar = true, chandelier?: ClosedBarChandelierEvidence): ExitFill[] {
  const fills: ExitFill[] = [];
  const R = s.entry - s.initialStop;
  s.mfe = Math.max(s.mfe, (b.h - s.entry) / R); s.mae = Math.min(s.mae, (b.l - s.entry) / R);
  if (b.l <= s.stop && s.qtyLeft > 0) {
    const px = Math.min(b.o, s.stop) * (1 - stopSlipPct);
    fills.push({ reason: s.stop > s.initialStop ? 'TRAIL_STOP' : 'STOP', price: px, qty: s.qtyLeft }); s.qtyLeft = 0; return fills;
  }
  for (const t of s.targets) {
    if (t.done || s.qtyLeft <= 0) continue;
    if (b.h >= t.price) {
      const q = Math.min(s.qtyLeft, s.qtyInit * t.fraction);
      fills.push({ reason: 'TARGET', price: Math.max(b.o, t.price), qty: q }); s.qtyLeft -= q; t.done = true;
    }
  }
  if (s.qtyLeft > 1e-12 && s.trailAfterR != null && (b.h - s.entry) / R >= s.trailAfterR) s.stop = Math.max(s.stop, s.entry); // only tightens
  if (countBar) s.barsHeld++;
  if (s.qtyLeft > 1e-12 && s.barsHeld >= s.maxHoldBars) { fills.push({ reason: 'TIME', price: b.c, qty: s.qtyLeft }); s.qtyLeft = 0; }
  if (s.qtyLeft > 1e-12 && chandelier) {
    const assessment = assessClosedBarChandelier(b, s.stop, chandelier);
    if (assessment.status === 'TIGHTEN') s.stop = assessment.proposedStop;
  }
  return fills;
}
export function newExitState(entry: number, stop: number, qty: number, targets: { r: number; fraction: number }[], trailAfterR: number | null, maxHoldBars: number): ExitState {
  const R = entry - stop;
  return { entry, stop, initialStop: stop, qtyLeft: qty, qtyInit: qty, targets: targets.map((t) => ({ price: entry + t.r * R, fraction: t.fraction, done: false })), trailAfterR, barsHeld: 0, maxHoldBars, mfe: 0, mae: 0 };
}
