import { DEFAULT_SMART_VIEW_DEFINITIONS, type SmartViewId } from '@/constants';
import type { Feed } from '@/services/feeds/types';
import type { SmartViewSettings } from '@/services/settings/types';
import type { Tag } from '@/types/tag';

/** Rows painted per query; the rest of a 500+ feed library is only scored. */
export const COMMAND_PALETTE_MAX_RESULTS = 50;
/** Recent picks remembered across launches (oldest dropped). */
export const COMMAND_PALETTE_RECENT_MAX = 10;
export const COMMAND_PALETTE_RECENT_STORAGE_KEY = 'command-palette-recent';

export type CommandPaletteActionId =
  | 'refresh'
  | 'add-feed'
  | 'manage-feeds'
  | 'settings'
  | 'toggle-reader-mode'
  | 'theme-auto'
  | 'theme-light'
  | 'theme-dark';

export type CommandPaletteFeed = Pick<
  Feed,
  'id' | 'title' | 'url' | 'tags' | 'emoji' | 'favicon' | 'faviconStored' | 'faviconHasTransparency'
>;

interface EntryBase {
  /** Stable id, also the recent-picks key. */
  key: string;
  title: string;
  /** Lowercased, accent-folded title used for matching. */
  searchTitle: string;
}

export type CommandPaletteEntry =
  | (EntryBase & { kind: 'smart'; viewId: SmartViewId; emoji?: string })
  | (EntryBase & { kind: 'station'; name: string; feedIds: string[]; emoji?: string })
  | (EntryBase & { kind: 'feed'; feed: CommandPaletteFeed; stationLabel: string | null })
  | (EntryBase & { kind: 'action'; actionId: CommandPaletteActionId; shortcut?: string });

export interface CommandPaletteCatalog {
  feeds: CommandPaletteFeed[];
  stations: Pick<Tag, 'name' | 'feedIds' | 'emoji' | 'sortOrder'>[];
  smartViews: Pick<SmartViewSettings, 'id' | 'visible'>[];
  smartViewEmojis?: Record<string, string>;
}

export interface CommandPaletteActionSpec {
  id: CommandPaletteActionId;
  title: string;
  shortcut?: string;
}

export const normalizeSearchText = (value: string): string =>
  value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const KIND_ORDER: Record<CommandPaletteEntry['kind'], number> = {
  smart: 0,
  action: 1,
  station: 2,
  feed: 3,
};

/**
 * Library catalog → palette rows. Order here is the empty-query order:
 * smart views, actions, stations (sidebar order), then feeds A–Z.
 */
export const buildCommandPaletteEntries = (
  catalog: CommandPaletteCatalog,
  actions: readonly CommandPaletteActionSpec[],
): CommandPaletteEntry[] => {
  const entries: CommandPaletteEntry[] = [];
  const smartLabels = new Map(DEFAULT_SMART_VIEW_DEFINITIONS.map((view) => [view.id, view.label]));

  for (const view of catalog.smartViews) {
    if (!view.visible) continue;
    const title = smartLabels.get(view.id) ?? view.id;
    entries.push({
      kind: 'smart',
      key: `smart:${view.id}`,
      title,
      searchTitle: normalizeSearchText(title),
      viewId: view.id,
      emoji: catalog.smartViewEmojis?.[view.id],
    });
  }

  for (const action of actions) {
    entries.push({
      kind: 'action',
      key: `action:${action.id}`,
      title: action.title,
      searchTitle: normalizeSearchText(action.title),
      actionId: action.id,
      shortcut: action.shortcut,
    });
  }

  const stations = [...catalog.stations].sort(
    (a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER),
  );
  for (const station of stations) {
    entries.push({
      kind: 'station',
      key: `station:${station.name}`,
      title: station.name,
      searchTitle: normalizeSearchText(station.name),
      name: station.name,
      feedIds: station.feedIds,
      emoji: station.emoji,
    });
  }

  const feeds = [...catalog.feeds].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  for (const feed of feeds) {
    entries.push({
      kind: 'feed',
      key: `feed:${feed.id}`,
      title: feed.title,
      searchTitle: normalizeSearchText(feed.title),
      feed,
      stationLabel: feed.tags && feed.tags.length > 0 ? feed.tags.join(', ') : null,
    });
  }

  return entries;
};

const isWordBoundary = (text: string, index: number): boolean =>
  index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1]);

/**
 * Higher is better; -1 means no match. Exact > prefix > word prefix > substring > fuzzy
 * (query letters in order, tighter spans score higher).
 */
export const scoreCommandPaletteTitle = (searchTitle: string, query: string): number => {
  if (query.length === 0) return 0;
  if (searchTitle === query) return 1000;
  if (searchTitle.startsWith(query)) return 900;

  let index = searchTitle.indexOf(query);
  let firstIndex = index;
  while (index > 0) {
    if (isWordBoundary(searchTitle, index)) return 700;
    index = searchTitle.indexOf(query, index + 1);
  }
  if (firstIndex >= 0) return 500 - Math.min(firstIndex, 100);

  const compactQuery = query.replace(/\s+/g, '');
  if (compactQuery.length === 0) return -1;
  let cursor = 0;
  let start = -1;
  firstIndex = -1;
  for (let i = 0; i < searchTitle.length && cursor < compactQuery.length; i += 1) {
    if (searchTitle[i] === compactQuery[cursor]) {
      if (start < 0) start = i;
      cursor += 1;
      firstIndex = i;
    }
  }
  if (cursor < compactQuery.length) return -1;
  const span = firstIndex - start + 1;
  return Math.max(1, 200 - (span - compactQuery.length) - start);
};

/**
 * Matching rows, recent picks first (most recent on top), then by match quality,
 * then kind and catalog order. Capped so a big library never paints hundreds of rows.
 */
export const rankCommandPaletteEntries = (
  entries: readonly CommandPaletteEntry[],
  rawQuery: string,
  recentKeys: readonly string[],
  limit: number = COMMAND_PALETTE_MAX_RESULTS,
): CommandPaletteEntry[] => {
  const query = normalizeSearchText(rawQuery);
  const recentRank = new Map(recentKeys.map((key, index) => [key, index]));
  const scored: Array<{ entry: CommandPaletteEntry; score: number; recent: number; order: number }> = [];

  for (let order = 0; order < entries.length; order += 1) {
    const entry = entries[order];
    const score = scoreCommandPaletteTitle(entry.searchTitle, query);
    if (score < 0) continue;
    scored.push({
      entry,
      score,
      recent: recentRank.get(entry.key) ?? Number.MAX_SAFE_INTEGER,
      order,
    });
  }

  scored.sort((a, b) => (
    a.recent - b.recent
    || b.score - a.score
    || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind]
    || a.order - b.order
  ));

  return scored.slice(0, limit).map((item) => item.entry);
};

/** Move `key` to the front; never longer than `max`. */
export const pushRecentCommandPaletteKey = (
  recentKeys: readonly string[],
  key: string,
  max: number = COMMAND_PALETTE_RECENT_MAX,
): string[] => [key, ...recentKeys.filter((existing) => existing !== key)].slice(0, max);

export const parseRecentCommandPaletteKeys = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .slice(0, COMMAND_PALETTE_RECENT_MAX);
  } catch {
    return [];
  }
};
