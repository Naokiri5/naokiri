/**
 * Privy sign-in for the single MIA owner (optional; off unless MIA_PRIVY_APP_ID is set).
 *
 * Model: Privy proves WHO the person is; it never replaces MIA's own authority.
 *  - The owner first signs in with the MIA passphrase and, with a passphrase step-up, LINKS one Privy user id
 *    (`did:privy:...`). Only that linked id can ever open a MIA session through Privy.
 *  - A Privy access token (ES256 JWT) is verified on the server: signature, issuer `privy.io`, audience = this app id,
 *    expiry. The browser's word is never trusted. Failed attempts share the passphrase brute-force limiter.
 *  - Passphrase step-up stays required for every sensitive action; signing in with Privy does not bypass it.
 *  - Wallets: MIA only DISPLAYS wallets linked to the Privy account. Embedded wallets are created only on the owner's
 *    explicit request and only when MIA_PRIVY_EMBEDDED_WALLETS=1. MIA never asks a wallet to sign or send a
 *    transaction, never funds, exports or delegates a wallet. Live trading stays LOCKED.
 *
 * Verification key: MIA_PRIVY_VERIFICATION_KEY (the PEM public key from the Privy dashboard) is preferred; otherwise
 * the app's public JWKS is fetched from auth.privy.io. Neither is a secret. No Privy app secret is needed or used.
 */
