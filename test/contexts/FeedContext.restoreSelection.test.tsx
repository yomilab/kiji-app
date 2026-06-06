import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { FeedProvider, useFeed } from '@/contexts/FeedContext';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { convertFeedItemsToArticles } from '@/services/articles/articleConverter';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';

vi.mock('@/stores/articleStore', () => ({
  query: vi.fn(),
  store: vi.fn(),
  getUnreadCount: vi.fn(),
  getArticleCount: vi.fn(),
}));

vi.mock('@/stores/feedStore', () => ({
  getCount: vi.fn(),
  getById: vi.fn(),
}));

vi.mock('@/services/feeds/feedsFetcher', () => ({
  feedsFetcher: {
    fetchFeed: vi.fn(),
  },
}));

vi.mock('@/services/articles/articleConverter', () => ({
  convertFeedItemsToArticles: vi.fn(),
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getAllFeeds: vi.fn(),
    getFeedById: vi.fn(),
    getFeedByUrl: vi.fn(),
    updateFeed: vi.fn(),
  },
}));

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    getAllTags: vi.fn(),
    getFeedsByTag: vi.fn(),
  },
}));

vi.mock('@/services/favicons/faviconRefreshService', () => ({
  maybeRefreshFavicon: vi.fn(),
}));

vi.mock('@/services/logger', () => ({
  logger: {
    setPersistToFile: vi.fn(),
    getLogsPath: vi.fn().mockResolvedValue(null),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const RESTORE_REFRESH_DELAY_MS = 1200;

const waitForExpectation = async (
  expectation: () => void,
  timeoutMs = 1500,
  intervalMs = 10
) => {
  const startedAt = Date.now();
  let latestError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      expectation();
      return;
    } catch (error) {
      latestError = error;
    }

    await act(async () => {
      vi.advanceTimersByTime(intervalMs);
      await Promise.resolve();
    });
  }

  throw latestError;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FeedContext restore selection', () => {
  let latestContext: ReturnType<typeof useFeed> | null = null;
  let root: Root;
  let container: HTMLDivElement;

  const Probe: React.FC = () => {
    latestContext = useFeed();
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    latestContext = null;
    localStorage.clear();

    (feedStore.getCount as vi.Mock).mockResolvedValue(0);
    (articleStore.query as vi.Mock).mockResolvedValue({
      articles: [{
        hash: 'hash-a1',
        title: 'Article hash-a1',
        description: 'Description hash-a1',
        content: '<p>hash-a1</p>',
        fetchedDate: '2026-02-25T00:00:00.000Z',
        feedId: 'feed-a',
        feedUrl: 'https://feed-a.example.com/rss.xml',
        read: false,
        starred: false,
        saved: false,
        feedTitle: 'Feed A',
        publishedDate: '2026-02-25T00:00:00.000Z',
      }],
      total: 1,
    });
    (articleStore.store as vi.Mock).mockResolvedValue(0);
    (articleStore.getUnreadCount as vi.Mock).mockResolvedValue(0);
    (articleStore.getArticleCount as vi.Mock).mockResolvedValue(0);
    (feedsManager.updateFeed as vi.Mock).mockResolvedValue(undefined);
    (feedsFetcher.fetchFeed as vi.Mock).mockResolvedValue([]);
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([]);
    (tagsManager.getAllTags as vi.Mock).mockResolvedValue([{ name: 'Station' }]);
    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue({
      id: 'feed-a',
      title: 'Feed A',
      url: 'https://feed-a.example.com/rss.xml',
      lastFetched: null,
      consecutiveFailures: 0,
      lastFailedFetchAt: null,
    });

    localStorage.setItem('last-sidebar-selection', JSON.stringify({ type: 'tag', tagName: 'Station' }));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('restores cached station articles before deferring refresh work', async () => {
    await act(async () => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(420);
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(latestContext).not.toBeNull();
      expect(latestContext!.selectedTag).toBe('Station');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    expect(feedsManager.getFeedById).not.toHaveBeenCalled();
    expect(feedsFetcher.fetchFeed).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(RESTORE_REFRESH_DELAY_MS);
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(feedsManager.getFeedById).toHaveBeenCalledWith('feed-a');
    });
  });
});
