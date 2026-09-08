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
  if (cache.size <= TAG_MANAGER_FEED_CACHE_MAX_ENTRIES) {
    return cache;
  }

  // One pass, oldest first (Map iterates in insertion order). Restarting the scan per
  // eviction would be O(pinned x evictions) on a large expanded station.
  const victims = new Set<string>();
  let remaining = cache.size;
  for (const key of cache.keys()) {
    if (remaining <= TAG_MANAGER_FEED_CACHE_MAX_ENTRIES) {
      break;
    }
    if (pinnedIds.has(key)) {
      continue;
    }
    victims.add(key);
    remaining -= 1;
  }

  // What survives is either <= MAX or only pinned ids, so the retained size can never
  // exceed max(MAX, pinnedIds.size) — expanded paint is the only way past the soft cap.
  if (victims.size === 0) {
    return cache;
  }

  const next = new Map(cache);
  for (const key of victims) {
    next.delete(key);
  }
  return next;
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
