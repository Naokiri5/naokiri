/**
 * MIA 5.0 — non-executing production readiness witness.
 *
 * This module REFUSES to authorize real-money trading. It extends the canonical
 * qa/gates.ts evidence, core/mode.ts hard lock and exec/environment.ts
 * availability; it never creates a second gate, accepts a remote "PASS",
 * stores credentials, makes network requests or issues a signer command.
 *
 * Future live execution must use a separately reviewed signer/firewall and
 * independently recorded human release. This witness is diagnostic only.
 */
import { currentBuildCommit, releaseGates, type Gate } from '../qa/gates.js';
import { LIVE_EXECUTION_AVAILABLE, getControl, type ControlState } from '../core/mode.js';
import { executionAdapter, type EnvironmentAvailability } from './environment.js';

const RELEASE_GATE_IDS = Array.from({ length: 14 }, (_, i) => 'G' + String(i + 1).padStart(2, '0'));
const BUILD_SHA_RE = /^[a-f0-9]{40}$/;

export type LiveReadinessCode =
  | 'GATE_MISSING'
  | 'GATE_DUPLICATED'
  | 'GATE_NOT_PASSED'
  | 'BUILD_SHA_UNVERIFIED'
  | 'LIVE_BUILD_DISABLED'
  | 'LIVE_ADAPTER_LOCKED'
  | 'MODE_NOT_BOUNDED_LIVE'
  | 'EMERGENCY_ACTIVE'
  | 'NEW_ORDERS_PAUSED'
  | 'SIGNER_CERTIFICATION_ABSENT'
  | 'VENUE_CERTIFICATION_ABSENT'
  | 'ACCOUNT_RECONCILIATION_UNVERIFIED'
  | 'PROTECTIVE_ORDER_VERIFICATION_ABSENT'
  | 'OWNER_RELEASE_GRANT_ABSENT'
  | 'INDEPENDENT_RELEASE_APPROVAL_ABSENT'
  | 'READINESS_INPUT_UNAVAILABLE'
  | 'READINESS_ONLY_NO_SIGNING_AUTHORITY';

export interface ReadinessBlocker {
  code: LiveReadinessCode;
  gateId?: string;
}
export interface LiveReadinessFacts {
  gates: ReadonlyArray<Pick<Gate, 'id' | 'status'>>;
  buildSha: string | null;
  liveBuildEnabled: boolean;
  liveAdapter: EnvironmentAvailability;
  control: Pick<ControlState, 'mode' | 'emergency' | 'pausedNewOrders'>;
  // These booleans are *certification proofs*, not the presence of an API key.
  signerCertified: boolean;
  venueCertified: boolean;
  reconciledAccount: boolean;
  protectionVerified: boolean;
  ownerReleaseGrantVerified: boolean;
  independentReleaseApprovalVerified: boolean;
}
export interface LiveReadinessReport {
  environment: 'LIVE';
  permission: 'LOCKED';
  canAuthorizeTrade: false;
  canSignOrder: false;
  operationalReleaseCertified: false;
  buildSha: string | null;
  gateSummary: { total: 14; passed: number; blocked: number };
  blockers: ReadinessBlocker[];
  note: 'READINESS_ONLY_NO_ORDER_EXECUTION';
}

