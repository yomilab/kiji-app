import * as feedStore from '@/stores/feedStore';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

let cache: Map<string, string[]> | null = null;
let subscribed = false;

const ensureInvalidationSubscription = (): void => {
  if (subscribed) {
    return;
  }
  subscribed = true;
  feedLibraryMutationBus.subscribe(() => {
    cache = null;
  });
};

/** Merge sidebar or session hints without dropping other cached stations. */
export function seedTagFeedIdsCache(entries: Iterable<[string, string[]]>): void {
  ensureInvalidationSubscription();
  if (!cache) {
    cache = new Map();
  }
  for (const [tagName, feedIds] of entries) {
    cache.set(tagName, feedIds);
  }
}

export function getCachedFeedIdsForTag(tagName: string): string[] | null {
  return cache?.get(tagName) ?? null;
}

/**
 * Cached tag → feed id map for station-switch focus and refresh scheduling.
 * Invalidated on feed-library mutations so rapid hops avoid per-switch IPC.
 */
export async function ensureTagFeedIdsCache(): Promise<Map<string, string[]>> {
  ensureInvalidationSubscription();
  if (cache !== null) {
    return cache;
  }

  const rows = await feedStore.tags.listWithFeedIds();
  cache = new Map(rows.map((row) => [row.name, row.feedIds ?? []]));
  return cache;
}

export async function resolveFeedIdsForTag(tagName: string): Promise<string[]> {
  const cached = getCachedFeedIdsForTag(tagName);
  if (cached) {
    return cached;
  }

  await ensureTagFeedIdsCache();
  const fromBulk = getCachedFeedIdsForTag(tagName);
  if (fromBulk) {
    return fromBulk;
  }

  const feedIds = await feedStore.tags.listFeedIds({ tagName });
  if (!cache) {
    cache = new Map();
  }
  cache.set(tagName, feedIds);
  return feedIds;
}

/** Test-only: drop cached tag feed ids so mocks can vary per case. */
export function clearTagFeedIdsCacheForTests(): void {
  cache = null;
}
