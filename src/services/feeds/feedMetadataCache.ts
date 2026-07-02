import * as feedStore from '@/stores/feedStore';
import type { Feed } from '@/services/feeds/types';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

let cachedFeeds: Feed[] | null = null;
let cacheRevision = 0;
let subscribed = false;

const ensureInvalidationSubscription = (): void => {
  if (subscribed) {
    return;
  }
  subscribed = true;
  feedLibraryMutationBus.subscribe(() => {
    cachedFeeds = null;
    cacheRevision += 1;
  });
};

/**
 * Cached view of all feed metadata for station-switch eligibility checks.
 * Invalidated on any feed-library mutation so rapid station hops avoid a
 * full-library IPC on every `eligible-feeds-resolved` trace stage.
 */
export async function getAllFeedMetadataCached(): Promise<Feed[]> {
  ensureInvalidationSubscription();
  if (cachedFeeds !== null) {
    return cachedFeeds;
  }
  cachedFeeds = await feedStore.getAll();
  return cachedFeeds;
}

export function getFeedMetadataCacheRevision(): number {
  return cacheRevision;
}

/** Test-only: drop cached metadata so mocks can vary per case. */
export function clearFeedMetadataCacheForTests(): void {
  cachedFeeds = null;
}
