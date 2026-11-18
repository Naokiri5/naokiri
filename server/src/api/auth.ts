import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { sha256 } from '../core/util.js';
import { audit } from '../core/audit.js';
import { failureGate } from '../core/ratelimit.js';

export class AuthError extends Error { statusCode: number; constructor(msg: string, code = 401) { super(msg); this.statusCode = code; } }

/** Single-owner local authentication. Passphrase hashed with scrypt; sessions stored as SHA-256 of token. */
const SESSION_MS = 12 * 3600_000;
export const isSetup = () => !!getSetting<any>('owner', null);
export function setupOwner(pass: string) {
  if (isSetup()) throw new Error('owner already configured');
  if (pass.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = randomBytes(16).toString('hex'); const hash = scryptSync(pass, salt, 64).toString('hex');
  setSetting('owner', { salt, hash, createdAt: Date.now() }); audit('owner', 'auth.setup');
}
/**
 * One-time setup code (SEC-SETUP). Network location alone no longer authorizes the first owner claim: a request that
 * is not a direct loopback connection must present this code, which is printed only to the server's own console
 * (terminal, `journalctl`, container log). Whoever can read the server output can claim ownership; a remote visitor
 * cannot. ~100 bits of entropy, compared in constant time, discarded once the owner exists.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Creates the code if needed. Prints it when newly created or when `announce` is set (server startup), so a stream of
 *  remote page loads cannot flood the log. */
export function ensureSetupCode(announce = false, log: (msg: string) => void = (m) => console.log(m)): string | null {
  if (isSetup()) return null;
  let code = getSetting<{ code: string } | null>('setup_code', null)?.code ?? null;
  const created = !code;
  if (!code) {
    const b = randomBytes(20); code = Array.from(b, (x) => CODE_ALPHABET[x % 32]).join('');
    setSetting('setup_code', { code, createdAt: Date.now() });
  }
  const shown = code.match(/.{1,5}/g)!.join('-');
  if (created || announce) log(`\n  ➜ First-time setup code: ${shown}\n    A browser that is not on this machine (forwarded port, container, LAN) must enter it to create the owner.\n`);
  return shown;
}
export function checkSetupCode(given: unknown) {
  const code = getSetting<{ code: string } | null>('setup_code', null)?.code;
  if (!code || typeof given !== 'string' || given.length > 64) return false;
  const a = Buffer.from(normalizeCode(given)); const b = Buffer.from(code);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const clearSetupCode = () => setSetting('setup_code', null);

export function checkPassword(pass: string) {
  const o = getSetting<any>('owner', null); if (!o || typeof pass !== 'string' || pass.length > 1024) return false;
  const h = scryptSync(pass, o.salt, 64); return timingSafeEqual(h, Buffer.from(o.hash, 'hex'));
}
/**
 * The ONE place a passphrase is verified for login, step-up and passphrase change, so every path shares the
 * per-client and global brute-force limits (previously only login was limited and step-up could be guessed freely).
 */
export function verifyPassphrase(pass: unknown, client: string, purpose: string, opts: { exemptFromGlobalLockout?: boolean } = {}) {
  failureGate.check(client, Date.now(), { global: !opts.exemptFromGlobalLockout });
  if (typeof pass === 'string' && checkPassword(pass)) { failureGate.ok(client); return; }
  failureGate.fail(client);
  audit('anonymous', purpose === 'login' ? 'auth.login.failed' : 'auth.stepup.failed', { ip: client, purpose });
  throw new AuthError(purpose === 'login' ? 'invalid passphrase' : 'step-up authentication failed: passphrase required for this action', purpose === 'login' ? 401 : 403);
}
export function login(pass: string, ip: string, opts: { directLocal?: boolean } = {}) {
  verifyPassphrase(pass, ip, 'login', { exemptFromGlobalLockout: opts.directLocal });
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now()); // expired sessions are otherwise kept forever
  const token = randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?,?,?)', sha256(token), Date.now(), Date.now() + SESSION_MS);
  audit('owner', 'auth.login', { ip }); return token;
}
export function validSession(token?: string) {
  if (!token) return false;
  const r = get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token_hash=?', sha256(token));
  return !!r && r.expires_at > Date.now();
}
export function logout(token?: string) { if (token) run('DELETE FROM sessions WHERE token_hash=?', sha256(token)); }
export function changePassword(oldP: string, newP: string, client = 'local', opts: { exemptFromGlobalLockout?: boolean } = {}) {
  verifyPassphrase(oldP, client, 'password.change', opts);
  if (newP.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = randomBytes(16).toString('hex'); setSetting('owner', { salt, hash: scryptSync(newP, salt, 64).toString('hex'), createdAt: Date.now() });
  run('DELETE FROM sessions'); audit('owner', 'auth.password.change');
}
