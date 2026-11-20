import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { run, all, tx } from '../src/db/db.js';
import { audit } from '../src/core/audit.js';
import { getControl } from '../src/core/mode.js';
import { setSetting } from '../src/core/settings.js';
import { failureGate } from '../src/core/ratelimit.js';
import { assessSecurityEvent, type GuardianEvent } from '../src/security/guardian/assess.js';
import { collectEvents, lastEvidencePass, MAX_EVIDENCE_ROWS } from '../src/security/guardian/events.js';
import { assessAll, autoContain } from '../src/security/guardian/response.js';
import { posture, JOE_ALLOWED_TOOLS } from '../src/security/guardian/posture.js';
import { JOE_TOOL_NAMES } from '../src/joe/joe.js';

/** Guardian Shield: read-only telemetry over the audit log, negative-only containment, and privilege-boundary tests. */
const CANARY = 'CANARY-SECRET-7f3a9e';
const ev = (kind: GuardianEvent['kind'], over: Partial<GuardianEvent> = {}): GuardianEvent =>
  ({ kind, timestampMs: Date.now(), sourceId: 'audit_log', evidenceId: 'audit:1', sanitizedSummary: 'x', ...over });

describe('assessment (pure, negative-only)', () => {
  it('rates signer requests, unauthorized mode changes and a broken audit chain P0 and never grants authority', () => {
    for (const k of ['UNEXPECTED_SIGNER_REQUEST', 'UNAUTHORIZED_MODE_CHANGE', 'AUDIT_CHAIN_BROKEN'] as const) {
      const a = assessSecurityEvent(ev(k), Date.now());
      expect(a.severity).toBe('P0'); expect(a.suggestions).toContain('PAUSE_NEW_EXPOSURE_REQUEST');
      expect(a).toMatchObject({ canAuthorizeTrading: false, canSignTransactions: false, canWithdraw: false });
      expect(Object.isFrozen(a)).toBe(true);
    }
    expect(assessSecurityEvent(ev('LOGIN_FAILURE_BURST'), Date.now()).severity).toBe('P2');
    expect(assessSecurityEvent(ev('OWNER_IDENTITY_CHANGED'), Date.now()).suggestions).toContain('VERIFY_IDENTITY');
  });
  it('quarantines events with a future or stale timestamp or no provenance instead of acting on them', () => {
    const now = Date.now();
    for (const bad of [ev('UNAUTHORIZED_MODE_CHANGE', { timestampMs: now + 60_000 }), ev('UNAUTHORIZED_MODE_CHANGE', { timestampMs: now - 2 * 86_400_000 }), ev('UNAUTHORIZED_MODE_CHANGE', { evidenceId: '' })]) {
      const a = assessSecurityEvent(bad, now);
      expect(a.severity).toBe('P1'); expect(a.suggestions).toEqual(['QUARANTINE_INPUT']);
    }
  });
});

describe('events from the audit log', () => {
  beforeEach(() => { freshDb(); failureGate.reset(); delete process.env.MIA_GUARDIAN_AUTOPAUSE; });
  it('detects a burst of failed sign-ins only at the threshold, without copying IPs or secrets into the summary', () => {
    for (let i = 0; i < 4; i++) audit('anonymous', 'auth.login.failed', { ip: '203.0.113.7', note: CANARY });
    expect(collectEvents().some((e) => e.kind === 'LOGIN_FAILURE_BURST')).toBe(false);
    audit('anonymous', 'auth.login.failed', { ip: '203.0.113.7', note: CANARY });
    const e = collectEvents().find((x) => x.kind === 'LOGIN_FAILURE_BURST')!;
    expect(e.sanitizedSummary).toMatch(/5 failed sign-ins/);
    expect(JSON.stringify(collectEvents())).not.toMatch(new RegExp(`${CANARY}|203\\.0\\.113`));
  });
  it('flags step-up guessing, identity replacement and withdrawal attempts; a first authenticator enrollment is normal setup', () => {
    for (let i = 0; i < 3; i++) audit('anonymous', 'auth.stepup.failed', { purpose: 'step-up' });
    audit('owner', 'auth.2fa.enrolled');
    audit('owner', 'auth.privy.link', { userId: 'did:privy:new', replaced: 'did:privy:old' });
    audit('owner', 'withdrawal.preview', { id: 'w1' });
    const kinds = collectEvents().map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['STEP_UP_FAILURE_BURST', 'OWNER_IDENTITY_CHANGED', 'WITHDRAWAL_ATTEMPT']));
    expect(kinds.filter((k) => k === 'OWNER_IDENTITY_CHANGED')).toHaveLength(1); // the enrollment alone is not an alert
  });
  it('a mode change by anyone but the owner, or to Live, is UNAUTHORIZED_MODE_CHANGE; an owner paper change is not', () => {
    audit('owner', 'control.update', { from: { mode: 'OBSERVE' }, to: { mode: 'PAPER' } });
    expect(collectEvents().some((e) => e.kind === 'UNAUTHORIZED_MODE_CHANGE')).toBe(false);
    audit('worker-x', 'control.update', { from: { mode: 'PAPER' }, to: { mode: 'APPROVAL' } });
    expect(collectEvents().find((e) => e.kind === 'UNAUTHORIZED_MODE_CHANGE')?.sanitizedSummary).toMatch(/worker-x/);
  });
  it('a tampered audit row breaks the hash chain and raises a P0', () => {
    audit('owner', 'note', { a: 1 }); audit('owner', 'note', { a: 2 });
    run("UPDATE audit_log SET detail='{\"a\":99}' WHERE id=(SELECT MIN(id) FROM audit_log)");
    const p0 = assessAll().find((i) => i.event.kind === 'AUDIT_CHAIN_BROKEN')!;
    expect(p0.assessment.severity).toBe('P0');
  });
});

