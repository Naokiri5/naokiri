import { describe, expect, it } from 'vitest';
import { privateCockpitSegment } from './privacy';
import type { Segment } from './status';

describe('cockpit privacy keeps safety signals without exposing figures', () => {
  it.each([
    ['BREAKER · 3.47% open · DD 8.9%', 'BREAKER', 'bad'],
    ['EMERGENCY STOP', 'EMERGENCY STOP', 'bad'],
    ['NO POLICY', 'NO POLICY', 'warn'],
    ['MARKS MISSING · 7', 'MARKS MISSING', 'unknown'],
    ['LOSS STREAK · 4', 'LOSS STREAK', 'warn'],
    ['STALE', 'STALE', 'unknown'],
    ['UNKNOWN', 'UNKNOWN', 'unknown'],
    ['3.47% open · DD 8.9%', 'Hidden', 'ok'],
  ] as const)('masks %s and retains its state and tone', (value, expected, tone) => {
    const segment: Segment = { id: 'risk', label: 'Risk', value, tone, detail: 'day -5.67% on $12,345.67', to: '/risk' };
    const result = privateCockpitSegment(segment);
    expect(result.value).toBe(expected);
    expect(result.tone).toBe(tone);
    expect(result.to).toBe('/risk');
    expect(JSON.stringify(result)).not.toMatch(/3\.47|8\.9|5\.67|12,345\.67/);
    expect(segment.value).toBe(value);
    expect(segment.detail).toContain('$12,345.67');
  });

  it('removes free-form engine errors without changing the health signal', () => {
    const engine: Segment = { id: 'engine', label: 'Engine', value: 'MONITOR FAILING', tone: 'bad', detail: 'Error while handling $12,345.67', to: '/bot' };
    const result = privateCockpitSegment(engine);
    expect(result.value).toBe('MONITOR FAILING');
    expect(result.tone).toBe('bad');
    expect(result.detail).not.toContain('12,345.67');
    expect(result.to).toBe('/bot');
  });
});
