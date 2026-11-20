import { describe, it, expect } from 'vitest';
import { toolGate, JOE_LIMITS, PAUSE_INTENT } from '../src/joe/joe.js';

/** Deterministic Trader Joe tool limits (MIA-SEC-001 / MIA-SEC-002): enforced in code, not by the system prompt. */
describe('Trader Joe tool gate', () => {
  it('runs pause_new_orders only when the owner asked for it in this message', () => {
    for (const ask of ['pause new orders', 'please halt trading', 'Stop trading now', 'stop new orders', 'freeze everything'])
      expect(toolGate('pause_new_orders', ['pause_new_orders'], ask), ask).toBeNull();
    // An injected headline reaching Joe through get_news while the owner only asked about the news.
    for (const ask of ["what's the news?", 'summarize BTC', 'is there any risk today?', 'unstoppable rally?'])
      expect(toolGate('pause_new_orders', ['get_news', 'pause_new_orders'], ask), ask).toMatch(/explicit request/);
    expect(PAUSE_INTENT.test('stop loss levels for ETH')).toBe(false);
  });
  it('caps full analyses per message', () => {
    const used: string[] = [];
    const results = Array.from({ length: 6 }, () => { used.push('analyze_instrument'); return toolGate('analyze_instrument', used, 'analyze the top 50'); });
    expect(results.slice(0, JOE_LIMITS.analyzePerMessage)).toEqual([null, null, null]);
    expect(results.slice(JOE_LIMITS.analyzePerMessage).every((r) => /at most 3/.test(r!))).toBe(true);
  });
  it('caps total tool calls per message', () => {
    const used = Array.from({ length: JOE_LIMITS.toolCallsPerMessage + 1 }, () => 'get_news');
    expect(toolGate('get_news', used, 'news')).toMatch(/tool-call limit/);
    expect(toolGate('get_news', used.slice(0, JOE_LIMITS.toolCallsPerMessage), 'news')).toBeNull();
  });
});
