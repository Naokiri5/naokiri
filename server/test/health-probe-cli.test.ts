import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const probe = fileURLToPath(new URL('../scripts/health-probe.mjs', import.meta.url));

async function runWithReply(statusCode: number, body: unknown) {
  const server: Server = createServer((_req, res) => {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no local server address');
    return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [probe], {
        env: { ...process.env, MIA_PORT: String(address.port), MIA_HEALTH_CHECK_TIMEOUT_MS: '1000' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('operational container healthcheck CLI', () => {
  const checks = [
    { name: 'database', status: 'pass' },
    { name: 'runtime.heap', status: 'pass' },
    { name: 'runtime.sqlite', status: 'pass' },
    { name: 'runtime.sse', status: 'skip' },
  ];

  it('exits zero only when canonical readiness is truly healthy', async () => {
    const r = await runWithReply(200, { ready: true, checks });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('MIA_READY');
    expect(r.stderr).toBe('');
  });

  it('fails closed on actual readiness HTTP 503', async () => {
    const r = await runWithReply(503, { ready: false, checks: [...checks, { name: 'runtime.sqlite', status: 'fail' }] });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('MIA_NOT_READY');
  });

  it('fails closed when HTTP 200 lies about a failing check or omits checks', async () => {
    const bad = await runWithReply(200, { ready: true, checks: [{ name: 'runtime.heap', status: 'fail' }] });
    expect(bad.code).toBe(1);
    const empty = await runWithReply(200, { ready: true, checks: [] });
    expect(empty.code).toBe(1);
  });
});
