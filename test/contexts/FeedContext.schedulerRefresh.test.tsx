import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { FeedProvider, useFeed } from '@/contexts/FeedContext';
import type { Article } from '@/types/article';
import { tagsManager } from '@/services/tags/tagsManager';
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
    fetchFeedNetworkWithCache: vi.fn(),
  },
}));

vi.mock('@/services/articles/articleConverter', () => ({
  convertFeedItemsToArticles: vi.fn(),
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getAllFeeds: vi.fn(),
    getFeedById: vi.fn(),
    updateFeed: vi.fn(),
  },
}));

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    getFeedsByTag: vi.fn(),
  },
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

type TestSchedulerEvent = { type: string; feedId?: string; newArticleCount?: number };

const schedulerHarness = vi.hoisted(() => {
  let listener: ((event: TestSchedulerEvent) => void) | null = null;
  return {
    feedScheduler: {
      on: vi.fn((nextListener: (event: TestSchedulerEvent) => void) => {
        listener = nextListener;
        return () => {
          if (listener === nextListener) {
            listener = null;
          }
        };
      }),
      pauseForStationSelection: vi.fn(),
      resumeAfterStationSelection: vi.fn(),
    },
    __emitSchedulerEvent: (event: TestSchedulerEvent) => {
      listener?.(event);
    },
  };
});

vi.mock('@/services/scheduler/feedSchedulerService', () => ({
  feedScheduler: schedulerHarness.feedScheduler,
  __emitSchedulerEvent: schedulerHarness.__emitSchedulerEvent,
}));

const __emitSchedulerEvent = schedulerHarness.__emitSchedulerEvent;

