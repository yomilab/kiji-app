import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseFeedOffMainThread = vi.hoisted(() => vi.fn());
const convertFeedItemsToArticles = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());

vi.mock('@/services/feeds/feedParseWorkerClient', () => ({
  parseFeedOffMainThread,
}));

vi.mock('@/services/articles/articleConverter', () => ({
  convertFeedItemsToArticles,
}));

vi.mock('@/stores/articleStore', () => ({
  store,
}));

import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';

describe('feedRefreshPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseFeedOffMainThread.mockResolvedValue([{ title: 'Item 1' }]);
    convertFeedItemsToArticles.mockResolvedValue([
      {
        hash: 'hash-1',
        title: 'Item 1',
        publishedDate: '2026-01-01T00:00:00.000Z',
      },
    ]);
    store.mockResolvedValue(1);
  });

  it('parses off the main thread, stores articles, and derives update frequency', async () => {
    const result = await storeParsedFeedContent({
      feedId: 'feed-1',
      feedUrl: 'https://example.com/rss',
      rawText: '<rss></rss>',
    });

    expect(parseFeedOffMainThread).toHaveBeenCalledWith('<rss></rss>', 'https://example.com/rss');
    expect(convertFeedItemsToArticles).toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith('feed-1', expect.any(Array));
    expect(result.insertedCount).toBe(1);
    expect(result.updateFrequencyScore).toBeTypeOf('number');
  });

  it('returns early when the abort signal is already set', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await storeParsedFeedContent({
      feedId: 'feed-1',
      feedUrl: 'https://example.com/rss',
      rawText: '<rss></rss>',
      signal: controller.signal,
    });

    expect(result).toEqual({ insertedCount: 0, articles: [] });
    expect(parseFeedOffMainThread).not.toHaveBeenCalled();
  });
});
