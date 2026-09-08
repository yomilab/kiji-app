import type { Feed } from '@/services/feeds/feedsManager';
import type { SmartViewSettings } from '@/services/settings/types';
import type { Tag } from '@/types/tag';
import {
  isLibraryReorderSuperseded,
  isLibraryReorderSupersededByImport,
} from './libraryReorderQueue';

export const mergePartialReorder = (fullIds: string[], nextVisibleIds: string[]): string[] => {
  const visibleSet = new Set(nextVisibleIds);
  let visibleIndex = 0;
  return fullIds.map((id) => (
    visibleSet.has(id) ? nextVisibleIds[visibleIndex++] ?? id : id
  ));
};

export const mergeSmartViewOrderFromVisible = (
  visibleIds: string[],
  existing: SmartViewSettings[],
): SmartViewSettings[] => {
  const existingSorted = [...existing].sort((left, right) => left.sortOrder - right.sortOrder);
  const visibleSlots = existingSorted
    .map((view, index) => (view.visible ? index : -1))
    .filter((index) => index >= 0);
  const visibleExistingIds = existingSorted.filter((view) => view.visible).map((view) => view.id);
  const visibleExistingSet = new Set<string>(visibleExistingIds);
  const permutedVisible = visibleIds.filter((id) => visibleExistingSet.has(id));
  const permutedSet = new Set(permutedVisible);
  const nextVisible = [
    ...permutedVisible,
    ...visibleExistingIds.filter((id) => !permutedSet.has(id)),
  ];

  const next = existingSorted.map((view) => ({ ...view }));
  visibleSlots.forEach((slot, index) => {
    const id = nextVisible[index];
    if (!id) {
      return;
    }

    next[slot] = {
      id: id as SmartViewSettings['id'],
      visible: true,
      sortOrder: slot,
    };
  });
  return next.map((view, index) => ({ ...view, sortOrder: index }));
};

/**
 * Same-list SUPERSEDED: keep the newer drop's optimistic UI.
 * SUPERSEDED_BY_IMPORT: always rollback — hydrate may already be on the bus while the
 * import lock is still held, so "hydrateFresh" alone must not skip rollback.
 */
export const shouldRollbackLibraryReorder = (
  error: unknown,
  _options?: { hydrateFresh?: boolean },
): boolean => {
  if (isLibraryReorderSuperseded(error) && !isLibraryReorderSupersededByImport(error)) {
    return false;
  }

  if (isLibraryReorderSupersededByImport(error)) {
    return true;
  }

  return true;
};

export const buildFeedToStationsMap = (stations: Tag[]): Map<string, string[]> => {
  const nextMap = new Map<string, string[]>();
  for (const tag of stations) {
    for (const feedId of tag.feedIds) {
      const existing = nextMap.get(feedId) ?? [];
      existing.push(tag.name);
      nextMap.set(feedId, existing);
    }
  }
  return nextMap;
};

export const applyStationTagsToFeeds = (feeds: Feed[], stations: Tag[]): Feed[] => {
  const map = buildFeedToStationsMap(stations);
  return feeds.map((feed) => ({
    ...feed,
    tags: map.get(feed.id) ?? [],
  }));
};

export const applyStationMembershipToStations = (
  stations: Tag[],
  stationName: string,
  feedIds: string[],
): Tag[] => stations.map((station) => (
  station.name === stationName ? { ...station, feedIds } : station
));

export const mergeUnstationedSortIntoFeeds = (
  feeds: Feed[],
  ordered: Array<Pick<Feed, 'id' | 'sortOrder'>>,
): Feed[] => {
  const orderById = new Map(ordered.map((feed) => [feed.id, feed.sortOrder]));
  // Spread only when the rank actually moved — a fresh object for every row would defeat
  // the React.memo identity checks in FeedList and re-render the whole unstationed list.
  return feeds.map((feed) => {
    if (!orderById.has(feed.id)) {
      return feed;
    }

    const sortOrder = orderById.get(feed.id);
    return feed.sortOrder === sortOrder ? feed : { ...feed, sortOrder };
  });
};

export const resolveInsertionDrop = (
  current: { id: string; overId: string; placement: 'before' | 'after' },
): { targetId: string; placement: 'before' | 'after' } => ({
  targetId: current.overId,
  placement: current.placement,
});