const createArticle = (hash: string, feedId: string): Article => ({
  hash,
  title: `Article ${hash}`,
  description: `Description ${hash}`,
  content: `<p>${hash}</p>`,
  fetchedDate: '2026-02-25T00:00:00.000Z',
  feedId,
  feedUrl: `https://${feedId}.example.com/rss.xml`,
  read: false,
  starred: false,
  saved: false,
  feedTitle: `Feed ${feedId}`,
  publishedDate: '2026-02-25T00:00:00.000Z',
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    });
  }

  throw latestError;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FeedContext scheduler refresh', () => {
  let latestContext: ReturnType<typeof useFeed> | null = null;
  let root: Root;
  let container: HTMLDivElement;

  const Probe: React.FC = () => {
    latestContext = useFeed();
    return null;
  };

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    latestContext = null;
    (feedStore.getCount as vi.Mock).mockResolvedValue(0);
    (feedStore.getById as vi.Mock).mockImplementation((id: string) => {
      if (id === 'feed-1') {
        return Promise.resolve({
          id: 'feed-1',
          title: 'Feed 1',
          url: 'https://feed-1.example.com/rss.xml',
          lastFetched: new Date(),
        });
      }
      if (id === 'feed-2') {
        return Promise.resolve({
          id: 'feed-2',
          title: 'Feed 2',
          url: 'https://feed-2.example.com/rss.xml',
          lastFetched: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });
    (articleStore.store as vi.Mock).mockResolvedValue(0);
    (articleStore.getUnreadCount as vi.Mock).mockResolvedValue(0);
    (articleStore.getArticleCount as vi.Mock).mockResolvedValue(0);
    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue([]);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('refreshes the active feed when the scheduler inserts new articles', async () => {
    const initialArticles = [createArticle('hash-a1', 'feed-1')];
    const refreshedArticles = [createArticle('hash-a2', 'feed-1'), ...initialArticles];

    (articleStore.query as vi.Mock)
      .mockResolvedValueOnce({ articles: initialArticles, total: initialArticles.length })
      .mockResolvedValueOnce({ articles: refreshedArticles, total: refreshedArticles.length });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectFeed('feed-1', 'https://feed-1.example.com/rss.xml', 'Feed 1');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-1',
        newArticleCount: 1,
      });
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a2', 'hash-a1']);
      expect(Array.from(latestContext!.newArticleHashes)).toEqual(['hash-a2']);
      expect(latestContext!.articleListScrollRequest?.mode).toBe('top');
    });
  });

  it('ignores scheduler updates for feeds outside the active station', async () => {
    const stationArticles = [createArticle('hash-a1', 'feed-1')];

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'Station') {
        return Promise.resolve(['feed-1']);
      }
      return Promise.resolve([]);
    });
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: stationArticles, total: stationArticles.length });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectTag('Station');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-2',
        newArticleCount: 1,
      });
      __emitSchedulerEvent({ type: 'cycle-complete' });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    expect(articleStore.query).toHaveBeenCalledTimes(1);
  });

  it('keeps the visible list frozen while search is active and applies deferred inserts after search clears', async () => {
    const initialArticles = [createArticle('hash-a1', 'feed-1')];
    const refreshedArticles = [createArticle('hash-a2', 'feed-1'), ...initialArticles];

    (articleStore.query as vi.Mock)
      .mockResolvedValueOnce({ articles: initialArticles, total: initialArticles.length })
      .mockResolvedValueOnce({ articles: refreshedArticles, total: refreshedArticles.length });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectFeed('feed-1', 'https://feed-1.example.com/rss.xml', 'Feed 1');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: true,
        isAtTop: true,
        anchorHash: 'hash-a1',
      });
    });

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-1',
        newArticleCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: false,
        isAtTop: true,
        anchorHash: 'hash-a1',
      });
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a2', 'hash-a1']);
      expect(Array.from(latestContext!.newArticleHashes)).toEqual(['hash-a2']);
    });
  });

  it('defers visible background refreshes until article-list scrolling is idle', async () => {
    const initialArticles = [createArticle('hash-a1', 'feed-1')];
    const refreshedArticles = [createArticle('hash-a2', 'feed-1'), ...initialArticles];
    let queryCount = 0;

    (articleStore.query as vi.Mock).mockReset();
    (articleStore.query as vi.Mock).mockImplementation(() => {
      queryCount += 1;
      if (queryCount === 1) {
        return Promise.resolve({ articles: initialArticles, total: initialArticles.length });
      }
      return Promise.resolve({ articles: refreshedArticles, total: refreshedArticles.length });
    });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectFeed('feed-1', 'https://feed-1.example.com/rss.xml', 'Feed 1');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: false,
        isAtTop: false,
        anchorHash: 'hash-a1',
        isScrolling: true,
      });
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-1',
        newArticleCount: 1,
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a2', 'hash-a1']);
      expect(latestContext!.articleListScrollRequest).toEqual(expect.objectContaining({
        mode: 'anchor',
        anchorHash: 'hash-a1',
      }));
    });
  });

  it('clears stale scroll-idle deferral when switching article-list sources', async () => {
    const feedOneArticles = [createArticle('hash-a1', 'feed-1')];
    const feedTwoInitialArticles = [createArticle('hash-b1', 'feed-2')];
    const feedTwoRefreshedArticles = [createArticle('hash-b2', 'feed-2'), ...feedTwoInitialArticles];
    let feedTwoQueryCount = 0;

    (articleStore.query as vi.Mock).mockReset();
    (articleStore.query as vi.Mock).mockImplementation((query: { feedIds?: string[] }) => {
      if (query.feedIds?.includes('feed-1')) {
        return Promise.resolve({ articles: feedOneArticles, total: feedOneArticles.length });
      }

      if (query.feedIds?.includes('feed-2')) {
        feedTwoQueryCount += 1;
        const articles = feedTwoQueryCount === 1 ? feedTwoInitialArticles : feedTwoRefreshedArticles;
        return Promise.resolve({ articles, total: articles.length });
      }

      return Promise.resolve({ articles: [], total: 0 });
    });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectFeed('feed-1', 'https://feed-1.example.com/rss.xml', 'Feed 1');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: false,
        isAtTop: false,
        anchorHash: 'hash-a1',
        isScrolling: true,
      });
    });

    await act(async () => {
      await latestContext!.selectFeed('feed-2', 'https://feed-2.example.com/rss.xml', 'Feed 2');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1']);
    });

    act(() => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-2',
        newArticleCount: 1,
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b2', 'hash-b1']);
    expect(feedTwoQueryCount).toBe(2);
  });

  it('only refreshes unread view when the scheduler reports new unread inserts', async () => {
    const initialArticles = [createArticle('hash-u1', 'feed-1')];
    const refreshedArticles = [createArticle('hash-u2', 'feed-2'), ...initialArticles];

    (articleStore.query as vi.Mock)
      .mockResolvedValueOnce({ articles: initialArticles, total: initialArticles.length })
      .mockResolvedValueOnce({ articles: refreshedArticles, total: refreshedArticles.length });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectSmartView('unread');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-u1']);
    });

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-2',
        newArticleCount: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-u1']);

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-2',
        newArticleCount: 1,
      });
      __emitSchedulerEvent({ type: 'cycle-complete' });
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-u2', 'hash-u1']);
      expect(Array.from(latestContext!.newArticleHashes)).toEqual(['hash-u2']);
    });
  });

  it('coalesces multiple scheduler feed updates into one visible-source reload', async () => {
    const initialArticles = [createArticle('hash-a1', 'feed-1')];
    const refreshedArticles = [
      createArticle('hash-b1', 'feed-2'),
      createArticle('hash-a2', 'feed-1'),
      ...initialArticles,
    ];

    (articleStore.query as vi.Mock)
      .mockResolvedValueOnce({ articles: initialArticles, total: initialArticles.length })
      .mockResolvedValueOnce({ articles: refreshedArticles, total: refreshedArticles.length });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-1',
        newArticleCount: 1,
      });
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-2',
        newArticleCount: 1,
      });
      __emitSchedulerEvent({ type: 'cycle-complete' });
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1', 'hash-a2', 'hash-a1']);
      expect(articleStore.query).toHaveBeenCalledTimes(2);
    });
  });

  it('drops a stale background refresh when the user switches feeds before it applies', async () => {
    const initialFeedOneArticles = [createArticle('hash-a1', 'feed-1')];
    const refreshedFeedOneArticles = [createArticle('hash-a2', 'feed-1'), ...initialFeedOneArticles];
    const feedTwoArticles = [createArticle('hash-b1', 'feed-2')];
    const backgroundRefreshDeferred = createDeferred<{ articles: Article[]; total: number }>();

    (articleStore.query as vi.Mock).mockImplementation((query: { feedIds?: string[] }) => {
      if (query.feedIds?.includes('feed-1')) {
        if ((articleStore.query as vi.Mock).mock.calls.length === 1) {
          return Promise.resolve({ articles: initialFeedOneArticles, total: initialFeedOneArticles.length });
        }

        return backgroundRefreshDeferred.promise;
      }

      if (query.feedIds?.includes('feed-2')) {
        return Promise.resolve({ articles: feedTwoArticles, total: feedTwoArticles.length });
      }

      return Promise.resolve({ articles: [], total: 0 });
    });

    await renderProvider();

    await waitForExpectation(() => expect(latestContext).not.toBeNull());
    await act(async () => {
      await latestContext!.selectFeed('feed-1', 'https://feed-1.example.com/rss.xml', 'Feed 1');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    await act(async () => {
      __emitSchedulerEvent({
        type: 'feed-updated',
        feedId: 'feed-1',
        newArticleCount: 1,
      });
      await Promise.resolve();
    });

    await act(async () => {
      await latestContext!.selectFeed('feed-2', 'https://feed-2.example.com/rss.xml', 'Feed 2');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedFeedId).toBe('feed-2');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1']);
    });

    await act(async () => {
      backgroundRefreshDeferred.resolve({
        articles: refreshedFeedOneArticles,
        total: refreshedFeedOneArticles.length,
      });
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestContext!.selectedFeedId).toBe('feed-2');
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1']);
    expect(latestContext!.newArticleHashes.size).toBe(0);
  });
});
