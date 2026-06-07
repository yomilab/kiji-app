import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { opmlImportService } from '@/services/feeds/opmlImportService';
import * as feedStore from '@/stores/feedStore';

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getAllFeeds: vi.fn(),
    addFeedWithoutMetadata: vi.fn(),
    updateFeed: vi.fn(),
  },
}));

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    addTagToFeed: vi.fn(),
  },
}));

vi.mock('@/services/favicons/faviconFetcher', () => ({
  faviconFetcher: {
    fetchFavicon: vi.fn(),
  },
}));

vi.mock('@/stores/feedStore', () => ({
  update: vi.fn(),
}));

describe('opmlImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(feedStore.update).mockResolvedValue(undefined);
  });

  it('imports unique feeds without blocking on favicon fetch during DB writes', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([
      { id: 'existing-1', url: 'https://existing.com/feed', tags: [] } as never,
    ]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title || 'untitled'}`,
      url,
      title: title || url,
      tags: [],
    } as never));
    vi.mocked(feedsManager.updateFeed).mockResolvedValue(null);
    vi.mocked(tagsManager.addTagToFeed).mockResolvedValue(undefined);
    vi.mocked(faviconFetcher.fetchFavicon).mockResolvedValue('data:image/png;base64,abc');

    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline text="New Feed" xmlUrl="https://new.com/rss/" />
      <outline text="Duplicate In File" xmlUrl="https://new.com/rss" />
      <outline text="Existing Feed" xmlUrl="https://existing.com/feed/" />
      <outline text="Invalid" xmlUrl="#" />
    </outline>
  </body>
</opml>`;

    const result = await opmlImportService.importFromText(opmlText);

    expect(result).toEqual({
      summary: {
        total: 4,
        imported: 1,
        skippedDuplicate: 2,
        invalid: 1,
        failed: 0,
      },
      importedFeeds: [
        {
          id: 'feed-New Feed',
          url: 'https://new.com/rss/',
        },
      ],
    });
    expect(feedsManager.addFeedWithoutMetadata).toHaveBeenCalledTimes(1);
    expect(feedsManager.addFeedWithoutMetadata).toHaveBeenCalledWith('https://new.com/rss/', 'New Feed');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('feed-New Feed', 'Tech');
    expect(faviconFetcher.fetchFavicon).not.toHaveBeenCalled();
    expect(feedsManager.updateFeed).not.toHaveBeenCalled();
  });
});
