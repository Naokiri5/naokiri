import { randomUUID, createHash } from 'node:crypto';

export const now = () => Date.now();
export const iso = (t = Date.now()) => new Date(t).toISOString();
export const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, dp = 8) => { const f = 10 ** dp; return Math.round(x * f) / f; };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function mean(xs: readonly number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
export function std(xs: number[]) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/** Run fn with a hard deadline. Rejects with Error('DEADLINE') on timeout. */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('DEADLINE')), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}