import { createLocalJWKSet, createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { getSetting, setSetting } from '../core/settings.js';
import { audit } from '../core/audit.js';
import { failureGate } from '../core/ratelimit.js';
import { AuthError, createSession, verifyPassphrase } from '../api/auth.js';

/** Privy app ids are exactly 25 characters (the React SDK refuses anything else). */
const APP_ID_RE = /^[A-Za-z0-9]{25}$/;
const DID_RE = /^did:privy:[A-Za-z0-9_-]{8,128}$/;
const ISSUER = 'privy.io';

export function privyAppId(): string | null {
  const v = process.env.MIA_PRIVY_APP_ID?.trim();
  return v && APP_ID_RE.test(v) ? v : null;
}
export const privyEnabled = () => privyAppId() !== null;
/** A set-but-invalid MIA_PRIVY_APP_ID leaves Privy OFF; this explains why (for the startup log). */
export function privyConfigProblem(): string | null {
  const v = process.env.MIA_PRIVY_APP_ID?.trim();
  return v && !APP_ID_RE.test(v) ? 'MIA_PRIVY_APP_ID is set but is not a 25-character Privy app id; Privy sign-in stays OFF' : null;
}

/**
 * The browser CSP. Unchanged (strict, `connect-src 'self'`) unless Privy is enabled; then only Privy's sign-in iframe,
 * its API, Cloudflare's bot challenge and the WalletConnect relay/verify hosts (used to connect an external wallet for
 * identity) are added. Nothing else is opened.
 */
export function contentSecurityPolicy(): string {
  const base = { img: "'self' data: https:", style: "'self' 'unsafe-inline' https://fonts.googleapis.com", font: "'self' https://fonts.gstatic.com" };
  if (!privyEnabled()) {
    return `default-src 'self'; img-src ${base.img}; style-src ${base.style}; font-src ${base.font}; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  }
  const frames = 'https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com';
  const connect = "'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org https://explorer-api.walletconnect.com https://pulse.walletconnect.org https://api.web3modal.org";
  return `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; img-src ${base.img} blob:; style-src ${base.style}; font-src ${base.font}; `
    + `connect-src ${connect}; frame-src ${frames}; child-src ${frames}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
}

/** Public config for the login screen. The app id and the linked state are not secrets. */
export function privyPublicConfig() {
  const appId = privyAppId();
  return { enabled: !!appId, appId, linked: !!getLink(), embeddedWallets: embeddedWalletsAllowed(), walletActions: 'LOCKED' as const };
}

/**
 * Optional Privy embedded wallets (MIA_PRIVY_EMBEDDED_WALLETS=1, default OFF). When on, the owner may ASK Privy to
 * create a wallet that Privy secures; MIA never holds, sees or exports its key, never requests a signature, a
 * transaction, funding or delegated signing. It only displays the address. Live trading and withdrawals stay locked.
 */
export const embeddedWalletsAllowed = () => privyEnabled() && process.env.MIA_PRIVY_EMBEDDED_WALLETS === '1';

interface PrivyLink { userId: string; linkedAt: number }
export const getLink = () => getSetting<PrivyLink | null>('privy_link', null);

// ---- token verification -----------------------------------------------------------------------------------------
let keyCache: { appId: string; source: string; key: KeyLike | JWTVerifyGetKey } | null = null;
/** Test hook: inject a key resolver (e.g. a local JWKS) instead of the dashboard key / remote JWKS. */
export function _setPrivyKeyForTests(jwks: { keys: object[] } | null) {
  keyCache = jwks ? { appId: privyAppId() ?? '', source: 'test', key: createLocalJWKSet(jwks as any) } : null;
}
async function verificationKey(appId: string): Promise<KeyLike | JWTVerifyGetKey> {
  if (keyCache && (keyCache.appId === appId || keyCache.source === 'test')) return keyCache.key;
  const pem = process.env.MIA_PRIVY_VERIFICATION_KEY?.trim().replace(/\\n/g, '\n');
  const key = pem
    ? await importSPKI(pem, 'ES256')
    : createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`), { timeoutDuration: 5000, cooldownDuration: 30_000 });
  keyCache = { appId, source: pem ? 'pem' : 'jwks', key };
  return key;
}

/** Verifies a Privy access token and returns the Privy user id. Throws AuthError(401) on any problem. */
export async function verifyPrivyAccessToken(token: unknown): Promise<string> {
  const appId = privyAppId();
  if (!appId) throw new AuthError('Privy sign-in is not enabled on this server', 404);
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new AuthError('invalid Privy token');
  try {
    const key = await verificationKey(appId);
    const { payload } = await jwtVerify(token, key as any, { issuer: ISSUER, audience: appId, algorithms: ['ES256'], clockTolerance: 5 });
    if (typeof payload.sub !== 'string' || !DID_RE.test(payload.sub)) throw new Error('bad subject');
    return payload.sub;
  } catch {
    throw new AuthError('invalid or expired Privy token'); // never echo verifier internals
  }
}

/** Owner links their Privy identity: requires an existing MIA session (route gate) AND a passphrase step-up. */
export async function linkPrivy(token: unknown, password: unknown, stepUpClient: string, exemptFromGlobalLockout: boolean) {
  verifyPassphrase(password, stepUpClient, 'step-up', { exemptFromGlobalLockout });
  const userId = await verifyPrivyAccessToken(token);
  const previous = getLink();
  setSetting('privy_link', { userId, linkedAt: Date.now() } satisfies PrivyLink);
  audit('owner', 'auth.privy.link', { userId, replaced: previous?.userId ?? null });
  return { linked: true, userId };
}
export function unlinkPrivy(password: unknown, stepUpClient: string, exemptFromGlobalLockout: boolean) {
  verifyPassphrase(password, stepUpClient, 'step-up', { exemptFromGlobalLockout });
  const previous = getLink();
  setSetting('privy_link', null);
  audit('owner', 'auth.privy.unlink', { userId: previous?.userId ?? null });
  return { linked: false };
}

/** Sign in with Privy: the verified Privy user must be the linked owner. Shares the brute-force limiter. */
export async function loginWithPrivy(token: unknown, client: string, opts: { directLocal?: boolean } = {}) {
  failureGate.check(client, Date.now(), { global: !opts.directLocal });
  const link = getLink();
  let userId: string | null = null;
  try { userId = await verifyPrivyAccessToken(token); } catch (e) { if ((e as AuthError).statusCode === 404) throw e; }
  if (!link || !userId || userId !== link.userId) {
    failureGate.fail(client);
    audit('anonymous', 'auth.login.failed', { ip: client, method: 'privy', reason: !link ? 'not-linked' : !userId ? 'bad-token' : 'not-owner' });
    throw new AuthError(!link ? 'Privy sign-in is not linked to the MIA owner yet: sign in with your passphrase and link it in Security Center' : 'this Privy account is not the MIA owner');
  }
  failureGate.ok(client);
  return createSession(client, 'privy');
}
