/**
 * Owner administration on the server machine (whoever can run this already controls the database file).
 *   status                         sign-in mode, bound Privy owner, two-factor state
 *   bind-privy <did:privy:...>     bind the owner's Privy identity (refuses to replace an existing one without --replace)
 *   reset-2fa                      remove the owner's authenticator (lost device); re-enroll in Security Center
 * Every change takes a verified database backup first, ends all sessions, and is written to the audit log.
 */
import { join } from 'node:path';
import { backupDir, createBackup, liveDatabasePath, verifyBackup } from './backup.js';
import { closeDb } from '../db/db.js';
import { bindOwner, getLink, privyOwnerFromEnv } from '../security/privy.js';
import { resetTwoFactor, twoFactorStatus } from '../security/totp.js';
import { authMode } from '../security/stepUp.js';
import { revokeAllSessions } from '../api/auth.js';

const [cmd, arg, ...flags] = process.argv.slice(2);
function backupFirst() {
  const m = createBackup(); const v = verifyBackup(join(backupDir(), m.file));
  if (!v.ok) throw new Error(`backup verification failed (${m.file}); nothing was changed`);
  console.log(`Backup written and verified: ${m.file}`);
}
try {
  console.log(`Database: ${liveDatabasePath()}`);
  if (cmd === 'status') {
    const link = getLink(); const t = twoFactorStatus();
    console.log(`Sign-in mode: ${authMode()}`);
    console.log(`Privy owner (database): ${link ? `${link.userId} (bound ${new Date(link.linkedAt).toISOString()})` : 'none'}`);
    console.log(`MIA_PRIVY_OWNER_ID (environment): ${privyOwnerFromEnv() ?? 'not set'}`);
    console.log(`Two-factor: ${t.enrolled ? `enrolled ${new Date(t.enrolledAt!).toISOString()}` : 'not enrolled'}; legacy passphrase: ${t.legacyPassphrase ? 'present' : 'none'}`);
  } else if (cmd === 'bind-privy' && arg) {
    const current = getLink();
    if (current && current.userId !== arg && !flags.includes('--replace')) {
      console.error(`✖ The owner is already bound to ${current.userId}. Re-run with --replace to move ownership to ${arg}.`); process.exitCode = 1;
    } else { backupFirst(); const r = bindOwner(arg, 'server-cli'); revokeAllSessions(); console.log(`Owner Privy identity: ${r.userId}. All sessions ended; sign in again with Privy.`); }
  } else if (cmd === 'reset-2fa') {
    backupFirst(); const r = resetTwoFactor(); revokeAllSessions();
    console.log(r.reset ? 'Authenticator removed and all sessions ended. Sign in and set up a new one in Security Center.' : 'No authenticator was enrolled. All sessions ended.');
  } else { console.error('usage: owner status | bind-privy <did:privy:...> [--replace] | reset-2fa'); process.exitCode = 2; }
} catch (e: any) { console.error(`✖ ${e?.message ?? e}`); process.exitCode = 1; }
finally { closeDb(); }
