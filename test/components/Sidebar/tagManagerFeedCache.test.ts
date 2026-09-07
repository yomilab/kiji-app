import { describe, expect, it } from 'vitest';
import type { Feed } from '@/services/feeds/feedsManager';
import type { Tag } from '@/types/tag';
import {
  TAG_MANAGER_FEED_CACHE_MAX_ENTRIES,
  collectPinnedFeedIds,
  rememberFeedsInCache,
  trimTagManagerFeedCache,
} from '@/components/Sidebar/tagManagerFeedCache';

const feed = (id: string): Feed => ({
  id,
  title: id,
  url: `https://${id}.example/feed`,
  tags: [],
});

describe('tagManagerFeedCache', () => {
  it('collects pinned ids only from expanded stations (temporary set)', () => {
    const tags: Tag[] = [
      { name: 'Daily', feedIds: ['a', 'b'], createdAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Tech', feedIds: ['c'], createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const pinned = collectPinnedFeedIds(tags, new Set(['Daily']), ['extra']);
    expect([...pinned].sort()).toEqual(['a', 'b', 'extra']);
  });

  it('evicts collapsed feeds back down to the soft LRU cap', () => {
    const cache = new Map<string, Feed>();
    for (let index = 0; index < TAG_MANAGER_FEED_CACHE_MAX_ENTRIES + 40; index += 1) {
      cache.set(`f${index}`, feed(`f${index}`));
    }
    const pinned = new Set(['f0', 'f1']);
    const trimmed = trimTagManagerFeedCache(cache, pinned);
    expect(trimmed.size).toBe(TAG_MANAGER_FEED_CACHE_MAX_ENTRIES);
    expect(trimmed.has('f0')).toBe(true);
    expect(trimmed.has('f1')).toBe(true);
  });

  it('may exceed the soft cap only by currently pinned expanded paint', () => {
    const pinned = new Set<string>();
    for (let index = 0; index < TAG_MANAGER_FEED_CACHE_MAX_ENTRIES + 25; index += 1) {
      pinned.add(`p${index}`);
    }
    const cache = new Map<string, Feed>();
    for (const id of pinned) {
      cache.set(id, feed(id));
    }
    for (let index = 0; index < 30; index += 1) {
      cache.set(`old${index}`, feed(`old${index}`));
    }

    const trimmed = trimTagManagerFeedCache(cache, pinned);
    expect(trimmed.size).toBe(pinned.size);
    for (const id of pinned) {
      expect(trimmed.has(id)).toBe(true);
    }
    expect(trimmed.has('old0')).toBe(false);
  });

  it('batches inserts and trims once instead of copying the map per feed', () => {
    const prev = new Map<string, Feed>();
    for (let index = 0; index < TAG_MANAGER_FEED_CACHE_MAX_ENTRIES; index += 1) {
      prev.set(`old${index}`, feed(`old${index}`));
    }
    const next = rememberFeedsInCache(
      prev,
      [feed('new-a'), feed('new-b')],
      new Set(['new-a', 'new-b']),
    );
    expect(next.size).toBe(TAG_MANAGER_FEED_CACHE_MAX_ENTRIES);
    expect(next.has('new-a')).toBe(true);
    expect(next.has('new-b')).toBe(true);
  });
});
