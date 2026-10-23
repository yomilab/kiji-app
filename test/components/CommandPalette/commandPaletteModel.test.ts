import { describe, expect, it } from 'vitest';
import {
  buildCommandPaletteEntries,
  COMMAND_PALETTE_MAX_RESULTS,
  COMMAND_PALETTE_RECENT_MAX,
  parseRecentCommandPaletteKeys,
  pushRecentCommandPaletteKey,
  rankCommandPaletteEntries,
  scoreCommandPaletteTitle,
  type CommandPaletteCatalog,
} from '@/components/CommandPalette/commandPaletteModel';

const feed = (id: string, title: string, tags: string[] = []) => ({ id, title, url: `https://example.com/${id}.xml`, tags });

const catalog: CommandPaletteCatalog = {
  smartViews: [
    { id: 'saved', visible: true },
    { id: 'unread', visible: true },
    { id: 'all', visible: true },
    { id: 'read', visible: false },
  ],
  stations: [
    { name: 'Technology', feedIds: ['tech'], sortOrder: 1 },
    { name: 'Design', feedIds: ['design'], sortOrder: 0 },
  ],
  feeds: [
    feed('tech', 'Independent Technology Review', ['Technology']),
    feed('design', 'Design Systems Weekly', ['Design']),
    feed('world', 'World Briefing'),
    feed('cafe', 'Café Notes'),
  ],
};

const actions = [
  { id: 'refresh' as const, title: 'Refresh' },
  { id: 'settings' as const, title: 'Settings' },
];

const titles = (query: string, recent: string[] = []) =>
  rankCommandPaletteEntries(buildCommandPaletteEntries(catalog, actions), query, recent).map((entry) => entry.title);

describe('commandPaletteModel', () => {
  it('builds smart views, actions, stations and feeds, skipping hidden smart views', () => {
    const entries = buildCommandPaletteEntries(catalog, actions);
    expect(entries.map((entry) => entry.key)).toEqual([
      'smart:saved', 'smart:unread', 'smart:all',
      'action:refresh', 'action:settings',
      'station:Design', 'station:Technology',
      'feed:cafe', 'feed:design', 'feed:tech', 'feed:world',
    ]);
    const tech = entries.find((entry) => entry.key === 'feed:tech');
    expect(tech?.kind === 'feed' && tech.stationLabel).toBe('Technology');
  });

  it('ranks exact > prefix > word prefix > substring > fuzzy', () => {
    expect(scoreCommandPaletteTitle('design', 'design')).toBeGreaterThan(scoreCommandPaletteTitle('design systems', 'design'));
    expect(scoreCommandPaletteTitle('design systems', 'des')).toBeGreaterThan(scoreCommandPaletteTitle('web design', 'des'));
    expect(scoreCommandPaletteTitle('web design', 'des')).toBeGreaterThan(scoreCommandPaletteTitle('undesigned', 'des'));
    expect(scoreCommandPaletteTitle('undesigned', 'des')).toBeGreaterThan(scoreCommandPaletteTitle('daily essays', 'des'));
    expect(scoreCommandPaletteTitle('daily essays', 'des')).toBeGreaterThan(0);
    expect(scoreCommandPaletteTitle('world', 'xyz')).toBe(-1);
  });

  it('filters by prefix, fuzzy and accent-folded matches', () => {
    expect(titles('design')).toEqual(['Design', 'Design Systems Weekly']);
    expect(titles('tech')).toEqual(['Technology', 'Independent Technology Review']);
    expect(titles('itr')).toEqual(['Independent Technology Review']);
    expect(titles('cafe')).toEqual(['Café Notes']);
    expect(titles('nothing here')).toEqual([]);
  });

  it('puts recent picks first, most recent on top', () => {
    expect(titles('', ['feed:world', 'station:Technology']).slice(0, 3)).toEqual([
      'World Briefing', 'Technology', 'Saved',
    ]);
    expect(titles('design', ['feed:design'])).toEqual(['Design Systems Weekly', 'Design']);
  });

  it('caps the painted results on a large library', () => {
    const big: CommandPaletteCatalog = {
      ...catalog,
      feeds: Array.from({ length: 600 }, (_, index) => feed(`f${index}`, `Feed ${index}`)),
    };
    const ranked = rankCommandPaletteEntries(buildCommandPaletteEntries(big, actions), 'feed', []);
    expect(ranked).toHaveLength(COMMAND_PALETTE_MAX_RESULTS);
  });

  it('keeps recent picks unique and bounded', () => {
    let recent: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      recent = pushRecentCommandPaletteKey(recent, `feed:${index}`);
    }
    recent = pushRecentCommandPaletteKey(recent, 'feed:20');
    expect(recent).toHaveLength(COMMAND_PALETTE_RECENT_MAX);
    expect(recent[0]).toBe('feed:20');
    expect(new Set(recent).size).toBe(recent.length);
  });

  it('reads stored recents defensively and never past the cap', () => {
    expect(parseRecentCommandPaletteKeys(null)).toEqual([]);
    expect(parseRecentCommandPaletteKeys('not json')).toEqual([]);
    expect(parseRecentCommandPaletteKeys('{"a":1}')).toEqual([]);
    const stored = JSON.stringify([...Array.from({ length: 30 }, (_, i) => `feed:${i}`), 7]);
    expect(parseRecentCommandPaletteKeys(stored)).toHaveLength(COMMAND_PALETTE_RECENT_MAX);
  });
});
