import { DEFAULT_SMART_VIEW_DEFINITIONS, type SmartViewId } from '@/constants';
import type { Feed } from '@/services/feeds/feedsManager';
import type { SmartViewSettings } from '@/services/settings/types';
import type { Tag } from '@/types/tag';
import type { FeedLibraryMutationMessage } from '@/services/ui/feedLibraryMutationBus';

/**
 * Pure helpers for the Manage Feeds window: list ordering, filters, plain-language status,
 * and the station delete plan. Kept free of React and IPC so they are unit-tested directly.
 */

export type ManageFeedsTab = 'feeds' | 'stations' | 'library' | 'filters' | 'import-export';

export type FeedSortKey = 'recent' | 'name' | 'articles' | 'status';
export type FeedFilterKey = 'all' | 'attention' | 'unstationed';

export interface LibraryItemRow {
  id: SmartViewId;
  label: string;
  visible: boolean;
  sortOrder: number;
}

export type FeedHealth = 'ok' | 'failing' | 'new';

export interface FeedStatus {
  health: FeedHealth;
  /** Short status for the row ("Updated 5 min ago"). */
  label: string;
  /** Longer explanation for tooltips and the editor. */
  detail: string;
}

const compareText = (left: string, right: string): number => (
  left.localeCompare(right, undefined, { sensitivity: 'base' })
);

