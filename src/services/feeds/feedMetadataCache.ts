import * as feedStore from '@/stores/feedStore';
import type { Feed } from '@/services/feeds/types';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

let cachedFeeds: Feed[] | null = null;
let cacheRevision = 0;
let inFlight: Promise<Feed[]> | null = null;
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
 * Slim catalog for last-sync, station eligibility, and nested station rows.
 * Never uses feeds_list (favicon blobs). One in-flight IPC; drop the result
 * if a library mutation landed while it was in flight.
 */
export async function getAllFeedMetadataCached(): Promise<Feed[]> {
  ensureInvalidationSubscription();
  if (cachedFeeds !== null) {
    return cachedFeeds;
  }
  if (inFlight) {
    return inFlight;
  }

  const revision = cacheRevision;
  const pending: Promise<Feed[]> = feedStore.listSidebarSnapshot().then(
    (snapshot) => {
      if (inFlight === pending) {
        inFlight = null;
      }
      if (revision !== cacheRevision) {
        return getAllFeedMetadataCached();
      }
      cachedFeeds = snapshot.feeds;
      return cachedFeeds;
    },
    (error: unknown) => {
      if (inFlight === pending) {
        inFlight = null;
      }
      throw error;
    },
  );
  inFlight = pending;
  return pending;
}

export function getFeedMetadataCacheRevision(): number {
  return cacheRevision;
}

/** Test-only: drop cached metadata so mocks can vary per case. */
export function clearFeedMetadataCacheForTests(): void {
  cachedFeeds = null;
  inFlight = null;
}
