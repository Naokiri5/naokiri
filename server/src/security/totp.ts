/**
 * Owner two-factor step-up with an authenticator app (RFC 6238 TOTP: HMAC-SHA1, 30-second steps, 6 digits).
 *
 * Why: with Privy as the sign-in, the MIA passphrase no longer exists for new installs, but risk-increasing actions
 * (mode changes, policy acceptance, strategy promotion, resuming after an emergency, wallet verification, lifting a
 * withdrawal freeze) must still demand a FRESH proof from the owner. A Privy access token cannot provide that: the SDK
 * refreshes it silently, so a valid token does not show that anyone just completed a challenge. A TOTP code can,
 * and it is verified entirely on this server with node:crypto (no new dependency, no third party in the loop).
 *
 * Rules:
 *  - Each accepted code is single-use (the matched 30 s step must be newer than the last accepted one): replay fails.
 *  - Failures share the passphrase brute-force limiter (per session + global), so 6 digits cannot be guessed.
 *  - Enrolling the first authenticator needs independent proof: the legacy owner passphrase, a direct connection on
 *    the server machine, or a one-time code printed to the server console. Re-enrolling needs a current code.
 *    A stolen browser session alone can therefore never set up (or replace) the owner's second factor.
 *  - Lost authenticator: `npm run owner -- reset-2fa` on the server (administrator recovery; audited).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from '../core/settings.js';
import { audit } from '../core/audit.js';
import { failureGate } from '../core/ratelimit.js';
import { AuthError, isSetup, verifyPassphrase } from '../api/auth.js';

export const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept the previous and next step too (clock drift)
const PENDING_TTL_MS = 10 * 60_000;
const CONSOLE_CODE_TTL_MS = 15 * 60_000;

// ---- RFC 4648 base32 (authenticator apps expect it) -------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- RFC 4226 / 6238 ----------------------------------------------------------------------------------------------
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export const counterAt = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);
export const totpAt = (secret: Buffer, nowMs: number, digits = DIGITS) => hotp(secret, counterAt(nowMs), digits);
/** The matching step counter within ±WINDOW, or null. Constant-time comparison per candidate. */
export function matchCounter(secret: Buffer, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code); const c0 = counterAt(nowMs); let hit: number | null = null;
  for (let d = -WINDOW; d <= WINDOW; d++) if (timingSafeEqual(Buffer.from(hotp(secret, c0 + d)), given)) hit = c0 + d;
  return hit;
}

// ---- stored state -------------------------------------------------------------------------------------------------
interface Enrolled { secret: string; enrolledAt: number; lastCounter: number }
interface Pending { secret: string; createdAt: number }
const enrolled = () => getSetting<Enrolled | null>('owner_2fa', null);
const pending = () => getSetting<Pending | null>('owner_2fa_pending', null);
export const twoFactorEnrolled = () => !!enrolled();
export function twoFactorStatus(nowMs = Date.now()) {
  const e = enrolled(); const p = pending();
  return { enrolled: !!e, enrolledAt: e?.enrolledAt ?? null, pending: !!p && nowMs - p.createdAt < PENDING_TTL_MS, legacyPassphrase: isSetup() };
}

/** Verifies a step-up code for the enrolled owner. Throws AuthError(403) and counts a failure on any problem. */
export function verifyTotpStepUp(code: unknown, client: string, opts: { exemptFromGlobalLockout?: boolean; nowMs?: number } = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  failureGate.check(client, nowMs, { global: !opts.exemptFromGlobalLockout });
  const e = enrolled();
  const hit = e && typeof code === 'string' ? matchCounter(base32Decode(e.secret), code.trim(), nowMs) : null;
  if (e && hit !== null && hit > e.lastCounter) {
    setSetting('owner_2fa', { ...e, lastCounter: hit } satisfies Enrolled);
    failureGate.ok(client); return;
  }
  failureGate.fail(client);
  audit('anonymous', 'auth.stepup.failed', { ip: client, purpose: 'step-up', method: 'totp', reason: !e ? 'not-enrolled' : hit !== null ? 'replayed' : 'bad-code' });
  throw new AuthError(hit !== null ? 'step-up failed: that authenticator code was already used — wait for the next one' : 'step-up authentication failed: a current authenticator code is required for this action', 403);
}

