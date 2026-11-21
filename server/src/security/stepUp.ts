/**
 * The ONE step-up check for sensitive owner actions, plus the server's sign-in mode.
 *
 * Sign-in mode (MIA_AUTH_MODE):
 *  - 'privy' (default): the only way to open a session is a server-verified Privy token for the provisioned owner.
 *    Passphrase setup, passphrase login and passphrase change are refused.
 *  - 'passphrase': the original local owner passphrase (offline development, automated tests, emergency recovery).
 *    Must be chosen explicitly by the administrator.
 *
 * Step-up method (independent of the sign-in mode):
 *  - 'totp' once the owner has enrolled an authenticator app (then the passphrase is no longer accepted for step-up);
 *  - 'passphrase' while a legacy owner passphrase exists and no authenticator is enrolled (existing installs);
 *  - 'unavailable' otherwise: every protected action is REFUSED (fail closed) until the owner enrolls an authenticator.
 */
import { AuthError, isSetup, verifyPassphrase } from '../api/auth.js';
import { audit } from '../core/audit.js';
import { twoFactorEnrolled, verifyTotpStepUp } from './totp.js';

export type AuthMode = 'privy' | 'passphrase';
export function authMode(): AuthMode {
  return process.env.MIA_AUTH_MODE?.trim().toLowerCase() === 'passphrase' ? 'passphrase' : 'privy';
}
export const passphraseSignInAllowed = () => authMode() === 'passphrase';

export type StepUpMethod = 'totp' | 'passphrase' | 'unavailable';
export function stepUpMethod(): StepUpMethod {
  if (twoFactorEnrolled()) return 'totp';
  // In production Privy mode, missing TOTP means DENY, even if a legacy
  // passphrase hash remains for a controlled local recovery operation.
  if (passphraseSignInAllowed() && isSetup()) return 'passphrase';
  return 'unavailable';
}

export type StepUpProof = { password?: unknown; otp?: unknown } | null | undefined;
export function verifyStepUp(proof: StepUpProof, client: string, opts: { exemptFromGlobalLockout?: boolean } = {}) {
  const method = stepUpMethod();
  if (method === 'totp') return verifyTotpStepUp(proof?.otp, client, opts);
  if (method === 'passphrase') return verifyPassphrase(proof?.password, client, 'step-up');
  audit('owner', 'auth.stepup.unavailable', { client });
  throw new AuthError('this action needs two-factor step-up: set up an authenticator app in Security Center first', 403);
}
