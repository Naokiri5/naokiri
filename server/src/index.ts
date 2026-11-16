import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db/db.js';
import './providers/binance.js'; import './providers/coinbase.js'; import './providers/kraken.js'; import './providers/coingecko.js';
import './providers/dexscreener.js'; import './providers/frankfurter.js'; import './providers/googlenews.js'; import './providers/pending.js';
import { routes } from './api/routes.js';
import { startBot, stopBot } from './bot/bot.js';
import { seedStrategies } from './lab/lab.js';

export async function buildApp() {
  openDb(); seedStrategies();
  const app = Fastify({ logger: { level: process.env.MIA_LOG ?? 'info', redact: ['req.headers.cookie', 'req.body.password'] }, bodyLimit: 256 * 1024 });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff'); reply.header('x-frame-options', 'DENY'); reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'");
    return payload;
  });
  await app.register(routes);
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
  }
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  startBot();
  const shutdown = async () => { stopBot(); await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
