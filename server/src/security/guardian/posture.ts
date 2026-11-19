/**
 * Guardian Shield posture: the seven defence layers with what MIA can MEASURE about each. Anything MIA cannot see from
 * inside the process (edge WAF/DDoS, host runtime monitoring, remote log anchors) is reported NOT_VERIFIED or
 * NOT_CONFIGURED — never green (GUARD-099). No scores, no "unhackable" claims.
 */
import { all, get } from '../../db/db.js';
import { config, inContainer } from '../../config.js';
import { verifyAuditChain } from '../../core/audit.js';
import { getControl } from '../../core/mode.js';
import { releaseGates } from '../../qa/gates.js';
import { withdrawalFrozen } from '../../wallet/wallet.js';
import { backupKey, listBackups } from '../../ops/backup.js';
import { authMode, stepUpMethod } from '../stepUp.js';
import { privyEnabled, privyOwnerBound } from '../privy.js';
import { JOE_TOOL_NAMES } from '../../joe/joe.js';
import { autoPauseEnabled } from './response.js';

export type PostureStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_CONFIGURED' | 'NOT_VERIFIED' | 'INFO';
export interface PostureItem { id: string; name: string; status: PostureStatus; detail: string }
export interface Layer { id: number; name: string; items: PostureItem[] }

/** Tools Trader Joe may call: read/analyse plus the single risk-reducing pause. Anything else fails this check. */
export const JOE_ALLOWED_TOOLS = new Set(['get_status', 'get_market_overview', 'get_instrument', 'analyze_instrument', 'get_opportunities', 'explain_decision',
  'get_portfolio', 'get_risk_status', 'get_news', 'get_large_prints', 'search_knowledge', 'pause_new_orders']);

