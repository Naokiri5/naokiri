import { assessExitProtection, type ExitAssessment, type ExitEvidence } from '../risk/exitProtection.js';

/**
 * One monitoring contract for PAPER and LIVE, with separate authoritative evidence sources.
 * The adapter is read-only. It never routes orders, claims a fill or bypasses release gates.
 * No LIVE adapter is installed by default.
 */
export type PositionEnvironment = 'PAPER' | 'LIVE';
export interface ExitMonitorSource {
  readonly environment: PositionEnvironment;
  /** Must return authoritative open positions and current venue/DEX evidence. */
  snapshot(): Promise<readonly ExitEvidence[]>;
}
export interface ExitMonitorSink {
  record(environment: PositionEnvironment, assessment: ExitAssessment): Promise<void> | void;
  /** Called on missing evidence, not silently treated as safe. */
  degraded(environment: PositionEnvironment, reason: string): Promise<void> | void;
}
export interface ExitMonitorReport {
  environment: PositionEnvironment;
  assessed: number;
  critical: number;
  degraded: boolean;
}

/**
 * Pure assessment plus explicit read-only evidence/audit ports.
 * Caller must independently authenticate a LIVE venue before supplying its source.
 * This function never attempts an order; canonical OMS owns any future execution.
 */
export async function monitorExitProtection(
  source: ExitMonitorSource,
  sink: ExitMonitorSink,
): Promise<ExitMonitorReport> {
  const report: ExitMonitorReport = { environment: source.environment, assessed: 0, critical: 0, degraded: false };
  if (source.environment !== 'PAPER' && source.environment !== 'LIVE') {
    throw new Error('INVALID_EXIT_MONITOR_ENVIRONMENT');
  }
  let evidence: readonly ExitEvidence[];
  try {
    evidence = await source.snapshot();
    if (!Array.isArray(evidence)) throw new Error('INVALID_POSITION_SNAPSHOT');
  } catch (error) {
    report.degraded = true;
    await sink.degraded(source.environment, `POSITION_SNAPSHOT_UNAVAILABLE: ${String(error).slice(0, 200)}`);
    return report;
  }
  for (const item of evidence) {
    let assessment: ExitAssessment;
    try {
      assessment = assessExitProtection(item);
    } catch (error) {
      report.degraded = true;
      await sink.degraded(source.environment, `EXIT_ASSESSMENT_FAILED: ${String(error).slice(0, 200)}`);
      continue;
    }
    report.assessed++;
    if (assessment.severity === 'CRITICAL') report.critical++;
    if (assessment.action === 'PROTECTION_UNVERIFIED') report.degraded = true;
    await sink.record(source.environment, assessment);
  }
  return report;
}
