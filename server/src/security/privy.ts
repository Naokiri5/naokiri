/**
 * Privy sign-in for the single MIA owner (MIA_PRIVY_APP_ID; the default sign-in when MIA_AUTH_MODE is not 'passphrase').
 *
 * Model: Privy proves WHO the person is; MIA decides whether that person is the owner.
 *  - Exactly one Privy user id (`did:privy:...`) is bound to the owner. It is bound by the server administrator
 *    (MIA_PRIVY_OWNER_ID, applied on that user's first sign-in after a database backup, or `npm run owner -- bind-privy`),
 *    or re-linked by the signed-in owner with step-up. Signing in with Privy never creates an owner by itself.
 *  - A Privy access token (ES256 JWT) is verified on the server: signature, issuer `privy.io`, audience = this app id,
 *    expiry. The browser's word is never trusted. Failed attempts share the brute-force limiter.
 *  - Sensitive actions still need a fresh step-up (authenticator code; see security/stepUp.ts). A Privy session alone
 *    never authorizes them.
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
import { AuthError, createSession, revokeAllSessions } from '../api/auth.js';

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
  return { enabled: !!appId, appId, linked: !!getLink(), ownerConfigured: !!getLink() || !!privyOwnerFromEnv(), embeddedWallets: embeddedWalletsAllowed(), walletActions: 'LOCKED' as const };
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

/** The owner's Privy user id chosen by the server administrator (MIA_PRIVY_OWNER_ID). Invalid values are ignored. */
export function privyOwnerFromEnv(): string | null {
  const v = process.env.MIA_PRIVY_OWNER_ID?.trim();
  return v && DID_RE.test(v) ? v : null;
}
export function privyOwnerConfigProblem(): string | null {
  const v = process.env.MIA_PRIVY_OWNER_ID?.trim();
  if (v && !DID_RE.test(v)) return 'MIA_PRIVY_OWNER_ID is set but is not a Privy user id (did:privy:...); it is ignored';
  const link = getLink(); const env = privyOwnerFromEnv();
  if (link && env && link.userId !== env) return 'MIA_PRIVY_OWNER_ID differs from the owner already bound in the database; the database binding wins. Re-bind with `npm run owner -- bind-privy <id> --replace` on the server';
  return null;
}
/** True once a Privy identity is bound to the MIA owner (database link). */
export const privyOwnerBound = () => !!getLink();

/**
 * Binds a Privy user id to the MIA owner. Callers are responsible for authorization (server CLI, administrator env
 * bootstrap, or an owner session with step-up). Every existing session ends when the identity changes.
 */
export function bindOwner(userId: string, via: 'env-bootstrap' | 'server-cli' | 'owner-step-up') {
  if (!DID_RE.test(userId)) throw new AuthError('not a Privy user id (did:privy:...)', 400);
  const previous = getLink();
  setSetting('privy_link', { userId, linkedAt: Date.now() } satisfies PrivyLink);
  if (previous && previous.userId !== userId) revokeAllSessions(); // a REPLACED identity loses every session
  audit('owner', previous ? 'auth.privy.link' : 'auth.privy.owner_bound', { userId, replaced: previous?.userId ?? null, via });
  return { linked: true, userId };
}

/** Owner (re-)links their Privy identity: the route has already required an owner session AND step-up. */
export async function linkPrivy(token: unknown) {
  const userId = await verifyPrivyAccessToken(token);
  return bindOwner(userId, 'owner-step-up');
}
/**
 * Owner intent to create a Privy embedded wallet: requires the feature flag AND step-up (checked by the route), and is
 * audited. Privy's SDK runs in the browser, so the hard on/off control is the Privy dashboard (disable embedded wallets
 * there); this gate makes MIA's own UI path as strict as every other sensitive action.
 */
export function embeddedWalletIntent() {
  if (!embeddedWalletsAllowed()) throw new AuthError('embedded wallets are disabled on this server (MIA_PRIVY_EMBEDDED_WALLETS is not 1)', 403);
  audit('owner', 'auth.privy.embedded_wallet.intent', { userId: getLink()?.userId ?? null });
  return { ok: true, note: 'Privy secures the key. MIA only displays the address; signing, sending, funding and export stay LOCKED.' };
}
/** Unlink (step-up checked by the route). Refused when Privy is the only sign-in: it would lock the owner out. */
export function unlinkPrivy(privyOnly: boolean) {
  if (privyOnly) throw new AuthError('Privy is the only sign-in on this server, so unlinking would lock the owner out. To move to another Privy account, re-link it here or run `npm run owner -- bind-privy <id> --replace` on the server', 409);
  const previous = getLink();
  setSetting('privy_link', null); revokeAllSessions();
  audit('owner', 'auth.privy.unlink', { userId: previous?.userId ?? null });
  return { linked: false };
}

export class OwnerNotProvisionedError extends AuthError {
  constructor(public privyUserId: string) {
    super(`This Privy account is verified, but no MIA owner has been set up yet. Administrator: set MIA_PRIVY_OWNER_ID=${privyUserId} on the server (or run \`npm run owner -- bind-privy ${privyUserId}\` there) and restart, then sign in again.`, 401);
  }
}

/**
 * Sign in with Privy. The token is verified on the server; then the verified Privy user must be:
 *  - the owner already bound in the database, or
 *  - when nothing is bound yet, exactly the administrator-configured MIA_PRIVY_OWNER_ID (first sign-in binds it,
 *    after a database backup). Anyone else is refused; signing in with Privy never creates an owner by itself.
 * Failures share the passphrase brute-force limiter.
 */
export async function loginWithPrivy(token: unknown, client: string, opts: { directLocal?: boolean; backup?: () => void } = {}) {
  failureGate.check(client, Date.now(), { global: !opts.directLocal });
  const link = getLink(); const envOwner = privyOwnerFromEnv();
  let userId: string | null = null;
  try { userId = await verifyPrivyAccessToken(token); } catch (e) { if ((e as AuthError).statusCode === 404) throw e; }
  const fail = (reason: string, err: AuthError) => {
    failureGate.fail(client);
    audit('anonymous', 'auth.login.failed', { ip: client, method: 'privy', reason });
    throw err;
  };
  if (!userId) return fail('bad-token', new AuthError('invalid or expired Privy token — sign in with Privy again'));
  if (link) {
    if (userId !== link.userId) return fail('not-owner', new AuthError('this Privy account is not the MIA owner. Sign out of Privy and use the owner\'s account'));
  } else if (envOwner && userId === envOwner) {
    // First sign-in of the administrator-provisioned owner: back up, then bind. A failed backup aborts (fail closed).
    try { opts.backup?.(); } catch (e) {
      audit('owner', 'auth.privy.owner_bind_aborted', { reason: 'backup-failed' });
      throw Object.assign(new Error(`could not back up the database before binding the owner: ${(e as Error).message}`), { statusCode: 500 });
    }
    bindOwner(userId, 'env-bootstrap');
  } else {
    return fail(envOwner ? 'not-owner' : 'not-provisioned', envOwner ? new AuthError('this Privy account is not the MIA owner configured on this server') : new OwnerNotProvisionedError(userId));
  }
  failureGate.ok(client);
  return createSession(client, 'privy');
}
