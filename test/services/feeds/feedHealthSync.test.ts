import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '@/services/feeds/feedsManager';
import type { SchedulerEvent } from '@/services/scheduler/types';

const mocks = vi.hoisted(() => ({
  listSidebarSnapshot: vi.fn(),
  getAllFeedMetadataCached: vi.fn(),
}));

vi.mock('@/stores/feedStore', () => ({ listSidebarSnapshot: mocks.listSidebarSnapshot }));
vi.mock('@/services/feeds/feedMetadataCache', () => ({ getAllFeedMetadataCached: mocks.getAllFeedMetadataCached }));
vi.mock('@/services/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  getFailingFeedIds,
  installFeedHealthSync,
  resetFeedHealthSyncForTests,
  subscribeFailingFeedIds,
  syncFeedHealth,
} from '@/services/feeds/feedHealthSync';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

const feed = (id: string, overrides: Partial<Feed> = {}): Feed => ({
  id,
  title: id,
  url: `https://example.com/${id}.xml`,
  tags: [],
  unreadCount: 1,
  articleCount: 5,
  consecutiveFailures: 0,
  lastFetched: new Date('2026-10-20T00:00:00Z'),
  ...overrides,
});

const snapshot = (feeds: Feed[]) => ({ feeds, stations: [] });

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('feedHealthSync', () => {
  beforeEach(() => {
    resetFeedHealthSyncForTests();
    feedLibraryMutationBus.resetForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('publishes only feeds whose health changed, with their counts', async () => {
    mocks.getAllFeedMetadataCached.mockResolvedValue([feed('a'), feed('b')]);
    mocks.listSidebarSnapshot.mockResolvedValue(snapshot([
      feed('a', { consecutiveFailures: 2, lastFailedFetchAt: new Date('2026-10-22T00:00:00Z') }),
      feed('b'),
    ]));

    await syncFeedHealth();

    const published = feedLibraryMutationBus.getFeedsCountsUpdated();
    expect(published?.feeds).toEqual([{
      id: 'a',
      unreadCount: 1,
      articleCount: 5,
      health: {
        consecutiveFailures: 2,
        lastFetchedMs: new Date('2026-10-20T00:00:00Z').getTime(),
        lastFailedFetchAtMs: new Date('2026-10-22T00:00:00Z').getTime(),
      },
    }]);
    expect([...getFailingFeedIds()]).toEqual(['a']);
  });

  it('clears a recovered feed and notifies store subscribers', async () => {
    mocks.getAllFeedMetadataCached.mockResolvedValue([feed('a', { consecutiveFailures: 3 })]);
    const listener = vi.fn();
    subscribeFailingFeedIds(listener);
    mocks.listSidebarSnapshot.mockResolvedValue(snapshot([feed('a', { lastFetched: new Date('2026-10-22T00:00:00Z') })]));

    await syncFeedHealth();

    expect(feedLibraryMutationBus.getFeedsCountsUpdated()?.feeds[0]).toMatchObject({
      id: 'a',
      health: { consecutiveFailures: 0 },
    });
    expect(getFailingFeedIds().size).toBe(0);
    // Seed (failing) then recovery: two changes to the failing set.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('publishes nothing when health did not change', async () => {
    mocks.getAllFeedMetadataCached.mockResolvedValue([feed('a')]);
    mocks.listSidebarSnapshot.mockResolvedValue(snapshot([feed('a', { unreadCount: 9 })]));

    await syncFeedHealth();

    expect(feedLibraryMutationBus.getFeedsCountsUpdated()).toBeNull();
  });

  it('syncs after a cycle with a failure, and skips healthy cycles', async () => {
    mocks.getAllFeedMetadataCached.mockResolvedValue([feed('a')]);
    mocks.listSidebarSnapshot.mockResolvedValue(snapshot([feed('a')]));
    let emit: (event: SchedulerEvent) => void = () => {};
    const remove = installFeedHealthSync((listener) => {
      emit = listener;
      return () => {};
    });
    await flush();

    emit({ type: 'cycle-complete', cycleId: 1 });
    await flush();
    expect(mocks.listSidebarSnapshot).not.toHaveBeenCalled();

    emit({ type: 'feed-failed', feedId: 'a', error: 'offline' });
    emit({ type: 'cycle-complete', cycleId: 2 });
    await flush();
    expect(mocks.listSidebarSnapshot).toHaveBeenCalledTimes(1);
    remove();
  });
});
