/**
 * Shared exit management (Part 17.4 / 26.4). Used by the backtester AND the live paper OMS.
 * Rules: stop never widens; trailing only tightens (to breakeven after trailAfterR);
 * stop-and-target in the same bar ⇒ stop assumed first (conservative); gaps fill at the open.
 */
export interface ExitState { entry: number; stop: number; initialStop: number; qtyLeft: number; qtyInit: number; targets: { price: number; fraction: number; done: boolean }[]; trailAfterR: number | null; barsHeld: number; maxHoldBars: number; mfe: number; mae: number }
export interface Bar { o: number; h: number; l: number; c: number }
export interface ExitFill { reason: 'STOP' | 'TARGET' | 'TIME' | 'TRAIL_STOP'; price: number; qty: number }

export function stepExit(s: ExitState, b: Bar, stopSlipPct = 0.0005, countBar = true): ExitFill[] {
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
  return fills;
}
export function newExitState(entry: number, stop: number, qty: number, targets: { r: number; fraction: number }[], trailAfterR: number | null, maxHoldBars: number): ExitState {
  const R = entry - stop;
  return { entry, stop, initialStop: stop, qtyLeft: qty, qtyInit: qty, targets: targets.map((t) => ({ price: entry + t.r * R, fraction: t.fraction, done: false })), trailAfterR, barsHeld: 0, maxHoldBars, mfe: 0, mae: 0 };
}
