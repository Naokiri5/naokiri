import { randomUUID, createHash } from 'node:crypto';

export const now = () => Date.now();
export const iso = (t = Date.now()) => new Date(t).toISOString();
export const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Round a quantity DOWN to a lot step. Never returns more than `q` (float noise could round 0.0029999 up to 0.003). */
export function floorToStep(q: number, step: number) {
  if (!(step > 0)) return q;
  let r = Number((Math.floor(q / step + 1e-9) * step).toFixed(12));
  if (r > q) r = Number((r - step).toFixed(12));
  return Math.max(0, r);
}
export const round = (x: number, dp = 8) => { const f = 10 ** dp; return Math.round(x * f) / f; };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
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

/** Keep a provider-supplied link only if it is an absolute http(s) URL; anything else (javascript:, data:, relative)
 *  becomes ''. Provider strings are untrusted data and end up in <a href> on the dashboard. */
export function safeHttpUrl(u: unknown): string {
  if (typeof u !== 'string' || u.length > 2048) return '';
  try { const x = new URL(u.trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; }
}
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
