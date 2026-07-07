import type { Tag } from '@/types/tag';

export interface StationLibraryPatch {
  previousName: string;
  station: Pick<Tag, 'name' | 'emoji' | 'feedIds' | 'createdAt' | 'sortOrder'>;
}

const compareTagsByOrderThenName = (left: Tag, right: Tag): number => {
  const sortOrderDiff = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (sortOrderDiff !== 0) {
    return sortOrderDiff;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
};

/**
 * Apply one feed-library station patch to the sidebar station list.
 * Idempotent for renames: match by previous or current name and dedupe.
 */
export function applyStationLibraryPatchToTags(
  tags: Tag[],
  patch: StationLibraryPatch,
): Tag[] {
  let hasPatchedStation = false;
  const nextTags = tags.map((tag) => {
    if (
      tag.name !== patch.previousName
      && tag.name !== patch.station.name
    ) {
      return tag;
    }

    hasPatchedStation = true;
    return {
      ...tag,
      ...patch.station,
    };
  });

  if (hasPatchedStation) {
    const seenNames = new Set<string>();
    return nextTags.filter((tag) => {
      if (seenNames.has(tag.name)) {
        return false;
      }

      seenNames.add(tag.name);
      return true;
    });
  }

  return [...tags, {
    ...patch.station,
    color: undefined,
  }].sort(compareTagsByOrderThenName);
}

export interface ExpandedStationPatchResult {
  expandedStations: Set<string>;
  shouldRefreshExpandedFeeds: boolean;
}

/**
 * Migrate expand/collapse keys after a station rename.
 * Returns whether expanded feed rows should refresh their cache.
 */
export function applyStationLibraryPatchToExpandedStations(
  expandedStations: Set<string>,
  patch: StationLibraryPatch,
): ExpandedStationPatchResult {
  const wasExpandedUnderPreviousName = expandedStations.has(patch.previousName);
  const isExpandedUnderNextName = expandedStations.has(patch.station.name);

  if (patch.previousName === patch.station.name) {
    return {
      expandedStations,
      shouldRefreshExpandedFeeds: isExpandedUnderNextName,
    };
  }

  if (!wasExpandedUnderPreviousName) {
    return {
      expandedStations,
      shouldRefreshExpandedFeeds: isExpandedUnderNextName,
    };
  }

  const next = new Set(expandedStations);
  next.delete(patch.previousName);
  next.add(patch.station.name);

  return {
    expandedStations: next,
    shouldRefreshExpandedFeeds: true,
  };
}
