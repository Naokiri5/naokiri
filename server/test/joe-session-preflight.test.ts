import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botStatus } from '../src/bot/bot.js';
import { getControl } from '../src/core/mode.js';
import { closeDb } from '../src/db/db.js';
import { askJoe, chatHistory, commandMode } from '../src/joe/joe.js';
import { sessionPreflight } from '../src/ops/sessionPreflight.js';
import { freshDb } from './helpers.js';

describe('Trader Joe session evidence', () => {
  beforeEach(() => freshDb(false));
  afterEach(closeDb);

  it('explains the same selected PAPER blockers as Autopilot and leaves controls intact', async () => {
    const before = getControl();
    const preflight = sessionPreflight(botStatus, 'FAST', 'PAPER');
    const reply = await askJoe('session FAST PAPER');

    expect(reply).toMatchObject({ mode: 'COMMAND', toolsUsed: ['get_status'] });
    expect(reply.reply).toContain('FAST · PAPER · Run Session is unavailable');
    for (const check of preflight.checks.filter((item) => item.status === 'BLOCKED')) {
      expect(reply.reply).toContain(check.detail);
    }
    expect(reply.reply).toContain('Source: Autopilot session preflight.');
    expect(chatHistory().map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(getControl()).toEqual(before);
  });

  it('keeps DEEP LIVE readiness read-only in the contextual drawer', async () => {
    const before = getControl();
    const reply = await commandMode('[viewing Autopilot] session deep live');

    expect(reply).toContain('DEEP · LIVE · Run Session is unavailable');
    expect(reply).toContain('Source: Autopilot session preflight.');
    expect(getControl()).toEqual(before);
  });
});
