import { describe, expect, it } from 'vitest';
import { ALL_PAGES, NAV_GROUPS, groupForPath, pageForPath } from './nav';

describe('MIA 6.0 four-section navigation compatibility', () => {
  it('has exactly the four required operator surfaces, with no duplicate destinations', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      'Autopilot', 'Trader Joe', 'Smart Portfolio', 'Settings',
    ]);
    expect(NAV_GROUPS.map((group) => group.pages[0].to)).toEqual([
      '/autopilot', '/trader-joe', '/smart-portfolio', '/settings',
    ]);
    expect(NAV_GROUPS.every((group) => group.pages.length === 1)).toBe(true);
    expect(new Set(NAV_GROUPS.flatMap((group) => group.pages.map((page) => page.to))).size).toBe(4);
  });

  it.each([
    ['/app', 'autopilot'], ['/app/terminal/BTCUSDT', 'autopilot'],
    ['/bot', 'autopilot'], ['/scanner', 'autopilot'], ['/terminal/BTCUSDT', 'autopilot'],
    ['/intelligence', 'autopilot'], ['/autopilot', 'autopilot'],
    ['/joe', 'trader-joe'], ['/trader-joe', 'trader-joe'],
    ['/ditas', 'trader-joe'], ['/decision/decision-1', 'trader-joe'],
    ['/academy', 'trader-joe'],
    ['/smart-portfolio', 'smart-portfolio'], ['/portfolio', 'smart-portfolio'],
    ['/history', 'smart-portfolio'], ['/wallet', 'smart-portfolio'],
    ['/settings', 'settings'], ['/risk', 'settings'], ['/lab', 'settings'],
    ['/qhef', 'settings'], ['/security', 'settings'], ['/qa', 'settings'],
  ])('maps %s to its existing canonical owner %s', (path, expected) => {
    expect(groupForPath(path)?.id).toBe(expected);
  });

  it('preserves the full legacy command/search catalogue and detail routes', () => {
    for (const path of ['/terminal', '/scanner', '/discover', '/bubbles', '/whales', '/holders',
      '/copy', '/news', '/bot', '/risk', '/lab', '/portfolio', '/history', '/journal',
      '/calendar', '/wallet', '/intelligence', '/ditas', '/qhef', '/academy',
      '/connections', '/notifications', '/security', '/qa', '/settings', '/joe']) {
      expect(ALL_PAGES.some((page) => page.to === path), path).toBe(true);
      expect(pageForPath(path), path).not.toBeNull();
      expect(groupForPath(path), path).not.toBeNull();
    }
    expect(pageForPath('/terminal/BTCUSDT')?.to).toBe('/terminal');
    expect(groupForPath('/nonexistent')).toBeNull();
  });
});