// ---- one-time console code (independent proof for the FIRST enrollment from another device) --------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function ensureConsoleCode(log: (m: string) => void, nowMs: number) {
  const cur = getSetting<{ code: string; createdAt: number } | null>('owner_2fa_console_code', null);
  if (cur && nowMs - cur.createdAt < CONSOLE_CODE_TTL_MS) return;
  const code = Array.from(randomBytes(12), (x) => CODE_ALPHABET[x % 32]).join('');
  setSetting('owner_2fa_console_code', { code, createdAt: nowMs });
  log(`\n  ➜ MIA two-factor setup code: ${code.match(/.{1,4}/g)!.join('-')}\n    Enter it in Security Center to set up the owner's authenticator app (valid 15 minutes).\n`);
}
function checkConsoleCode(given: unknown, nowMs: number) {
  const cur = getSetting<{ code: string; createdAt: number } | null>('owner_2fa_console_code', null);
  if (!cur || nowMs - cur.createdAt >= CONSOLE_CODE_TTL_MS || typeof given !== 'string' || given.length > 64) return false;
  const a = Buffer.from(given.toUpperCase().replace(/[^A-Z0-9]/g, '')); const b = Buffer.from(cur.code);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EnrollProof = { password?: string; otp?: string; consoleCode?: string };
export type BeginResult = { needsProof: 'otp' | 'console-code-or-passphrase' } | { secret: string; otpauth: string; expiresInSec: number };

/**
 * Starts enrollment. Without proof, returns which proof is needed (and prints a console code if that is the route).
 * With wrong proof, throws 403 and counts a failure.
 */
export function beginEnrollment(proof: EnrollProof, client: string, opts: { log?: (m: string) => void; nowMs?: number } = {}): BeginResult {
  const nowMs = opts.nowMs ?? Date.now(); const log = opts.log ?? ((m: string) => console.log(m));
  if (enrolled()) {
    if (!proof.otp) return { needsProof: 'otp' };
    verifyTotpStepUp(proof.otp, client, { nowMs });
  } else {
    // The first authenticator always needs independent proof (passphrase or the server-console code). A loopback
    // request without forwarding headers is NOT proof of being at the machine: ssh -L, socat or kubectl port-forward
    // deliver remote requests the same way (CodeRabbit #45, CWE-863). The owner at the machine reads the console code.
    if (proof.password) verifyPassphrase(proof.password, client, 'step-up');
    else if (proof.consoleCode) {
      failureGate.check(client, nowMs);
      if (!checkConsoleCode(proof.consoleCode, nowMs)) {
        failureGate.fail(client); audit('anonymous', 'auth.2fa.console_code_rejected', { ip: client });
        throw new AuthError('that setup code is wrong or expired — use the newest code printed in the MIA server console', 403);
      }
      failureGate.ok(client); setSetting('owner_2fa_console_code', null);
    } else { ensureConsoleCode(log, nowMs); return { needsProof: 'console-code-or-passphrase' }; }
  }
  const secret = base32Encode(randomBytes(20));
  setSetting('owner_2fa_pending', { secret, createdAt: nowMs } satisfies Pending);
  audit('owner', 'auth.2fa.enroll.begin', { replacing: !!enrolled() });
  const otpauth = `otpauth://totp/MIA:owner?secret=${secret}&issuer=MIA&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  return { secret, otpauth, expiresInSec: PENDING_TTL_MS / 1000 };
}

/** Completes enrollment with a code from the new authenticator. From then on, step-up requires TOTP. */
export function confirmEnrollment(code: unknown, client: string, opts: { nowMs?: number } = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  failureGate.check(client, nowMs);
  const p = pending();
  if (!p || nowMs - p.createdAt >= PENDING_TTL_MS) throw new AuthError('no authenticator setup in progress (or it expired) — start again', 409);
  const hit = typeof code === 'string' ? matchCounter(base32Decode(p.secret), code.trim(), nowMs) : null;
  if (hit === null) { failureGate.fail(client); throw new AuthError('that code does not match the new authenticator — check the device clock and try the current code', 403); }
  failureGate.ok(client);
  setSetting('owner_2fa', { secret: p.secret, enrolledAt: nowMs, lastCounter: hit } satisfies Enrolled);
  setSetting('owner_2fa_pending', null);
  audit('owner', 'auth.2fa.enrolled');
  return { enrolled: true };
}

/** Administrator recovery (server command line only). */
export function resetTwoFactor() {
  const had = twoFactorEnrolled();
  setSetting('owner_2fa', null); setSetting('owner_2fa_pending', null); setSetting('owner_2fa_console_code', null);
  audit('owner', 'auth.2fa.reset', { had, via: 'server-cli' });
  return { reset: had };
}
