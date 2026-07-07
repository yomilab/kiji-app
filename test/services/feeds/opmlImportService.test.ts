import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { opmlImportService, parseOpmlEntries } from '@/services/feeds/opmlImportService';
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
    getAllTags: vi.fn(),
    updateTag: vi.fn(),
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
    vi.mocked(tagsManager.getAllTags).mockResolvedValue([]);
    vi.mocked(tagsManager.updateTag).mockResolvedValue(null);
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
      navigationTarget: {
        type: 'station',
        stationName: 'Tech',
      },
    });
    expect(feedsManager.addFeedWithoutMetadata).toHaveBeenCalledTimes(1);
    expect(feedsManager.addFeedWithoutMetadata).toHaveBeenCalledWith('https://new.com/rss/', 'New Feed');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('feed-New Feed', 'Tech');
    expect(tagsManager.updateTag).toHaveBeenCalledWith('Tech', { sortOrder: 0 });
    expect(faviconFetcher.fetchFavicon).not.toHaveBeenCalled();
    expect(feedsManager.updateFeed).not.toHaveBeenCalled();
  });

  it('parses OPML 1.0 with unescaped ampersands in outline attributes', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title || 'untitled'}`,
      url,
      title: title || url,
      tags: [],
    } as never));
    vi.mocked(tagsManager.addTagToFeed).mockResolvedValue(undefined);

    const opmlText = `<?xml version='1.0' encoding='UTF-8' ?>
<opml version="1.0">
  <body>
    <outline text="Hong Kong SAR China" title="Hong Kong SAR China">
      <outline text="Hong Kong Free Press HKFP" title="Hong Kong Free Press HKFP" description="Hong Kong news - Independent &, non-profit" xmlUrl="https://www.hongkongfp.com/feed/" type="rss" />
    </outline>
  </body>
</opml>`;

    const result = await opmlImportService.importFromText(opmlText);

    expect(result.summary.imported).toBe(1);
    expect(result.importedFeeds[0]?.url).toBe('https://www.hongkongfp.com/feed/');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('feed-Hong Kong Free Press HKFP', 'Hong Kong SAR China');
    expect(result.navigationTarget).toEqual({
      type: 'station',
      stationName: 'Hong Kong SAR China',
    });
  });

  it('navigates to the first imported feed when imports have no station tags', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title || 'untitled'}`,
      url,
      title: title || url,
      tags: [],
    } as never));

    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline>
      <outline text="Feed A" xmlUrl="https://a.com/rss" />
      <outline text="Feed B" xmlUrl="https://b.com/rss" />
    </outline>
  </body>
</opml>`;

    const result = await opmlImportService.importFromText(opmlText);

    expect(result.navigationTarget).toEqual({
      type: 'feed',
      feedId: 'feed-Feed A',
      feedUrl: 'https://a.com/rss',
      feedTitle: 'Feed A',
    });
  });

  it('groups flat OPML feeds into one station derived from the import URL', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title || 'untitled'}`,
      url,
      title: title || url,
      tags: [],
    } as never));
    vi.mocked(tagsManager.addTagToFeed).mockResolvedValue(undefined);

    const opmlText = `<?xml version='1.0' encoding='UTF-8' ?>
<opml version="1.0">
  <head><title>Export from Plenary</title></head>
  <body>
    <outline text="EFL Championship" xmlUrl="https://www.reddit.com/r/Championship/.rss?format=xml" type="rss" />
    <outline text="Football365" xmlUrl="https://www.football365.com/feed" type="rss" />
  </body>
</opml>`;

    const entries = parseOpmlEntries(opmlText, {
      url: 'https://example.com/Football.opml',
    });

    expect(entries).toEqual([
      expect.objectContaining({ title: 'EFL Championship', station: 'Football' }),
      expect.objectContaining({ title: 'Football365', station: 'Football' }),
    ]);

    const result = await opmlImportService.importFromText(opmlText, {
      url: 'https://example.com/Football.opml',
    });

    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('feed-EFL Championship', 'Football');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('feed-Football365', 'Football');
    expect(result.navigationTarget).toEqual({
      type: 'station',
      stationName: 'Football',
    });
  });
});