export function evaluateLiveReadiness(facts: Readonly<LiveReadinessFacts>): LiveReadinessReport {
  const blockers: ReadinessBlocker[] = [];
  const counts = new Map<string, number>();
  for (const gate of facts.gates) counts.set(gate.id, (counts.get(gate.id) ?? 0) + 1);
  let passed = 0;
  for (const id of RELEASE_GATE_IDS) {
    const count = counts.get(id) ?? 0;
    if (!count) blockers.push({ code: 'GATE_MISSING', gateId: id });
    else if (count !== 1) blockers.push({ code: 'GATE_DUPLICATED', gateId: id });
    else if (facts.gates.find(g => g.id === id)?.status !== 'PASS')
      blockers.push({ code: 'GATE_NOT_PASSED', gateId: id });
    else passed++;
  }
  // Unexpected gates also fail closed; do not let a new/renamed gate disappear.
  for (const id of counts.keys()) if (!RELEASE_GATE_IDS.includes(id))
    blockers.push({ code: 'GATE_NOT_PASSED', gateId: id });

  if (!facts.buildSha || !BUILD_SHA_RE.test(facts.buildSha))
    blockers.push({ code: 'BUILD_SHA_UNVERIFIED' });
  if (!facts.liveBuildEnabled) blockers.push({ code: 'LIVE_BUILD_DISABLED' });
  if (facts.liveAdapter === 'LOCKED') blockers.push({ code: 'LIVE_ADAPTER_LOCKED' });
  if (facts.control.mode !== 'BOUNDED_LIVE') blockers.push({ code: 'MODE_NOT_BOUNDED_LIVE' });
  if (facts.control.emergency) blockers.push({ code: 'EMERGENCY_ACTIVE' });
  if (facts.control.pausedNewOrders) blockers.push({ code: 'NEW_ORDERS_PAUSED' });
  if (!facts.signerCertified) blockers.push({ code: 'SIGNER_CERTIFICATION_ABSENT' });
  if (!facts.venueCertified) blockers.push({ code: 'VENUE_CERTIFICATION_ABSENT' });
  if (!facts.reconciledAccount) blockers.push({ code: 'ACCOUNT_RECONCILIATION_UNVERIFIED' });
  if (!facts.protectionVerified) blockers.push({ code: 'PROTECTIVE_ORDER_VERIFICATION_ABSENT' });
  if (!facts.ownerReleaseGrantVerified) blockers.push({ code: 'OWNER_RELEASE_GRANT_ABSENT' });
  if (!facts.independentReleaseApprovalVerified)
    blockers.push({ code: 'INDEPENDENT_RELEASE_APPROVAL_ABSENT' });
  // This diagnostic module is never a signer or a positive authority.
  blockers.push({ code: 'READINESS_ONLY_NO_SIGNING_AUTHORITY' });

  return {
    environment: 'LIVE', permission: 'LOCKED',
    canAuthorizeTrade: false, canSignOrder: false,
    operationalReleaseCertified: false, buildSha: facts.buildSha,
    gateSummary: { total: 14, passed, blocked: 14 - passed },
    blockers, note: 'READINESS_ONLY_NO_ORDER_EXECUTION',
  };
}

/**
 * Real evidence from the existing MIA modules. Absence of independent
 * signer/reconciliation certificates must be reported as ABSENT, never inferred
 * from testnet keys, a GitHub green CI check or an owner login.
 */
export function liveReadinessReport(): LiveReadinessReport {
  try {
    const actual = releaseGates();
    return evaluateLiveReadiness({
      gates: actual.gates, buildSha: currentBuildCommit(),
      liveBuildEnabled: LIVE_EXECUTION_AVAILABLE,
      liveAdapter: executionAdapter('LIVE').availability().state,
      control: getControl(),
      signerCertified: false,
      venueCertified: false,
      reconciledAccount: false,
      protectionVerified: false,
      ownerReleaseGrantVerified: false,
      independentReleaseApprovalVerified: false,
    });
  } catch {
    return {
      environment: 'LIVE', permission: 'LOCKED',
      canAuthorizeTrade: false, canSignOrder: false,
      operationalReleaseCertified: false, buildSha: null,
      gateSummary: { total: 14, passed: 0, blocked: 14 },
      blockers: [
        { code: 'READINESS_INPUT_UNAVAILABLE' },
        { code: 'READINESS_ONLY_NO_SIGNING_AUTHORITY' },
      ], note: 'READINESS_ONLY_NO_ORDER_EXECUTION',
    };
  }
}
