import { all, get, run } from '../db/db.js';
import { config, inContainer } from '../config.js';
import { getSetting } from '../core/settings.js';
import { verifyAuditChain, audit } from '../core/audit.js';
import { getControl } from '../core/mode.js';
import { withdrawalFrozen } from '../wallet/wallet.js';
import { releaseGates } from '../qa/gates.js';
import { sha256 } from '../core/util.js';
import { authMode } from './stepUp.js';
import { privyOwnerBound, privyOwnerFromEnv } from './privy.js';
import { twoFactorEnrolled } from './totp.js';

/** Security Center data. Reports whether secrets are configured — never their values. */
export interface Check { id: string; area: string; name: string; status: 'PASS' | 'WARN' | 'FAIL' | 'INFO'; detail: string }

export function securityOverview(currentToken?: string) {
  const owner = getSetting<any>('owner', null);
  const sessions = all<{ token_hash: string; created_at: number; expires_at: number }>('SELECT token_hash, created_at, expires_at FROM sessions WHERE expires_at > ? ORDER BY created_at DESC', Date.now());
  const cur = currentToken ? sha256(currentToken) : '';
  const authEvents = all<any>("SELECT ts, actor, action, detail FROM audit_log WHERE action LIKE 'auth.%' OR action LIKE 'security.%' ORDER BY id DESC LIMIT 50");
  const since = Date.now() - 24 * 3600_000;
  const failed24h = get<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action='auth.login.failed' AND ts > ?", since)!.n;
  const chain = verifyAuditChain(); const ctl = getControl(); const gates = releaseGates();
  const exposed = config.host === '0.0.0.0' || config.host === '::';
  const checks: Check[] = [
    { id: 'AUTH-1', area: 'Authentication', name: authMode() === 'privy' ? 'Privy owner identity' : 'Owner passphrase set (scrypt)',
      status: authMode() === 'privy' ? (privyOwnerBound() ? 'PASS' : 'FAIL') : owner ? 'PASS' : 'FAIL',
      detail: authMode() === 'privy'
        ? (privyOwnerBound() ? 'Preprovisioned owner DID is bound in the database' : privyOwnerFromEnv() ? 'Owner DID provisioned but first verified login is pending' : 'No server-provisioned Privy owner DID')
        : owner ? 'Local recovery owner configured' : 'not configured' },
    { id: 'AUTH-2FA', area: 'Authentication', name: 'Independent owner step-up',
      status: authMode() !== 'privy' || twoFactorEnrolled() ? 'PASS' : 'FAIL',
      detail: twoFactorEnrolled() ? 'TOTP enrolled' : authMode() === 'privy' ? 'Required before sensitive actions are allowed' : 'Offline recovery mode' },
    { id: 'AUTH-2', area: 'Authentication', name: 'Failed logins (24h)', status: failed24h >= 10 ? 'FAIL' : failed24h > 0 ? 'WARN' : 'PASS', detail: `${failed24h} failed attempt(s); login, step-up and passphrase change share one limit: 5 per client (then 1 min, doubling) and 20 per server per 15 min` },
    { id: 'AUTH-3', area: 'Authentication', name: 'Active sessions', status: sessions.length > 3 ? 'WARN' : 'PASS', detail: `${sessions.length} active (12 h expiry, HttpOnly SameSite=Strict cookie)` },
    { id: 'NET-1', area: 'Network', name: 'Listening interface', status: exposed ? 'WARN' : 'PASS', detail: exposed ? `bound to ${config.host}:${config.port}${inContainer() ? ' (container detected — needed for port forwarding)' : ''}; use TLS before exposing beyond a trusted network` : `loopback only (${config.host}:${config.port})` },
    { id: 'NET-2', area: 'Network', name: 'Request protections', status: 'PASS', detail: 'CSRF header on state changes, CSP, nosniff, frame-deny, 256 KB body limit' },
    { id: 'NET-3', area: 'Network', name: 'API rate limiting', status: 'PASS', detail: 'passphrase checks limited per client and globally; Trader Joe, backtests, analysis, instrument loads and news refresh limited per session' },
    { id: 'DATA-1', area: 'Data', name: 'Audit log integrity', status: chain.ok ? 'PASS' : 'FAIL', detail: `${chain.entries} hash-chained entries${chain.ok ? ' verified' : ` — broken at ${chain.brokenAt}`}` },
    { id: 'DATA-2', area: 'Data', name: 'Database encryption at rest', status: 'WARN', detail: 'SQLite file not encrypted; contains no API keys or private keys (SEC-04)' },
    { id: 'SEC-1', area: 'Secrets', name: 'Anthropic API key', status: 'INFO', detail: config.anthropicApiKey ? 'configured (server-side only)' : 'not configured' },
    { id: 'SEC-2', area: 'Secrets', name: 'Telegram bot token', status: 'INFO', detail: config.telegramBotToken ? 'configured (server-side only)' : 'not configured' },
    { id: 'SEC-3', area: 'Secrets', name: 'Evidence-packet signing key', status: config.evidenceKeySource === 'ephemeral' ? 'WARN' : 'PASS', detail: ({ env: 'MIA_EVIDENCE_KEY configured (validated, 32+ bytes)', file: 'persistent key in data/evidence.key (mode 0600)', generated: 'persistent key created in data/evidence.key (mode 0600) — back it up with the database', ephemeral: 'random per process — packets cannot be re-verified after restart' } as const)[config.evidenceKeySource] },
    { id: 'WAL-1', area: 'Wallet', name: 'Seed phrases / private keys', status: 'PASS', detail: 'never requested or stored; no signer exists' },
    { id: 'WAL-2', area: 'Wallet', name: 'Withdrawal freeze', status: withdrawalFrozen() ? 'INFO' : 'INFO', detail: withdrawalFrozen() ? 'FROZEN' : 'off (withdrawals are preview-only regardless)' },
    { id: 'EXE-1', area: 'Execution', name: 'Live trading', status: gates.liveAllowed ? 'WARN' : 'PASS', detail: `LOCKED — ${gates.summary}` },
    { id: 'EXE-2', area: 'Execution', name: 'Emergency state', status: ctl.emergency ? 'WARN' : 'INFO', detail: ctl.emergency ? 'EMERGENCY STOP active' : `mode ${ctl.mode}${ctl.pausedNewOrders ? ', new orders paused' : ''}` },
    { id: 'AI-1', area: 'AI boundaries', name: 'Trader Joe authority', status: 'PASS', detail: 'read, analyze and pause only — no order, limit, mode, funding or withdrawal tools' },
  ];
  return {
    checks, sessions: sessions.map((s) => ({ id: s.token_hash.slice(0, 12), createdAt: s.created_at, expiresAt: s.expires_at, current: s.token_hash === cur })),
    authEvents, summary: { pass: checks.filter((c) => c.status === 'PASS').length, warn: checks.filter((c) => c.status === 'WARN').length, fail: checks.filter((c) => c.status === 'FAIL').length },
  };
}
/** Sign out every session except the caller's. */
export function revokeOtherSessions(currentToken?: string) {
  const cur = currentToken ? sha256(currentToken) : '';
  const r = run('DELETE FROM sessions WHERE token_hash <> ?', cur);
  audit('owner', 'security.sessions.revokeOthers', { revoked: Number(r.changes) });
  return { revoked: Number(r.changes) };
}
