/**
 * Static audit for the uploaded MIA5 100-agent Hive target.
 * Run: npx tsx scripts/auditHiveWiring.ts
 * This does not execute market orders or claim an SLA.
 */
import { auditHiveWiring } from '../server/src/ops/hiveWiringAudit.js';
const report = auditHiveWiring();
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.allHundredRegistered || report.featureSlots !== 97 ||
    report.buckets.length !== 10) process.exitCode = 1;