export function posture(): Layer[] {
  const exposed = config.host === '0.0.0.0' || config.host === '::';
  const mode = authMode(); const step = stepUpMethod(); const ctl = getControl(); const gates = releaseGates(); const chain = verifyAuditChain();
  const sessions = get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?', Date.now())!.n;
  const extraTools = JOE_TOOL_NAMES.filter((t) => !JOE_ALLOWED_TOOLS.has(t));
  const backups = listBackups(); const lastBackup = backups[0];
  const hasKey = !!backupKey();
  const telegram = !!config.telegramBotToken;
  return [
    { id: 1, name: 'Edge wall', items: [
      { id: 'EDGE-1', name: 'Managed DDoS / WAF in front of MIA', status: 'NOT_VERIFIED', detail: 'MIA cannot see its own edge. Put a managed DDoS/WAF (e.g. Cloudflare) or a CRS-based ingress in front and keep the origin private (GUARD-001/002).' },
      { id: 'EDGE-2', name: 'Forwarded-for headers', status: 'PASS', detail: 'Proxy trust is off: rate limits key on the real connection, so a forged X-Forwarded-For cannot dodge them (tested, GUARD-006).' },
      { id: 'EDGE-3', name: 'Request size limit', status: 'PASS', detail: '256 KB body limit; larger requests are refused before parsing (tested, GUARD-007).' },
      { id: 'EDGE-4', name: 'Listening interface', status: exposed ? 'WARN' : 'PASS', detail: exposed ? `bound to ${config.host}:${config.port}${inContainer() ? ' (container)' : ''}; only expose it through TLS and an edge` : `loopback only (${config.host}:${config.port})` },
    ] },
    { id: 2, name: 'Identity wall', items: [
      { id: 'ID-1', name: 'Sign-in', status: mode === 'privy' ? (privyEnabled() && privyOwnerBound() ? 'PASS' : 'WARN') : 'INFO',
        detail: mode === 'privy' ? (privyEnabled() ? (privyOwnerBound() ? 'Privy, server-verified token, one bound owner' : 'Privy enabled but no owner bound yet') : 'Privy mode but MIA_PRIVY_APP_ID is not set') : 'legacy passphrase mode (MIA_AUTH_MODE=passphrase)' },
      { id: 'ID-2', name: 'Step-up for privileged actions', status: step === 'totp' ? 'PASS' : 'WARN',
        detail: step === 'totp' ? 'single-use authenticator codes, server-verified' : step === 'passphrase' ? 'legacy passphrase until an authenticator is enrolled' : 'no step-up method yet: privileged actions are refused (fail closed)' },
      { id: 'ID-3', name: 'Sessions', status: sessions > 3 ? 'WARN' : 'PASS', detail: `${sessions} active; HttpOnly SameSite=Strict cookie, 12 h expiry, server-side revocation` },
      { id: 'ID-4', name: 'CSRF on state changes', status: 'PASS', detail: 'custom header required on every non-GET API request (tested)' },
    ] },
    { id: 3, name: 'Application & agent wall', items: [
      { id: 'APP-1', name: 'Trader Joe tool firewall', status: extraTools.length ? 'FAIL' : 'PASS', detail: extraTools.length ? `unexpected tools: ${extraTools.join(', ')}` : 'read, analyse and pause only: no order, mode, limit, funding, wallet or withdrawal tool (tested, GUARD-049)' },
      { id: 'APP-2', name: 'Research / AI cannot reach the order system', status: 'PASS', detail: 'import-boundary test: Joe, knowledge, research, prediction and Guardian code never import the OMS or wallet writers (GUARD-021/096)' },
      { id: 'APP-3', name: 'Untrusted content', status: 'PASS', detail: 'news, documents, venue data and tool output are quoted as data; model text has no authority' },
    ] },
    { id: 4, name: 'Money wall', items: [
      { id: 'MON-1', name: 'Live trading', status: gates.liveAllowed ? 'WARN' : 'PASS', detail: `LOCKED: ${gates.summary}` },
      { id: 'MON-2', name: 'Signer / private keys', status: 'PASS', detail: 'no signer and no private keys in this build (release gates G07/G12 stay NOT_IMPLEMENTED)' },
      { id: 'MON-3', name: 'Withdrawals', status: 'PASS', detail: `preview only; freeze ${withdrawalFrozen() ? 'ON' : 'off'}` },
      { id: 'MON-4', name: 'Risk gate', status: 'PASS', detail: `fail-closed; mode ${ctl.mode}${ctl.pausedNewOrders ? ', new orders paused' : ''}${ctl.emergency ? ', EMERGENCY' : ''}` },
    ] },
    { id: 5, name: 'Host / malware wall', items: [
      { id: 'HOST-1', name: 'Runtime monitoring (Falco / Wazuh)', status: 'NOT_VERIFIED', detail: 'depends on where MIA runs; not visible from inside the app (GUARD-061/065)' },
      { id: 'HOST-2', name: 'Egress allowlist', status: 'NOT_VERIFIED', detail: 'set at the host or network level (GUARD-062)' },
    ] },
    { id: 6, name: 'Threat intelligence & incident wall', items: [
      { id: 'INC-1', name: 'Guardian rules', status: 'PASS', detail: 'sign-in and step-up bursts, identity changes, mode changes, signer actions, withdrawal attempts and audit-chain breaks are assessed P0–P3' },
      { id: 'INC-2', name: 'Automatic containment', status: 'INFO', detail: autoPauseEnabled() ? 'ON: a P0 pauses new orders once per event (exits stay protected; only the owner resumes)' : 'off (MIA_GUARDIAN_AUTOPAUSE=1 to let a P0 pause new orders)' },
      { id: 'INC-3', name: 'Out-of-band alert channel', status: telegram ? 'INFO' : 'NOT_CONFIGURED', detail: telegram ? 'Telegram configured' : 'no channel outside the web UI (GUARD-097)' },
    ] },
    { id: 7, name: 'Recovery & integrity wall', items: [
      { id: 'REC-1', name: 'Local audit hash chain', status: chain.ok ? 'PASS' : 'FAIL', detail: chain.ok ? `${chain.entries} entries verified` : `broken at entry ${chain.brokenAt}` },
      { id: 'REC-2', name: 'Remote log anchors', status: 'NOT_CONFIGURED', detail: 'the chain is only tamper-evident while the local database survives; export hash anchors to separate immutable storage (GUARD-083)' },
      { id: 'REC-3', name: 'Backups', status: !lastBackup ? 'WARN' : hasKey && lastBackup.encrypted ? 'PASS' : 'WARN',
        detail: lastBackup ? `last ${new Date(lastBackup.createdAt).toISOString()}${lastBackup.encrypted ? ', encrypted' : ', PLAINTEXT (set MIA_BACKUP_KEY)'}; offsite copy NOT_VERIFIED` : 'no backup yet' },
    ] },
  ];
}
export const recentGuardianActions = () => all<any>("SELECT ts, action, detail FROM audit_log WHERE actor='guardian' ORDER BY id DESC LIMIT 20");
