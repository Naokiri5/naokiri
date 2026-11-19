import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { openDb } from './db/db.js';
import './providers/binance.js'; import './providers/coinbase.js'; import './providers/kraken.js'; import './providers/coingecko.js';
import './providers/dexscreener.js'; import './providers/frankfurter.js'; import './providers/googlenews.js'; import './providers/pending.js';
import './providers/vike.js'; // one credentialed, read-only research provider; no trading authority
import { routes } from './api/routes.js';
import { contentSecurityPolicy, privyConfigProblem, privyEnabled, privyOwnerConfigProblem } from './security/privy.js';
import { authMode } from './security/stepUp.js';
import { seedStrategies } from './lab/lab.js';
import { seedCatalog, resumeIngestion } from './knowledge/store.js';
import { seedConcepts } from './knowledge/concepts.js';

export async function buildApp() {
  openDb(); seedStrategies(); seedCatalog(); seedConcepts(); resumeIngestion();
  const app = Fastify({ genReqId: (req) => { const h = req.headers['x-request-id']; return typeof h === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(h) ? h : randomUUID(); }, logger: { level: process.env.MIA_LOG ?? 'info', redact: ['req.headers.cookie', 'req.body.password', 'req.body.current', 'req.body.next'] }, bodyLimit: 256 * 1024 });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff'); reply.header('x-frame-options', 'DENY'); reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', contentSecurityPolicy()); // strict unless Privy sign-in is enabled
    // API responses (balances, positions, CSV exports) must not be cached by the browser or an intermediary.
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });
  // Root-level safety net for anything outside the API plugin (static files, future plugins): Fastify's default
  // handler would echo internal error messages. Client errors keep their message; server faults never do.
  app.setErrorHandler((err: any, req, reply) => {
    const code = Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (code >= 500) { req.log.error({ err }, 'unhandled server error'); return reply.code(code).send({ error: 'internal server error', requestId: req.id }); }
    return reply.code(code).send({ error: String(err?.message ?? 'request failed') });
  });
  const privyProblem = privyConfigProblem(); if (privyProblem) app.log.warn(privyProblem);
  const ownerProblem = privyOwnerConfigProblem(); if (ownerProblem) app.log.warn(ownerProblem);
  if (authMode() === 'privy' && !privyEnabled()) app.log.warn('Sign-in uses Privy (MIA_AUTH_MODE is not "passphrase") but MIA_PRIVY_APP_ID is not set: nobody can sign in until it is. See docs/operations/PRIVY_SIGN_IN.md');
  await app.register(routes);
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
  } else {
    // UI not built: explain instead of a bare JSON 404 that looks like a dead server.
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' })
      : reply.code(503).type('text/html').send(`<!doctype html><meta charset="utf-8"><title>MIA — UI not built</title><body style="font-family:system-ui;background:#0b0e13;color:#e6eaf0;padding:40px;max-width:640px"><h1>MIA API is running</h1><p>The web UI has not been built yet, so there is nothing to show at this address.</p><p>From the repository root run:</p><pre style="background:#151a22;padding:12px;border-radius:8px">npm run build\nnpm start</pre><p>Expected UI folder: <code>${config.webDist.replace(/[<>&]/g, '')}</code></p><p>API health: <a style="color:#4f8cff" href="/api/health">/api/health</a></p></body>`)));
  }
  return app;
}
