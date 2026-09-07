import type { Feed } from '@/services/feeds/feedsManager';
import { seedArticleFeedMetadataFromFeed } from '@/services/articles/articleListMemory';
import type { Tag } from '@/types/tag';

/** Soft LRU target for collapsed / non-painted station feeds. */
export const TAG_MANAGER_FEED_CACHE_MAX_ENTRIES = 200;

/**
 * Feed ids that must stay resident for currently expanded station paint.
 * Temporary Set — callers must not retain it across renders.
 */
export const collectPinnedFeedIds = (
  tags: Tag[],
  expanded: ReadonlySet<string>,
  extra: Iterable<string> = [],
): Set<string> => {
  const pinned = new Set<string>();
  for (const feedId of extra) {
    pinned.add(feedId);
  }
  for (const stationName of expanded) {
    const tag = tags.find((entry) => entry.name === stationName);
    if (!tag) {
      continue;
    }
    for (const feedId of tag.feedIds) {
      pinned.add(feedId);
    }
  }
  return pinned;
};

/**
 * Drop non-pinned entries until size <= MAX.
 * If expanded paint alone needs more than MAX, keep only pinned ids (hard ceiling =
 * max(MAX, pinned.size)) — never retain collapsed/non-painted rows above MAX.
 */
export const trimTagManagerFeedCache = (
  cache: Map<string, Feed>,
  pinnedIds: ReadonlySet<string>,
): Map<string, Feed> => {
  const ceiling = Math.max(TAG_MANAGER_FEED_CACHE_MAX_ENTRIES, pinnedIds.size);
  if (cache.size <= TAG_MANAGER_FEED_CACHE_MAX_ENTRIES) {
    return cache;
  }

  let next: Map<string, Feed> | null = null;
  const working = (): Map<string, Feed> => {
    if (!next) {
      next = new Map(cache);
    }
    return next;
  };

  while (working().size > TAG_MANAGER_FEED_CACHE_MAX_ENTRIES) {
    let evicted = false;
    for (const key of working().keys()) {
      if (pinnedIds.has(key)) {
        continue;
      }
      working().delete(key);
      evicted = true;
      break;
    }
    if (!evicted) {
      break;
    }
  }

  // Safety: never exceed the expanded-paint ceiling.
  while (working().size > ceiling) {
    const oldestKey = working().keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    working().delete(oldestKey);
  }

  return next ?? cache;
};

/** Batch insert then trim once — avoids copying the Map per feed. */
export const rememberFeedsInCache = (
  prev: Map<string, Feed>,
  feeds: Feed[],
  pinnedIds: ReadonlySet<string>,
): Map<string, Feed> => {
  if (feeds.length === 0) {
    return trimTagManagerFeedCache(prev, pinnedIds);
  }

  const next = new Map(prev);
  for (const feed of feeds) {
    next.delete(feed.id);
    next.set(feed.id, feed);
    seedArticleFeedMetadataFromFeed(feed);
  }
  return trimTagManagerFeedCache(next, pinnedIds);
};
