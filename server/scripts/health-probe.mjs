#!/usr/bin/env node
/**
 * Operational readiness probe for the existing MIA Fastify process.
 * Run: node server/scripts/health-probe.mjs
 * Exit 0 only when canonical /api/ready reports healthy.
 * /api/health is liveness, NOT trading readiness.
 */
const port = Number(process.env.MIA_PORT ?? '8787');
const timeoutMs = Number(process.env.MIA_HEALTH_CHECK_TIMEOUT_MS ?? '2000');
if (!Number.isInteger(port) || port < 1 || port > 65535 ||
    !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000) {
  console.error('MIA_NOT_READY: invalid local probe configuration');
  process.exitCode = 1;
} else {
  try {
    // Loopback only: no external URL, credentials, or redirects.
    const response = await fetch('http://127.0.0.1:' + port + '/api/ready', {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (response.status !== 200) throw new Error('NOT_READY');
    const report = await response.json();
    if (report?.ready !== true || !Array.isArray(report.checks) ||
        !report.checks.length ||
        !report.checks.every((check) =>
          check && ['pass', 'skip', 'info'].includes(check.status))) {
      throw new Error('INVALID_READINESS_REPORT');
    }
    console.log('MIA_READY');
  } catch {
    // Never echo internal responses, database paths, or provider errors.
    console.error('MIA_NOT_READY');
    process.exitCode = 1;
  }
}
