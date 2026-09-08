import { settingsManager } from '@/services/settings';
import type { SmartViewSettings } from '@/services/settings/types';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { feedsManager, type Feed } from './feedsManager';
import { mergePartialReorder, mergeSmartViewOrderFromVisible } from './libraryRank';
import {
  enqueueLibraryReorder,
  isLibraryReorderSuperseded,
  isLibraryReorderSupersededByImport,
  waitForLibraryReorderIdle,
  withNonLibraryImportLock,
} from './libraryReorderQueue';

export { mergeSmartViewOrderFromVisible };

export const persistSmartViewSettings = async (nextSmartViews: SmartViewSettings[]): Promise<void> => {
  await enqueueLibraryReorder('library', async ({ isCurrent }) => {
    await settingsManager.setSmartViews(nextSmartViews);
    if (!isCurrent()) {
      return;
    }
    feedLibraryMutationBus.publishSmartViewsPatched(nextSmartViews);
  });
};

export const persistSmartViewOrder = async (visibleIds: string[]): Promise<void> => {
  await enqueueLibraryReorder('library', async ({ isCurrent }) => {
    const existing = await settingsManager.getSmartViews();
    const nextSmartViews = mergeSmartViewOrderFromVisible(visibleIds, existing);
    await settingsManager.setSmartViews(nextSmartViews);
    if (!isCurrent()) {
      return;
    }
    feedLibraryMutationBus.publishSmartViewsPatched(nextSmartViews);
  });
};

export const persistStationOrder = async (stationNames: string[]): Promise<void> => {
  await enqueueLibraryReorder('stations', async ({ isCurrent }) => {
    await tagsManager.reorderStations(stationNames);
    if (!isCurrent()) {
      return;
    }
    feedLibraryMutationBus.publishStationsReordered(
      stationNames.map((name, sortOrder) => ({ name, sortOrder })),
    );
  });
};

export const persistNestedMembershipOrder = async (
  stationName: string,
  feedIds: string[],
): Promise<void> => {
  await enqueueLibraryReorder(`nested:${stationName}`, async ({ isCurrent }) => {
    const allTags = await tagsManager.getAllTags();
    const currentIds = allTags.find((tag) => tag.name === stationName)?.feedIds;
    const nextIds = currentIds && currentIds.length > 0
      ? mergePartialReorder(currentIds, feedIds)
      : feedIds;
    await tagsManager.reorderMembership(stationName, nextIds);
    if (!isCurrent()) {
      return;
    }
    feedLibraryMutationBus.publishStationMembershipReordered({
      stationName,
      feedIds: nextIds,
    });
  });
};

export const persistUnstationedOrder = async (feedIds: string[]): Promise<void> => {
  await enqueueLibraryReorder('unstationed', async ({ isCurrent }) => {
    await feedsManager.reorderUnstationed(feedIds);
    if (!isCurrent()) {
      return;
    }
    feedLibraryMutationBus.publishUnstationedReordered(
      feedIds.map((id, sortOrder) => ({ id, sortOrder })),
    );
  });
};

export const appendPromotedFeedsToUnstationed = async (feedIds: string[]): Promise<void> => {
  if (feedIds.length === 0) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForLibraryReorderIdle(['unstationed']);
    try {
      await enqueueLibraryReorder('unstationed', async ({ isCurrent }) => {
        const allFeeds = await feedsManager.getAllFeeds();
        const untagged = allFeeds.filter((feed) => !feed.tags || feed.tags.length === 0);
        const existingIds = untagged.map((feed) => feed.id);
        const existingSet = new Set(existingIds);
        const nextIds = [
          ...existingIds,
          ...feedIds.filter((feedId) => !existingSet.has(feedId)),
        ];
        if (nextIds.length === existingIds.length) {
          return;
        }

        await feedsManager.reorderUnstationed(nextIds);
        if (!isCurrent()) {
          return;
        }
        feedLibraryMutationBus.publishUnstationedReordered(
          nextIds.map((id, sortOrder) => ({ id, sortOrder })),
        );
      });
      return;
    } catch (error) {
      if (isLibraryReorderSupersededByImport(error)) {
        return;
      }
      if (!isLibraryReorderSuperseded(error) || attempt === 2) {
        throw error;
      }
    }
  }
};

export const nextUnstationedSortOrder = (feeds: Feed[]): number => {
  const untagged = feeds.filter((feed) => !feed.tags || feed.tags.length === 0);
  if (untagged.length === 0) {
    return 0;
  }

  return Math.max(...untagged.map((feed) => feed.sortOrder ?? 0)) + 1;
};

export const hydrateLibraryAfterImport = async (): Promise<void> => {
  await withNonLibraryImportLock(async () => {
    const [allFeeds, allTags] = await Promise.all([
      feedsManager.getAllFeeds(),
      tagsManager.getAllTags(),
    ]);
    const unstationed = allFeeds.filter((feed) => !feed.tags || feed.tags.length === 0);

    feedLibraryMutationBus.publishLibraryHydrated({
      stations: allTags,
      unstationed,
    });
  });
};
