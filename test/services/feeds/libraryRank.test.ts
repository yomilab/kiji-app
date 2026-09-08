import { describe, expect, it } from 'vitest';
import {
  applyStationTagsToFeeds,
  buildFeedToStationsMap,
  mergeUnstationedSortIntoFeeds,
  resolveInsertionDrop,
  shouldRollbackLibraryReorder,
} from '@/services/feeds/libraryRank';
import {
  LIBRARY_REORDER_SUPERSEDED,
  LIBRARY_REORDER_SUPERSEDED_BY_IMPORT,
} from '@/services/feeds/libraryReorderQueue';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import type { Feed } from '@/services/feeds/feedsManager';
import type { Tag } from '@/types/tag';

describe('libraryRank', () => {
  it('does not rollback a persist superseded by a later drop', () => {
    expect(shouldRollbackLibraryReorder(new Error(LIBRARY_REORDER_SUPERSEDED), {
      hydrateFresh: false,
    })).toBe(false);
  });

  it('always rollbacks an import-lock reject, even when hydrate looks fresh', () => {
    expect(shouldRollbackLibraryReorder(new Error(LIBRARY_REORDER_SUPERSEDED_BY_IMPORT), {
      hydrateFresh: true,
    })).toBe(true);
  });

  it('rollbacks an import-lock reject when no hydrate landed', () => {
    expect(shouldRollbackLibraryReorder(new Error(LIBRARY_REORDER_SUPERSEDED_BY_IMPORT), {
      hydrateFresh: false,
    })).toBe(true);
  });

  it('commits the insertion line, not the event target row', () => {
    expect(resolveInsertionDrop({
      id: 'a',
      overId: 'b',
      placement: 'after',
    })).toEqual({ targetId: 'b', placement: 'after' });
  });

  it('rebuilds feed-to-station tags from a hydrate snapshot', () => {
    const stations: Tag[] = [
      { name: 'Daily', feedIds: ['a'], createdAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Tech', feedIds: ['a', 'b'], createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const feeds: Feed[] = [
      { id: 'a', title: 'A', url: 'https://a.example', tags: [] },
      { id: 'b', title: 'B', url: 'https://b.example', tags: ['Old'] },
    ];

    expect(buildFeedToStationsMap(stations).get('a')).toEqual(['Daily', 'Tech']);
    expect(applyStationTagsToFeeds(feeds, stations).map((feed) => feed.tags)).toEqual([
      ['Daily', 'Tech'],
      ['Tech'],
    ]);
  });

  it('merges unstationed sort into an all-feeds table without shrinking it', () => {
    const feeds: Feed[] = [
      { id: 'a', title: 'A', url: 'https://a.example', tags: ['Daily'], sortOrder: 9 },
      { id: 'b', title: 'B', url: 'https://b.example', tags: [], sortOrder: 1 },
    ];
    const next = mergeUnstationedSortIntoFeeds(feeds, [{ id: 'b', sortOrder: 0 }]);
    expect(next).toHaveLength(2);
    expect(next[0]?.id).toBe('a');
    expect(next[1]?.sortOrder).toBe(0);
  });

  it('treats leftover station hydrate as stale after a later membership reorder', () => {
    feedLibraryMutationBus.resetForTests();
    feedLibraryMutationBus.publishLibraryHydrated({
      stations: [{ name: 'Daily', feedIds: ['a'], createdAt: '2026-01-01T00:00:00.000Z' }],
      unstationed: [],
    });
    const leftover = feedLibraryMutationBus.getStationsHydrated();
    expect(feedLibraryMutationBus.isStationsHydrateFresh(leftover)).toBe(true);
    feedLibraryMutationBus.publishStationMembershipReordered({
      stationName: 'Daily',
      feedIds: ['b', 'a'],
    });
    expect(feedLibraryMutationBus.isStationsHydrateFresh(leftover)).toBe(false);
    feedLibraryMutationBus.resetForTests();
  });

  it('treats leftover station hydrate as stale after a later feed delete', () => {
    feedLibraryMutationBus.resetForTests();
    feedLibraryMutationBus.publishLibraryHydrated({
      stations: [{ name: 'Daily', feedIds: ['a'], createdAt: '2026-01-01T00:00:00.000Z' }],
      unstationed: [],
    });
    const leftover = feedLibraryMutationBus.getStationsHydrated();
    feedLibraryMutationBus.publishFeedDeleted('a');
    expect(feedLibraryMutationBus.isStationsHydrateFresh(leftover)).toBe(false);
    expect(feedLibraryMutationBus.isUnstationedHydrateFresh()).toBe(false);
    feedLibraryMutationBus.resetForTests();
  });

  it('treats leftover unstationed hydrate as stale after a later station assign patch', () => {
    feedLibraryMutationBus.resetForTests();
    feedLibraryMutationBus.publishLibraryHydrated({
      stations: [{ name: 'Daily', feedIds: ['a'], createdAt: '2026-01-01T00:00:00.000Z' }],
      unstationed: [{ id: 'b', title: 'B', url: 'https://b.example', tags: [] }],
    });
    const leftover = feedLibraryMutationBus.getUnstationedHydrated();
    expect(feedLibraryMutationBus.isUnstationedHydrateFresh(leftover)).toBe(true);
    feedLibraryMutationBus.publishStationPatched('Daily', {
      name: 'Daily',
      feedIds: ['a', 'b'],
      createdAt: '2026-01-01T00:00:00.000Z',
      sortOrder: 0,
    });
    expect(feedLibraryMutationBus.isUnstationedHydrateFresh(leftover)).toBe(false);
    feedLibraryMutationBus.resetForTests();
  });

  it('treats leftover membership as stale after a later station assign patch', () => {
    feedLibraryMutationBus.resetForTests();
    feedLibraryMutationBus.publishStationMembershipReordered({
      stationName: 'Daily',
      feedIds: ['b', 'a'],
    });
    const leftover = feedLibraryMutationBus.getStationMembershipReordered();
    expect(feedLibraryMutationBus.isStationMembershipLeftoverFresh(leftover)).toBe(true);
    feedLibraryMutationBus.publishStationPatched('Daily', {
      name: 'Daily',
      feedIds: ['b', 'a', 'c'],
      createdAt: '2026-01-01T00:00:00.000Z',
      sortOrder: 0,
    });
    expect(feedLibraryMutationBus.isStationMembershipLeftoverFresh(leftover)).toBe(false);
    feedLibraryMutationBus.resetForTests();
  });
});
