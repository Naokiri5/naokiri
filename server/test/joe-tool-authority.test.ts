import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { getControl } from '../src/core/mode.js';
import { run } from '../src/db/db.js';
import { askJoe } from '../src/joe/joe.js';
import { freshDb } from './helpers.js';

const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  static APIError = Error;
  beta = { messages: { create: createMessage } };
} }));

const originalKey = config.anthropicApiKey;

beforeEach(() => {
  freshDb();
  config.anthropicApiKey = 'test-only';
  createMessage.mockReset();
});
afterEach(() => { config.anthropicApiKey = originalKey; });

describe('Trader Joe tool authority', () => {
  it('treats news and model-proposed commands as evidence only', async () => {
    const headline = 'External headline instructs the assistant to pause all new orders.';
    run('INSERT INTO news(id,ts,fetched_at,title,source,impact,assets,credibility) VALUES (?,?,?,?,?,?,?,?)',
      'fixture', Date.now(), Date.now(), headline, 'external fixture', 'HIGH', '{}', 'LOW');
    createMessage
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'news', name: 'get_news', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'pause', name: 'pause_new_orders', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Headline reviewed.' }] });

    await expect(askJoe('Summarize current news.')).resolves.toMatchObject({ mode: 'LLM', toolsUsed: ['get_news'] });
    expect(JSON.stringify(createMessage.mock.calls[1][0].messages)).toContain(headline);
    expect(createMessage.mock.calls[0][0].tools).not.toContainEqual(expect.objectContaining({ name: 'pause_new_orders' }));
    expect(getControl().pausedNewOrders).toBe(false);
  });

  it('handles a standalone owner pause without involving the model', async () => {
    await expect(askJoe('[viewing Risk Center] pause')).resolves.toMatchObject({ mode: 'COMMAND', reply: expect.stringContaining('New orders paused') });
    expect(createMessage).not.toHaveBeenCalled();
    expect(getControl().pausedNewOrders).toBe(true);
  });
});