const timeOf = (value?: Date | string): number => {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const feedFailureCount = (feed: Pick<Feed, 'consecutiveFailures'>): number => (
  Math.max(0, feed.consecutiveFailures ?? 0)
);

export const needsAttention = (feed: Pick<Feed, 'consecutiveFailures'>): boolean => feedFailureCount(feed) > 0;

/** "example.com" from a feed address; falls back to the raw text. */
export const feedSiteLabel = (url: string): string => {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
};

export const formatRelativeTime = (value: Date | string | undefined, now: number = Date.now()): string | null => {
  const time = timeOf(value);
  if (!time) return null;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  const date = new Date(time);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatAddedDate = (value?: Date | string): string => {
  const time = timeOf(value);
  if (!time) return '';
  return new Date(time).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const describeFeedStatus = (
  feed: Pick<Feed, 'consecutiveFailures' | 'lastFetched' | 'lastFailedFetchAt'>,
  now: number = Date.now(),
): FeedStatus => {
  const failures = feedFailureCount(feed);
  const updated = formatRelativeTime(feed.lastFetched, now);
  if (failures > 0) {
    const tried = formatRelativeTime(feed.lastFailedFetchAt, now);
    const times = failures === 1 ? 'once' : `${failures} times in a row`;
    const lastGood = updated ? ` Last updated ${updated}.` : '';
    return {
      health: 'failing',
      label: 'Can’t update',
      detail: `KiJi couldn’t update this feed ${times}${tried ? `, most recently ${tried}` : ''}.${lastGood} Check the address, or try again later.`,
    };
  }
  if (!updated) {
    return { health: 'new', label: 'Not updated yet', detail: 'This feed hasn’t been updated yet.' };
  }
  return { health: 'ok', label: `Updated ${updated}`, detail: `Last updated ${updated}.` };
};

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
);

export const matchesFeedSearch = (feed: Pick<Feed, 'title' | 'url'>, stationNames: string[], query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${feed.title}\n${feed.url}\n${stationNames.join('\n')}`.toLocaleLowerCase().includes(needle);
};

export const filterFeeds = (
  feeds: Feed[],
  filter: FeedFilterKey,
  query: string,
  stationsByFeedId: ReadonlyMap<string, string[]>,
): Feed[] => feeds.filter((feed) => {
  const stationNames = stationsByFeedId.get(feed.id) ?? [];
  if (filter === 'attention' && !needsAttention(feed)) return false;
  if (filter === 'unstationed' && stationNames.length > 0) return false;
  return matchesFeedSearch(feed, stationNames, query);
});

export const sortFeeds = (feeds: Feed[], sort: FeedSortKey): Feed[] => {
  const next = [...feeds];
  next.sort((left, right) => {
    let comparison = 0;
    switch (sort) {
      case 'recent':
        comparison = timeOf(right.createdAt) - timeOf(left.createdAt);
        break;
      case 'articles':
        comparison = (right.articleCount ?? 0) - (left.articleCount ?? 0);
        break;
      case 'status':
        comparison = feedFailureCount(right) - feedFailureCount(left);
        break;
      case 'name':
      default:
        comparison = 0;
    }
    return comparison !== 0 ? comparison : compareText(left.title, right.title);
  });
  return next;
};

export const buildStationsByFeedId = (stations: Tag[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const station of stations) {
    for (const feedId of station.feedIds) {
      const names = map.get(feedId);
      if (names) {
        names.push(station.name);
      } else {
        map.set(feedId, [station.name]);
      }
    }
  }
  return map;
};

/** Stations in sidebar order: explicit order first, then newest first. */
export const sortStations = (stations: Tag[]): Tag[] => [...stations].sort((left, right) => {
  const orderDiff = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (orderDiff !== 0) return orderDiff;
  const createdDiff = timeOf(right.createdAt) - timeOf(left.createdAt);
  if (createdDiff !== 0) return createdDiff;
  return compareText(left.name, right.name);
});

export const buildLibraryItems = (smartViews: SmartViewSettings[]): LibraryItemRow[] => {
  const byId = new Map(smartViews.map((view) => [view.id, view]));
  return DEFAULT_SMART_VIEW_DEFINITIONS.map((definition, index) => {
    const existing = byId.get(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      visible: existing?.visible ?? true,
      sortOrder: existing?.sortOrder ?? index,
    };
  }).sort((left, right) => left.sortOrder - right.sortOrder);
};

export const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= items.length
    || toIndex >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

/** Move `draggedId` next to `targetId` (drop before or after it). */
export const reorderById = <T,>(
  items: T[],
  draggedId: string,
  targetId: string,
  placement: 'before' | 'after',
  getId: (item: T) => string,
): T[] => {
  const from = items.findIndex((item) => getId(item) === draggedId);
  const target = items.findIndex((item) => getId(item) === targetId);
  if (from < 0 || target < 0 || from === target) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  const adjustedTarget = from < target ? target - 1 : target;
  next.splice(placement === 'after' ? adjustedTarget + 1 : adjustedTarget, 0, moved);
  return next;
};

export const nextStationName = (stations: Pick<Tag, 'name'>[]): string => {
  const base = 'New Station';
  const taken = new Set(stations.map((station) => station.name.toLocaleLowerCase()));
  if (!taken.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
};

export type StationNameProblem = 'empty' | 'taken' | null;

export const validateStationName = (
  name: string,
  stations: Pick<Tag, 'name'>[],
  currentName?: string,
): StationNameProblem => {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';
  const lower = trimmed.toLocaleLowerCase();
  const clash = stations.some((station) => (
    station.name !== currentName && station.name.toLocaleLowerCase() === lower
  ));
  return clash ? 'taken' : null;
};

export interface StationDeletePlan {
  /** Feeds only in this station: removed with their articles. */
  feedsToDelete: string[];
  /** Feeds also in other stations: only unlinked. */
  feedsToUnlink: string[];
}

export const planStationDeleteWithFeeds = (
  station: Pick<Tag, 'name' | 'feedIds'>,
  stationsByFeedId: ReadonlyMap<string, string[]>,
): StationDeletePlan => {
  const feedsToDelete: string[] = [];
  const feedsToUnlink: string[] = [];
  for (const feedId of station.feedIds) {
    const names = stationsByFeedId.get(feedId) ?? [station.name];
    if (names.some((name) => name !== station.name)) {
      feedsToUnlink.push(feedId);
    } else {
      feedsToDelete.push(feedId);
    }
  }
  return { feedsToDelete, feedsToUnlink };
};

/** Apply membership changes to stations in one pass (bulk add/remove, station feed picker). */
export const applyMembership = (
  stations: Tag[],
  stationName: string,
  feedIds: string[],
): Tag[] => stations.map((station) => (
  station.name === stationName ? { ...station, feedIds } : station
));

export interface ManageFeedsLibrary {
  feeds: Feed[];
  stations: Tag[];
  libraryItems: LibraryItemRow[];
}

export const EMPTY_LIBRARY: ManageFeedsLibrary = { feeds: [], stations: [], libraryItems: [] };

const withoutFeedId = (station: Tag, feedId: string): Tag => (
  station.feedIds.includes(feedId)
    ? { ...station, feedIds: station.feedIds.filter((id) => id !== feedId) }
    : station
);

/**
 * Apply one library change (made here or relayed from the main window) to the window's lists.
 * Returns `reload: true` for whole-library rewrites (OPML import, Clear Feeds); those reload
 * from SQLite instead of merging partial hydrate payloads.
 */
export const applyLibraryMessage = (
  library: ManageFeedsLibrary,
  message: FeedLibraryMutationMessage,
): { library: ManageFeedsLibrary; reload: boolean } => {
  switch (message.kind) {
    case 'feedPatched': {
      let changed = false;
      const feeds = library.feeds.map((feed) => {
        if (feed.id !== message.feedId) return feed;
        changed = true;
        return { ...feed, ...message.changes };
      });
      return { library: changed ? { ...library, feeds } : library, reload: false };
    }
    case 'feedsCountsUpdated': {
      const counts = new Map(message.feeds.map((entry) => [entry.feedId, entry]));
      let changed = false;
      const feeds = library.feeds.map((feed) => {
        const entry = counts.get(feed.id);
        if (!entry || (entry.articleCount === feed.articleCount && entry.unreadCount === feed.unreadCount)) {
          return feed;
        }
        changed = true;
        return { ...feed, articleCount: entry.articleCount, unreadCount: entry.unreadCount };
      });
      return { library: changed ? { ...library, feeds } : library, reload: false };
    }
    case 'feedDeleted': {
      if (!library.feeds.some((feed) => feed.id === message.feedId)) {
        return { library, reload: false };
      }
      return {
        library: {
          ...library,
          feeds: library.feeds.filter((feed) => feed.id !== message.feedId),
          stations: library.stations.map((station) => withoutFeedId(station, message.feedId)),
        },
        reload: false,
      };
    }
    case 'feedsAdded': {
      const known = new Set(library.feeds.map((feed) => feed.id));
      const added = message.feeds.filter((feed) => !known.has(feed.id));
      if (added.length === 0) return { library, reload: false };
      const stations = library.stations.map((station) => {
        const joined = added
          .filter((feed) => feed.tags?.includes(station.name) && !station.feedIds.includes(feed.id))
          .map((feed) => feed.id);
        return joined.length > 0 ? { ...station, feedIds: [...station.feedIds, ...joined] } : station;
      });
      return { library: { ...library, feeds: [...library.feeds, ...added], stations }, reload: false };
    }
    case 'stationPatched': {
      const { previousName, station: patch } = message;
      const index = library.stations.findIndex((station) => (
        station.name === previousName || station.name === patch.name
      ));
      let stations: Tag[];
      if (index < 0) {
        stations = sortStations([
          ...library.stations,
          { ...patch, feedIds: patch.feedIds ?? [] },
        ]);
      } else {
        const current = library.stations[index];
        const merged: Tag = {
          ...current,
          ...patch,
          feedIds: patch.feedIds ?? current.feedIds,
        };
        stations = library.stations
          .map((station, stationIndex) => (stationIndex === index ? merged : station))
          .filter((station, stationIndex) => stationIndex === index || station.name !== merged.name);
      }
      const renamed = previousName !== patch.name;
      const feeds = renamed
        ? library.feeds.map((feed) => (
          feed.tags?.includes(previousName)
            ? { ...feed, tags: feed.tags.map((name) => (name === previousName ? patch.name : name)) }
            : feed
        ))
        : library.feeds;
      return { library: { ...library, stations, feeds }, reload: false };
    }
    case 'stationDeleted': {
      if (!library.stations.some((station) => station.name === message.stationName)) {
        return { library, reload: false };
      }
      return {
        library: {
          ...library,
          stations: library.stations.filter((station) => station.name !== message.stationName),
          feeds: library.feeds.map((feed) => (
            feed.tags?.includes(message.stationName)
              ? { ...feed, tags: feed.tags.filter((name) => name !== message.stationName) }
              : feed
          )),
        },
        reload: false,
      };
    }
    case 'stationsReordered': {
      const order = new Map(message.stations.map((station, index) => [station.name, station.sortOrder ?? index]));
      const stations = library.stations
        .map((station) => (order.has(station.name) ? { ...station, sortOrder: order.get(station.name) } : station));
      return { library: { ...library, stations: sortStations(stations) }, reload: false };
    }
    case 'stationMembershipReordered':
      return {
        library: { ...library, stations: applyMembership(library.stations, message.stationName, message.feedIds) },
        reload: false,
      };
    case 'smartViewsPatched':
      return { library: { ...library, libraryItems: buildLibraryItems(message.smartViews) }, reload: false };
    case 'unstationedReordered':
      return { library, reload: false };
    case 'stationsHydrated':
    case 'unstationedHydrated':
    case 'libraryHydrated':
      return { library, reload: true };
    default:
      return { library, reload: false };
  }
};
