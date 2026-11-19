/**
 * In-process rate limiting (single-owner, single-node app, so memory is the right store).
 *
 * - `limiter(perMin, burst)` returns a keyed token bucket for expensive routes.
 * - `failureGate` tracks failed passphrase checks per client AND globally. Behind a port forwarder every client can
 *   share one IP, so a per-IP counter alone either locks the owner out or lets an attacker rotate addresses; the
 *   global budget bounds total guessing regardless of source.
 */
export class RateLimitError extends Error {
  statusCode = 429;
  constructor(msg: string, public retryAfterSec: number) { super(msg); }
}

export function limiter(perMin: number, burst = perMin, maxKeys = 5_000) {
  const buckets = new Map<string, { tokens: number; last: number }>();
  return {
    take(key: string, what: string, nowTs = Date.now()) {
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value!);
        b = { tokens: burst, last: nowTs }; buckets.set(key, b);
      }
      b.tokens = Math.min(burst, b.tokens + ((nowTs - b.last) / 60_000) * perMin); b.last = nowTs;
      if (b.tokens < 1) throw new RateLimitError(`rate limit: ${what} is limited to ${perMin}/min — try again shortly`, Math.ceil(((1 - b.tokens) / perMin) * 60));
      b.tokens -= 1;
    },
    /** Restore a successful charge when its synchronous operation rolls back. */
    refund(key: string) {
      const b = buckets.get(key);
      if (b) b.tokens = Math.min(burst, b.tokens + 1);
    },
    reset() { buckets.clear(); },
  };
}

const PER_CLIENT = 5, PER_CLIENT_LOCK_MS = 60_000, GLOBAL = 20, GLOBAL_WINDOW_MS = 15 * 60_000, MAX_CLIENTS = 10_000;
const clients = new Map<string, { n: number; until: number }>();
let globalFails: number[] = [];

export const failureGate = {
  /**
   * Throws 429 while this client, or the whole server, is locked out. `global: false` skips only the server-wide
   * budget (SEC-14): used for risk-REDUCING step-up actions and for a direct local (loopback, unproxied) request, so
   * strangers' failed guesses can never stop the owner from closing positions or signing in at the machine itself.
   * The per-client exponential lockout always applies, and every failure still counts toward the global budget.
   */
  check(client: string, nowTs = Date.now(), opts: { global?: boolean } = {}) {
    const c = clients.get(client);
    if (c && c.until > nowTs) throw new RateLimitError('too many failed passphrase attempts; wait a minute', Math.ceil((c.until - nowTs) / 1000));
    globalFails = globalFails.filter((t) => nowTs - t < GLOBAL_WINDOW_MS);
    if (opts.global !== false && globalFails.length >= GLOBAL) throw new RateLimitError('too many failed passphrase attempts on this server; wait 15 minutes', Math.ceil((globalFails[0] + GLOBAL_WINDOW_MS - nowTs) / 1000));
  },
  fail(client: string, nowTs = Date.now()) {
    globalFails.push(nowTs);
    const n = (clients.get(client)?.n ?? 0) + 1;
    if (!clients.has(client) && clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value!);
    // Exponential backoff after the 5th miss: 1 min, 2 min, 4 min … capped at 1 h.
    clients.set(client, { n, until: n >= PER_CLIENT ? nowTs + Math.min(PER_CLIENT_LOCK_MS * 2 ** (n - PER_CLIENT), 3_600_000) : 0 });
  },
  ok(client: string) { clients.delete(client); },
  reset() { clients.clear(); globalFails = []; },
};
