import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { opmlImportService, parseOpmlEntries } from '@/services/feeds/opmlImportService';
import * as feedStore from '@/stores/feedStore';
import { logger } from '@/services/logger';
import {
  getRobustnessSnapshot,
  resetRobustnessMetricsForTests,
} from '@/services/diagnostics/robustnessMetrics';

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getAllFeeds: vi.fn(),
    addFeedWithoutMetadata: vi.fn(),
    updateFeed: vi.fn(),
    reorderUnstationed: vi.fn(),
  },
}));

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    addTagToFeed: vi.fn(),
    getAllTags: vi.fn(),
    updateTag: vi.fn(),
    reorderStations: vi.fn(),
    reorderMembership: vi.fn(),
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
    resetRobustnessMetricsForTests();
    vi.mocked(tagsManager.getAllTags).mockResolvedValue([]);
    vi.mocked(tagsManager.reorderStations).mockResolvedValue(undefined);
    vi.mocked(tagsManager.reorderMembership).mockResolvedValue(undefined);
    vi.mocked(feedsManager.reorderUnstationed).mockResolvedValue(undefined);
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
        partialFailures: 0,
      },
      importedFeeds: [
        {
          id: 'feed-New Feed',
          url: 'https://new.com/rss/',
        },
      ],
      createdFeeds: [
        {
          id: 'feed-New Feed',
          url: 'https://new.com/rss/',
          title: 'New Feed',
          tags: ['Tech'],
        },
      ],
      navigationTarget: {
        type: 'station',
        stationName: 'Tech',
      },
    });
    expect(feedsManager.addFeedWithoutMetadata).toHaveBeenCalledTimes(1);
    // Library has one untagged feed (no sortOrder → 0), so new rows start at 1.
    expect(feedsManager.addFeedWithoutMetadata).toHaveBeenCalledWith(
      'https://new.com/rss/',
      'New Feed',
      { sortOrder: 1 },
    );
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('feed-New Feed', 'Tech');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('existing-1', 'Tech');
    expect(tagsManager.updateTag).not.toHaveBeenCalled();
    expect(tagsManager.reorderStations).toHaveBeenCalledWith(['Tech']);
    expect(tagsManager.reorderMembership).toHaveBeenCalledWith(
      'Tech',
      expect.arrayContaining(['feed-New Feed', 'existing-1']),
    );
    expect(faviconFetcher.fetchFavicon).not.toHaveBeenCalled();
    expect(feedsManager.updateFeed).not.toHaveBeenCalled();
  });

  it('restores station and membership order for existing URLs and later outlines', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([
      { id: 'existing-1', url: 'https://shared.com/feed', tags: ['Old'] } as never,
      { id: 'existing-2', url: 'https://solo.com/feed', tags: [] } as never,
    ]);
    vi.mocked(tagsManager.getAllTags).mockResolvedValue([
      { name: 'Old', feedIds: ['existing-1'], sortOrder: 0 } as never,
    ]);
    vi.mocked(tagsManager.addTagToFeed).mockResolvedValue(undefined);

    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Beta">
      <outline text="Shared" xmlUrl="https://shared.com/feed" />
    </outline>
    <outline text="Alpha">
      <outline text="Shared again" xmlUrl="https://shared.com/feed/" />
      <outline text="Solo" xmlUrl="https://solo.com/feed" />
    </outline>
  </body>
</opml>`;

    const result = await opmlImportService.importFromText(opmlText);

    expect(result.summary).toEqual({
      total: 3,
      imported: 0,
      skippedDuplicate: 3,
      invalid: 0,
      failed: 0,
      partialFailures: 0,
    });
    expect(feedsManager.addFeedWithoutMetadata).not.toHaveBeenCalled();
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('existing-1', 'Beta');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('existing-1', 'Alpha');
    expect(tagsManager.addTagToFeed).toHaveBeenCalledWith('existing-2', 'Alpha');
    expect(tagsManager.reorderStations).toHaveBeenCalledWith(['Beta', 'Alpha', 'Old']);
    expect(tagsManager.reorderMembership).toHaveBeenCalledWith('Beta', ['existing-1']);
    expect(tagsManager.reorderMembership).toHaveBeenCalledWith(
      'Alpha',
      expect.arrayContaining(['existing-1', 'existing-2']),
    );
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
  it('keeps loose feeds out of stations when re-importing a KiJi export', async () => {
    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head>
<title>KiJi Feeds</title>
</head>
<body>
  <outline type="rss" title="Feed A" text="Feed A" xmlUrl="https://a.com/rss" htmlUrl="https://a.com/rss" />
  <outline type="rss" title="Feed B" text="Feed B" xmlUrl="https://b.com/rss" htmlUrl="https://b.com/rss" />
</body>
</opml>`;

    expect(parseOpmlEntries(opmlText, { fileName: 'Feeds.opml' })).toEqual([
      expect.objectContaining({ title: 'Feed A', station: undefined }),
      expect.objectContaining({ title: 'Feed B', station: undefined }),
    ]);
    expect(parseOpmlEntries(opmlText, { fileName: 'Feeds.opml', defaultStationName: 'Reading' })).toEqual([
      expect.objectContaining({ title: 'Feed A', station: 'Reading' }),
      expect.objectContaining({ title: 'Feed B', station: 'Reading' }),
    ]);
  });

  it('assigns untagged sort orders from one library read instead of re-reading per feed', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([
      { id: 'u-1', url: 'https://u1.com/feed', tags: [], sortOrder: 4 } as never,
      { id: 'u-2', url: 'https://u2.com/feed', tags: [], sortOrder: 9 } as never,
      { id: 't-1', url: 'https://t1.com/feed', tags: ['Tech'], sortOrder: 50 } as never,
    ]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title}`,
      url,
      title: title || url,
      tags: [],
    } as never));

    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline>
      <outline text="A" xmlUrl="https://a.com/rss" />
      <outline text="B" xmlUrl="https://b.com/rss" />
      <outline text="C" xmlUrl="https://c.com/rss" />
    </outline>
  </body>
</opml>`;

    const result = await opmlImportService.importFromText(opmlText);

    const sortOrderByUrl = Object.fromEntries(
      vi.mocked(feedsManager.addFeedWithoutMetadata).mock.calls.map(([url, , options]) => [url, options?.sortOrder]),
    );
    expect(sortOrderByUrl).toEqual({
      'https://a.com/rss': 10,
      'https://b.com/rss': 11,
      'https://c.com/rss': 12,
    });
    // One read up front plus the unstationed reorder post-pass — not one per feed.
    expect(feedsManager.getAllFeeds).toHaveBeenCalledTimes(2);
    expect(result.createdFeeds.map((feed) => feed.id)).toEqual(['feed-A', 'feed-B', 'feed-C']);
  });

  it('resolves with the committed feeds when a station attach and post-pass read fail', async () => {
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title}`,
      url,
      title: title || url,
      tags: [],
    } as never));
    vi.mocked(feedsManager.updateFeed).mockResolvedValue(null);
    vi.mocked(tagsManager.addTagToFeed)
      .mockRejectedValueOnce(new Error('tag write failed'))
      .mockResolvedValue(undefined);
    // Initial snapshot succeeds; the post-pass membership read fails.
    vi.mocked(tagsManager.getAllTags)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('ipc closed'));

    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline text="One" xmlUrl="https://one.com/rss" />
      <outline text="Two" xmlUrl="https://two.com/rss" />
    </outline>
  </body>
</opml>`;

    const result = await opmlImportService.importFromText(opmlText);

    expect(result.summary.imported).toBe(2);
    expect(result.summary.partialFailures).toBe(1);
    expect(result.importedFeeds).toHaveLength(2);
    expect(result.createdFeeds).toHaveLength(2);
    // Only the feed whose attach succeeded is published as stationed.
    expect(result.createdFeeds.filter((feed) => feed.tags.includes('Tech'))).toHaveLength(1);
    expect(tagsManager.reorderMembership).not.toHaveBeenCalled();
    expect(getRobustnessSnapshot().counters['opml.importPartialFailures']).toBe(1);
  });

  it('logs one counts-only applied line and records no partial failures on a clean import', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    vi.mocked(feedsManager.getAllFeeds).mockResolvedValue([
      { id: 'existing', url: 'https://dup.com/rss', title: 'Dup', tags: [] } as never,
    ]);
    vi.mocked(feedsManager.addFeedWithoutMetadata).mockImplementation(async (url: string, title?: string) => ({
      id: `feed-${title}`,
      url,
      title: title || url,
      tags: [],
    } as never));
    vi.mocked(feedsManager.updateFeed).mockResolvedValue(null);
    vi.mocked(tagsManager.addTagToFeed).mockResolvedValue(undefined);

    await opmlImportService.importEntries([
      { url: 'https://one.com/rss', title: 'One', station: 'Tech' },
      { url: 'https://dup.com/rss', title: 'Dup' },
      { url: '', title: 'Broken' },
    ]);

    const appliedCalls = infoSpy.mock.calls.filter(([, message]) => message === 'OPML import applied');
    expect(appliedCalls).toHaveLength(1);
    const context = appliedCalls[0][2] as Record<string, number>;
    expect(context).toEqual({
      imported: 1,
      skippedDuplicate: 1,
      invalid: 1,
      failed: 0,
      partialFailures: 0,
      createdFeeds: 1,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(context)).not.toContain('http');
    expect(getRobustnessSnapshot().counters['opml.importPartialFailures']).toBeUndefined();
  });
});
