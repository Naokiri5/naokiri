import { describe, it, expect, vi, beforeEach } from 'vitest';

// MIA-BOT-001: a throwing journal/notify inside the lease check must not escape a lane as an unhandled rejection.
vi.mock('../src/journal/journal.js', async (orig) => ({ ...(await orig<any>()), journal: () => { throw new Error('SQLITE_BUSY: database is locked'); } }));
// The background lane may take a scheduled backup; this test is about lane errors, so it must not write backup files.
vi.mock('../src/ops/backup.js', async (orig) => ({ ...(await orig<any>()), maybeScheduledBackup: vi.fn(async () => null) }));

import { freshDb } from './helpers.js';
import { botStatus, _test } from '../src/bot/bot.js';

describe('bot lanes never reject', () => {
  beforeEach(() => { freshDb(); botStatus.lastError = null; });
  it('a role change whose journal write fails is recorded, the lease decision stands, and lanes resolve', async () => {
    botStatus.running = true; botStatus.role = 'STOPPED';
    try {
      expect(_test.holdEngine()).toBe(true); // role change LEADER → journal throws → caught
      expect(botStatus.role).toBe('LEADER');
      expect(botStatus.lastError).toMatch(/lease journal: SQLITE_BUSY/);
      botStatus.role = 'STOPPED';
      await expect(_test.backgroundLane()).resolves.toBeUndefined();
      botStatus.role = 'STOPPED';
      await expect(_test.hotLane()).resolves.toBeUndefined();
    } finally { botStatus.running = false; botStatus.role = 'STOPPED'; }
  });
});
