import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as feedStore from '@/stores/feedStore';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import {
  clearFeedMetadataCacheForTests,
  getAllFeedMetadataCached,
} from '@/services/feeds/feedMetadataCache';
import type { Feed } from '@/services/feeds/types';

vi.mock('@/stores/feedStore', () => ({
  listSidebarSnapshot: vi.fn(),
  getAll: vi.fn(),
}));

const slimFeed = (id: string): Feed => ({
  id,
  title: id,
  url: `https://${id}.example.com/rss.xml`,
  tags: [],
});

describe('getAllFeedMetadataCached', () => {
  beforeEach(() => {
    clearFeedMetadataCacheForTests();
    feedLibraryMutationBus.resetForTests();
    vi.mocked(feedStore.listSidebarSnapshot).mockReset();
    vi.mocked(feedStore.getAll).mockReset();
  });

  afterEach(() => {
    clearFeedMetadataCacheForTests();
    feedLibraryMutationBus.resetForTests();
  });

  it('neverFallsBackToGetAll', async () => {
    vi.mocked(feedStore.listSidebarSnapshot).mockResolvedValue({
      feeds: [slimFeed('feed-a')],
      stations: [],
    });
    vi.mocked(feedStore.getAll).mockResolvedValue([slimFeed('blob')]);

    const feeds = await getAllFeedMetadataCached();
    expect(feeds.map((feed) => feed.id)).toEqual(['feed-a']);
    expect(feedStore.getAll).not.toHaveBeenCalled();

    vi.mocked(feedStore.listSidebarSnapshot).mockRejectedValueOnce(new Error('snapshot failed'));
    clearFeedMetadataCacheForTests();
    await expect(getAllFeedMetadataCached()).rejects.toThrow('snapshot failed');
    expect(feedStore.getAll).not.toHaveBeenCalled();
  });

  it('discardsSnapshotAfterInvalidation', async () => {
    let resolveFirst!: (value: { feeds: Feed[]; stations: [] }) => void;
    vi.mocked(feedStore.listSidebarSnapshot)
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        feeds: [slimFeed('feed-new')],
        stations: [],
      });

    const pending = getAllFeedMetadataCached();
    feedLibraryMutationBus.publishFeedDeleted('feed-old');
    resolveFirst({
      feeds: [slimFeed('feed-old')],
      stations: [],
    });

    const feeds = await pending;
    expect(feeds.map((feed) => feed.id)).toEqual(['feed-new']);
    expect(feedStore.getAll).not.toHaveBeenCalled();
    expect(feedStore.listSidebarSnapshot).toHaveBeenCalledTimes(2);
  });
});