describe('containment: opt-in, pause-only, once per event', () => {
  beforeEach(() => { freshDb(); delete process.env.MIA_GUARDIAN_AUTOPAUSE; });
  afterEach(() => { delete process.env.MIA_GUARDIAN_AUTOPAUSE; });
  const raiseP0 = () => audit('worker-x', 'control.update', { from: { mode: 'PAPER' }, to: { mode: 'APPROVAL' } });
  it('does nothing unless the owner enabled MIA_GUARDIAN_AUTOPAUSE=1', () => {
    raiseP0();
    expect(autoContain().action).toBe('DISABLED'); expect(getControl().pausedNewOrders).toBe(false);
  });
  it('pauses new orders only — no emergency, no mode or limit change — and does not re-pause after the owner resumes', () => {
    process.env.MIA_GUARDIAN_AUTOPAUSE = '1';
    const before = getControl(); raiseP0();
    expect(autoContain().action).toBe('PAUSED');
    const after = getControl();
    expect(after.pausedNewOrders).toBe(true); expect(after.emergency).toBe(before.emergency); expect(after.mode).toBe(before.mode);
    expect(all("SELECT action FROM audit_log WHERE actor='guardian'").map((r: any) => r.action)).toContain('security.guardian.pause');
    run("UPDATE settings SET value=json_set(value,'$.pausedNewOrders',json('false')) WHERE key='control'"); // the owner reviewed and resumed
    expect(autoContain().action).toBe('NONE'); // same evidence: not paused again
  });
  it('CodeRabbit #45: an older unhandled P0 is still contained when another P0 was already handled', () => {
    process.env.MIA_GUARDIAN_AUTOPAUSE = '1';
    raiseP0(); raiseP0();
    const items = assessAll();
    const p0 = items.filter((i) => i.assessment.severity === 'P0');
    expect(p0).toHaveLength(2);
    setSetting('guardian_handled_evidence', [p0[0].event.evidenceId]);
    expect(autoContain(items)).toEqual({ action: 'PAUSED', evidenceId: p0[1].event.evidenceId }); // was NONE
  });
  it('CodeRabbit #45: if the pause write fails, the evidence is not marked handled, so the next tick retries', () => {
    process.env.MIA_GUARDIAN_AUTOPAUSE = '1';
    raiseP0();
    run("CREATE TRIGGER fail_control_ins BEFORE INSERT ON settings WHEN NEW.key='control' BEGIN SELECT RAISE(ABORT,'simulated lock timeout'); END");
    run("CREATE TRIGGER fail_control_upd BEFORE UPDATE ON settings WHEN NEW.key='control' BEGIN SELECT RAISE(ABORT,'simulated lock timeout'); END");
    expect(() => autoContain()).toThrow(/simulated lock timeout/);
    run('DROP TRIGGER fail_control_ins'); run('DROP TRIGGER fail_control_upd');
    expect(all("SELECT value FROM settings WHERE key='guardian_handled_evidence'").map((r: any) => r.value).join('')).not.toMatch(/audit:/);
    expect(autoContain().action).toBe('PAUSED'); // was NONE forever: the marker had committed without the pause
    expect(getControl().pausedNewOrders).toBe(true);
  });
  it('CodeRabbit #45: a flood of older rows cannot hide the newest security evidence, and truncation is reported', () => {
    tx(() => { for (let i = 0; i < MAX_EVIDENCE_ROWS; i++) audit('anonymous', 'auth.login.failed', { n: i }); });
    raiseP0(); // row MAX_EVIDENCE_ROWS + 1: the newest
    expect(collectEvents().some((e) => e.kind === 'UNAUTHORIZED_MODE_CHANGE')).toBe(true); // was invisible
    expect(lastEvidencePass()).toEqual({ truncated: true, rows: MAX_EVIDENCE_ROWS });
  }, 60_000);
  it('the dispatcher source cannot resume, clear an emergency, change mode or reach orders, wallets or the network', () => {
    const src = readFileSync(new URL('../src/security/guardian/response.ts', import.meta.url), 'utf8').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/pausedNewOrders:\s*false|emergency:\s*false|mode:\s*['"]|disabledStrategies/);
    expect(src).not.toMatch(/from ['"][^'"]*(exec\/|wallet\/|providers\/http|node:http|fetch\()/);
  });
});

describe('privilege boundaries (GUARD-021 / 049 / 096)', () => {
  const srcRoot = new URL('../src/', import.meta.url).pathname;
  const files = (dir: string): string[] => readdirSync(join(srcRoot, dir)).flatMap((n) => { const p = join(dir, n); return statSync(join(srcRoot, p)).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
  const imports = (rel: string) => [...readFileSync(join(srcRoot, rel), 'utf8').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)].map((m) => ({ names: m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean), from: m[2] }));
  /** Allowed imports from the order system and wallet, per area. Anything else is a boundary violation. */
  const RULES: Record<string, { oms: string[]; wallet: string[] }> = {
    joe: { oms: ['pauseNewOrders', 'listPositions' /* read-only */], wallet: [] }, knowledge: { oms: [], wallet: [] }, research: { oms: [], wallet: [] },
    prediction: { oms: [], wallet: [] }, 'security/guardian': { oms: [], wallet: ['withdrawalFrozen'] },
  };
  for (const [dir, rule] of Object.entries(RULES)) {
    it(`${dir}/ only touches the order system and wallet through its allowlist`, () => {
      const bad: string[] = [];
      for (const f of files(dir)) for (const i of imports(f)) {
        if (/exec\/oms\.js$/.test(i.from)) bad.push(...i.names.filter((n) => !rule.oms.includes(n)).map((n) => `${f}: oms.${n}`));
        if (/wallet\/wallet\.js$/.test(i.from)) bad.push(...i.names.filter((n) => !rule.wallet.includes(n)).map((n) => `${f}: wallet.${n}`));
        if (/exec\/(?!oms)/.test(i.from)) bad.push(`${f}: ${i.from}`);
      }
      expect(bad).toEqual([]);
    });
  }
  it('Trader Joe exposes only read/analyse tools plus the risk-reducing pause', () => {
    expect(JOE_TOOL_NAMES.filter((t) => !JOE_ALLOWED_TOOLS.has(t))).toEqual([]);
    expect(posture().find((l) => l.id === 3)!.items.find((i) => i.id === 'APP-1')!.status).toBe('PASS');
  });
});

describe('Guardian route and request protections', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  const PW = 'guardian route owner';
  beforeAll(async () => { freshDb(); failureGate.reset(); app = await buildApp(); cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload(PW) })).headers['set-cookie']).split(';')[0]; });
  afterAll(async () => { await app.close(); });
  beforeEach(() => failureGate.reset());
  it('needs an owner session; reports 7 layers, unknowns as NOT_VERIFIED/NOT_CONFIGURED, and zero authority', async () => {
    expect((await app.inject({ url: '/api/security/guardian' })).statusCode).toBe(401);
    const j = (await app.inject({ url: '/api/security/guardian', headers: { cookie } })).json();
    expect(j.layers).toHaveLength(7);
    expect(j.layers[0].items.find((i: any) => i.id === 'EDGE-1').status).toBe('NOT_VERIFIED');
    expect(j.layers[6].items.find((i: any) => i.id === 'REC-2').status).toBe('NOT_CONFIGURED');
    expect(j.authority).toEqual({ canAuthorizeTrading: false, canSignTransactions: false, canWithdraw: false, canResume: false });
  });
  it('a forged X-Forwarded-For cannot dodge the sign-in limiter (GUARD-006)', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i}` }, payload: { password: 'wrong passphrase' } })).statusCode;
    expect(last).toBe(429);
  });
  it('oversized request bodies are refused before parsing (GUARD-007)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ password: 'x'.repeat(300 * 1024) }) });
    expect(r.statusCode).toBe(413);
  });
  it('a secret sent with a failed step-up never reaches the audit log or Guardian output (GUARD-050/082)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/control', headers: { cookie, 'content-type': 'application/json', 'x-mia-csrf': '1' }, payload: { pausedNewOrders: false, password: `${CANARY}-wrong` } });
    expect(r.statusCode).toBe(403);
    expect(JSON.stringify(all('SELECT * FROM audit_log'))).not.toContain(CANARY);
    expect(JSON.stringify((await app.inject({ url: '/api/security/guardian', headers: { cookie } })).json())).not.toContain(CANARY);
  });
});
