import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedProvider, useFeed } from '@/contexts/FeedContext';
import type { Article } from '@/types/article';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';
import { convertFeedItemsToArticles } from '@/services/articles/articleConverter';
import { clearTagFeedIdsCacheForTests } from '@/services/tags/tagFeedIdsCache';
import { clearFeedMetadataCacheForTests } from '@/services/feeds/feedMetadataCache';
import { feedNetworkDataResult } from '../helpers/feedNetworkFetchMock';

vi.mock('@/stores/articleStore', () => ({
  query: vi.fn(),
  store: vi.fn(),
  getUnreadCount: vi.fn(),
  getArticleCount: vi.fn(),
  syncFeedCountsBatch: vi.fn(),
}));

vi.mock('@/stores/feedStore', () => ({
  getCount: vi.fn(),
  getById: vi.fn(),
  getAll: vi.fn(),
  tags: {
    listWithFeedIds: vi.fn().mockResolvedValue([]),
    listFeedIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/feeds/feedsFetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/feeds/feedsFetcher')>();
  return {
    ...actual,
    feedsFetcher: {
      fetchFeed: vi.fn(),
      fetchFeedNetworkWithCache: vi.fn(),
      fetchFeedWithCache: vi.fn(),
    },
  };
});

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
    getFeedsByTag: vi.fn(),
  },
}));

vi.mock('@/services/scheduler/nativeSchedulerCycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/scheduler/nativeSchedulerCycle')>();
  return {
    ...actual,
    isNativeFeedIngestionEnabled: () => false,
  };
});

vi.mock('@/services/articles/articleConverter', () => ({
  convertFeedItemsToArticles: vi.fn(),
}));

vi.mock('@/services/saved/savedArticlesService', () => ({
  savedArticlesService: {
    querySavedViewArticles: vi.fn(),
    enrichSavedViewArticlesMeta: vi.fn(),
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

const stationFeed = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  url: `https://${id}.example.com`,
  title: id,
  lastFetched: new Date(0),
  consecutiveFailures: 0,
  lastFailedFetchAt: undefined as Date | undefined,
  ...overrides,
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

type MockArticleQuery = {
  feedIds?: string[];
  tagName?: string;
  filter?: {
    read?: boolean;
  };
  searchText?: string;
  offset?: number;
  cursor?: {
    effectiveDate: string;
    hash: string;
  };
  includeTotal?: boolean;
  limit?: number;
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

describe('FeedContext Cross-Type Race Conditions', () => {
  let latestContext: ReturnType<typeof useFeed> | null = null;
  let root: Root;
  let container: HTMLDivElement;

  const Probe: React.FC = () => {
    latestContext = useFeed();
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearTagFeedIdsCacheForTests();
    clearFeedMetadataCacheForTests();
    latestContext = null;
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      const id = window.setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        } as IdleDeadline);
      }, 0);
      return id as unknown as number;
    });
    (feedStore.getCount as vi.Mock).mockReset().mockResolvedValue(0);
    (feedStore.getById as vi.Mock).mockReset().mockResolvedValue(null);
    (feedStore.getAll as vi.Mock).mockReset().mockResolvedValue([]);
    (feedStore.tags.listWithFeedIds as vi.Mock).mockReset().mockResolvedValue([]);
    (feedStore.tags.listFeedIds as vi.Mock).mockReset().mockResolvedValue([]);
    (articleStore.query as vi.Mock).mockReset().mockResolvedValue({ articles: [], total: 0 });
    (articleStore.store as vi.Mock).mockReset().mockResolvedValue(0);
    (articleStore.getUnreadCount as vi.Mock).mockReset().mockResolvedValue(0);
    (articleStore.getArticleCount as vi.Mock).mockReset().mockResolvedValue(0);
    (articleStore.syncFeedCountsBatch as vi.Mock).mockReset().mockResolvedValue([]);
    (feedsManager.getFeedById as vi.Mock).mockReset().mockResolvedValue(null);
    (feedsManager.getAllFeeds as vi.Mock).mockReset().mockResolvedValue([]);
    (feedsManager.getFeedByUrl as vi.Mock).mockReset().mockResolvedValue(null);
    (feedsManager.updateFeed as vi.Mock).mockReset().mockResolvedValue(undefined);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockReset().mockResolvedValue(feedNetworkDataResult());
    (convertFeedItemsToArticles as vi.Mock).mockReset().mockResolvedValue([]);
    (savedArticlesService.querySavedViewArticles as vi.Mock).mockReset().mockResolvedValue({ articles: [], total: 0 });
    (savedArticlesService.enrichSavedViewArticlesMeta as vi.Mock).mockReset().mockImplementation((articles: Article[]) => Promise.resolve(articles));
    (tagsManager.getFeedsByTag as vi.Mock).mockReset().mockResolvedValue([]);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('ignores stale Tag response when switching to a Feed', async () => {
    const tagADeferred = createDeferred<{ articles: Article[], total: number }>();
    const feedBArticles = [createArticle('hash-b1', 'feed-b')];

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    
    // Feed B setup
    (feedStore.getById as vi.Mock).mockImplementation((id) => {
      if (id === 'feed-b') return Promise.resolve({ id: 'feed-b', url: 'url-b', lastFetched: new Date() });
      return Promise.resolve(null);
    });

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-a') || query.tagName === 'A') return tagADeferred.promise;
      if (query.feedIds?.includes('feed-b')) {
        return Promise.resolve({ articles: feedBArticles, total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    // 1. Start Tag A selection (will hang on articleStore.query)
    await act(async () => {
      void latestContext!.selectTag('A');
    });

    // 2. Quickly switch to Feed B
    await act(async () => {
      await latestContext!.selectFeed('feed-b', 'url-b', 'Feed B');
    });

    // Verify we are on Feed B
    await waitForExpectation(() => {
      expect(latestContext!.selectedFeedId).toBe('feed-b');
      expect(latestContext!.articles.map(a => a.hash)).toEqual(['hash-b1']);
    });

    // 3. Resolve Tag A's articles
    tagADeferred.resolve({ articles: [createArticle('hash-a1', 'feed-a')], total: 1 });

    // Wait a bit to ensure Tag A doesn't overwrite
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Still should be Feed B
    expect(latestContext!.selectedFeedId).toBe('feed-b');
    expect(latestContext!.articles.map(a => a.hash)).toEqual(['hash-b1']);
  });

  it('ignores stale Feed response when switching to a Smart View', async () => {
    const feedADeferred = createDeferred<{ articles: Article[], total: number }>();
    const smartArticles = [createArticle('hash-smart', 'smart')];

    (feedStore.getById as vi.Mock).mockImplementation((id) => {
      if (id === 'feed-a') return Promise.resolve({ id: 'feed-a', url: 'url-a', lastFetched: new Date() });
      return Promise.resolve(null);
    });

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-a')) return feedADeferred.promise;
      if (query.filter?.read === false) { // Unread smart view
        return Promise.resolve({ articles: smartArticles, total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    // 1. Start Feed A selection
    await act(async () => {
      void latestContext!.selectFeed('feed-a', 'url-a', 'Feed A');
    });

    // 2. Quickly switch to Unread Smart View
    await act(async () => {
      await latestContext!.selectSmartView('unread');
    });

    // Verify we are on Unread
    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('unread');
      expect(latestContext!.articles.map(a => a.hash)).toEqual(['hash-smart']);
    });

    // 3. Resolve Feed A
    feedADeferred.resolve({ articles: [createArticle('hash-a1', 'feed-a')], total: 1 });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Still should be Unread
    expect(latestContext!.selectedSmartView).toBe('unread');
    expect(latestContext!.articles.map(a => a.hash)).toEqual(['hash-smart']);
  });

  it('starts station feed refreshes without waiting for article-list scroll idle', async () => {
    const stationArticles = [
      createArticle('station-1', 'feed-a'),
      createArticle('station-2', 'feed-b'),
    ];
    const firstFetchDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a', 'feed-b']);
    (feedStore.getAll as vi.Mock).mockResolvedValue([stationFeed('feed-a'), stationFeed('feed-b')]);
    (feedsManager.getFeedById as vi.Mock).mockImplementation((id: string) => Promise.resolve({
      id,
      url: `https://${id}.example.com/rss.xml`,
      title: `Feed ${id}`,
      lastFetched: null,
    }));
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: stationArticles, total: 2 });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock)
      .mockImplementationOnce(() => firstFetchDeferred.promise)
      .mockResolvedValue(feedNetworkDataResult());

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('Station');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['station-1', 'station-2']);
    });

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: false,
        isAtTop: false,
        anchorHash: 'station-2',
        isScrolling: true,
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 430));
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      firstFetchDeferred.resolve(feedNetworkDataResult());
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(articleStore.store).toHaveBeenCalledTimes(2);
    });
  });

  it('limits station feed refresh concurrency to reduce switch-time pressure', async () => {
    const feedIds = Array.from({ length: 6 }, (_, index) => `feed-${index + 1}`);
    const fetchDeferreds = feedIds.map(() => createDeferred<ReturnType<typeof feedNetworkDataResult>>());
    let fetchCallCount = 0;

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(feedIds);
    (feedStore.getAll as vi.Mock).mockResolvedValue(feedIds.map((id) => stationFeed(id)));
    (feedsManager.getFeedById as vi.Mock).mockImplementation((id: string) => Promise.resolve({
      id,
      url: `https://${id}.example.com/rss.xml`,
      title: `Feed ${id}`,
      lastFetched: null,
    }));
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [createArticle('station-1', 'feed-1')], total: 1 });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockImplementation(() => {
      const deferred = fetchDeferreds[fetchCallCount];
      fetchCallCount += 1;
      return deferred.promise;
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('Station');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('Station');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(4);
    }, 3000);

    await act(async () => {
      fetchDeferreds[0].resolve(feedNetworkDataResult());
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(5);
    });

    await act(async () => {
      for (const deferred of fetchDeferreds) {
        deferred.resolve(feedNetworkDataResult());
      }
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(6);
      expect(articleStore.store).toHaveBeenCalledTimes(6);
    });
  });

  it('restores a cached station snapshot while its store query is still pending', async () => {
    const techArticles = [
      createArticle('tech-1', 'feed-tech'),
      createArticle('tech-2', 'feed-tech'),
    ];
    const devArticles = [createArticle('dev-1', 'feed-dev')];
    const techReloadDeferred = createDeferred<{ articles: Article[]; total: number }>();
    let techQueryCount = 0;

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'Tech') return Promise.resolve(['feed-tech']);
      if (tagName === 'Dev') return Promise.resolve(['feed-dev']);
      return Promise.resolve([]);
    });
    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-tech') || query.tagName === 'Tech') {
        techQueryCount += 1;
        if (techQueryCount <= 2) {
          return Promise.resolve({ articles: techArticles, total: 200 });
        }
        return techReloadDeferred.promise;
      }
      if (query.feedIds?.includes('feed-dev') || query.tagName === 'Dev') {
        return Promise.resolve({ articles: devArticles, total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('Tech');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['tech-1', 'tech-2']);
    });

    await act(async () => {
      void latestContext!.selectTag('Dev');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['dev-1']);
    });

    await act(async () => {
      void latestContext!.selectTag('Tech');
    });

    await waitForExpectation(() => {
      expect(techQueryCount).toBeGreaterThanOrEqual(1);
      expect(latestContext!.selectedTag).toBe('Tech');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['tech-1', 'tech-2']);
    });

    await act(async () => {
      techReloadDeferred.resolve({ articles: techArticles, total: 200 });
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  it('defers station feed persistence until scrolling is idle', async () => {
    const stationArticles = [createArticle('station-1', 'feed-a')];
    const fetchDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as vi.Mock).mockResolvedValue([stationFeed('feed-a')]);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue({
      id: 'feed-a',
      url: 'https://feed-a.example.com/rss.xml',
      title: 'Feed A',
      lastFetched: null,
    });
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: stationArticles, total: 1 });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockImplementationOnce(() => fetchDeferred.promise);

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('Station');
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: false,
        isAtTop: false,
        anchorHash: 'station-1',
        isScrolling: true,
      });
    });

    fetchDeferred.resolve(feedNetworkDataResult());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(articleStore.store).not.toHaveBeenCalled();

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
      expect(articleStore.store).toHaveBeenCalledTimes(1);
    }, 1000);
  });

  it('prevents concurrent load-more requests from duplicating articles', async () => {
    // Simulate rapid bottom-scroll events calling loadMore repeatedly before
    // loading state has propagated to consumers.
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];
    const nextPageDeferred = createDeferred<{ articles: Article[]; total: number }>();

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.cursor?.hash === 'hash-2') {
        return nextPageDeferred.promise;
      }
      return Promise.resolve({ articles: initialArticles, total: 4 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    await act(async () => {
      void latestContext!.loadMoreArticles();
      void latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      const loadMoreCalls = (articleStore.query as vi.Mock).mock.calls.filter(
        ([query]) => query.cursor?.hash === 'hash-2'
      );
      expect(loadMoreCalls).toHaveLength(1);
      expect(loadMoreCalls[0][0]).toEqual(expect.objectContaining({
        limit: 100,
        includeTotal: false,
      }));
    });

    nextPageDeferred.resolve({
      articles: [
        createArticle('hash-2', 'feed-a'),
        createArticle('hash-3', 'feed-a'),
        createArticle('hash-4', 'feed-a'),
      ],
      total: 4,
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual([
        'hash-1',
        'hash-2',
        'hash-3',
        'hash-4',
      ]);
      expect(latestContext!.isLoadingMoreArticles).toBe(false);
    });
  });

  it('keeps loadMoreArticles identity stable across APPEND', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.cursor?.hash === 'hash-2') {
        return Promise.resolve({
          articles: [
            createArticle('hash-3', 'feed-a'),
            createArticle('hash-4', 'feed-a'),
          ],
          total: 6,
        });
      }
      if (query.cursor?.hash === 'hash-4') {
        return Promise.resolve({
          articles: [
            createArticle('hash-5', 'feed-a'),
            createArticle('hash-6', 'feed-a'),
          ],
          total: 6,
        });
      }
      return Promise.resolve({ articles: initialArticles, total: 6 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    const loadMoreBeforeAppend = latestContext!.loadMoreArticles;

    await act(async () => {
      await latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual([
        'hash-1',
        'hash-2',
        'hash-3',
        'hash-4',
      ]);
    });

    expect(latestContext!.loadMoreArticles).toBe(loadMoreBeforeAppend);

    await act(async () => {
      await latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual([
        'hash-1',
        'hash-2',
        'hash-3',
        'hash-4',
        'hash-5',
        'hash-6',
      ]);
    });

    const secondPageCalls = (articleStore.query as vi.Mock).mock.calls.filter(
      ([query]) => query.cursor?.hash === 'hash-4',
    );
    expect(secondPageCalls).toHaveLength(1);
    expect(latestContext!.loadMoreArticles).toBe(loadMoreBeforeAppend);
  });

  it('keeps loadMoreArticles identity stable across APPEND', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.cursor?.hash === 'hash-2') {
        return Promise.resolve({
          articles: [
            createArticle('hash-3', 'feed-a'),
            createArticle('hash-4', 'feed-a'),
          ],
          total: 6,
        });
      }
      if (query.cursor?.hash === 'hash-4') {
        return Promise.resolve({
          articles: [
            createArticle('hash-5', 'feed-a'),
            createArticle('hash-6', 'feed-a'),
          ],
          total: 6,
        });
      }
      return Promise.resolve({ articles: initialArticles, total: 6 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    const loadMoreBeforeAppend = latestContext!.loadMoreArticles;

    await act(async () => {
      await latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual([
        'hash-1',
        'hash-2',
        'hash-3',
        'hash-4',
      ]);
    });

    expect(latestContext!.loadMoreArticles).toBe(loadMoreBeforeAppend);

    await act(async () => {
      await latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual([
        'hash-1',
        'hash-2',
        'hash-3',
        'hash-4',
        'hash-5',
        'hash-6',
      ]);
    });

    const secondPageCalls = (articleStore.query as vi.Mock).mock.calls.filter(
      ([query]) => query.cursor?.hash === 'hash-4',
    );
    expect(secondPageCalls).toHaveLength(1);
    expect(latestContext!.loadMoreArticles).toBe(loadMoreBeforeAppend);
  });

  it('keeps prefetch pagination off the visible loading flag', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];
    const nextPageDeferred = createDeferred<{ articles: Article[]; total: number }>();

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.cursor?.hash === 'hash-2') {
        return nextPageDeferred.promise;
      }
      return Promise.resolve({ articles: initialArticles, total: 3 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    await act(async () => {
      void latestContext!.loadMoreArticles({ showLoadingIndicator: false });
    });

    await waitForExpectation(() => {
      const loadMoreCalls = (articleStore.query as vi.Mock).mock.calls.filter(
        ([query]) => query.cursor?.hash === 'hash-2'
      );
      expect(loadMoreCalls).toHaveLength(1);
    });
    expect(latestContext!.isLoadingMoreArticles).toBe(false);

    nextPageDeferred.resolve({
      articles: [createArticle('hash-3', 'feed-a')],
      total: 3,
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2', 'hash-3']);
      expect(latestContext!.isLoadingMoreArticles).toBe(false);
    });
  });

  it('appends prefetched rows immediately without showing the load-more indicator', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];
    const nextPageDeferred = createDeferred<{ articles: Article[]; total: number }>();

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.cursor?.hash === 'hash-2') {
        return nextPageDeferred.promise;
      }
      return Promise.resolve({ articles: initialArticles, total: 3 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    act(() => {
      latestContext!.syncArticleListViewport({
        isSearchActive: false,
        isAtTop: false,
        anchorHash: 'hash-2',
        isScrolling: true,
      });
    });

    await act(async () => {
      void latestContext!.loadMoreArticles({ showLoadingIndicator: false });
    });

    nextPageDeferred.resolve({
      articles: [createArticle('hash-3', 'feed-a')],
      total: 3,
    });

    await waitForExpectation(() => {
      const loadMoreCalls = (articleStore.query as vi.Mock).mock.calls.filter(
        ([query]) => query.cursor?.hash === 'hash-2'
      );
      expect(loadMoreCalls).toHaveLength(1);
    });
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2', 'hash-3']);
      expect(latestContext!.isLoadingMoreArticles).toBe(false);
    });
  });

  it('searches the current source in the store and paginates matching rows', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];
    const searchArticles = [
      createArticle('needle-1', 'feed-a'),
      createArticle('needle-2', 'feed-b'),
    ];
    const nextSearchArticle = createArticle('needle-3', 'feed-c');

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.searchText === 'needle' && query.cursor?.hash === 'needle-2') {
        return Promise.resolve({ articles: [nextSearchArticle], total: 3 });
      }
      if (query.searchText === 'needle') {
        return Promise.resolve({ articles: searchArticles, total: 3 });
      }
      return Promise.resolve({ articles: initialArticles, total: 4 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    await act(async () => {
      await latestContext!.searchCurrentSource('needle');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['needle-1', 'needle-2']);
      expect(latestContext!.articlesTotalCount).toBe(3);
    });

    expect(articleStore.query).toHaveBeenCalledWith(expect.objectContaining({
      limit: 100,
      searchText: 'needle',
      sort: { field: 'publishedDate', order: 'desc' },
    }));

    await act(async () => {
      await latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['needle-1', 'needle-2', 'needle-3']);
    });

    expect(articleStore.query).toHaveBeenCalledWith(expect.objectContaining({
      cursor: {
        effectiveDate: '2026-02-25T00:00:00.000Z',
        hash: 'needle-2',
      },
      limit: 100,
      includeTotal: false,
      searchText: 'needle',
    }));
  });

  it('does not set blocking article-list loading flags while search is pending', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];
    const searchDeferred = createDeferred<{ articles: Article[]; total: number }>();

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.searchText === 'needle') {
        return searchDeferred.promise;
      }
      return Promise.resolve({ articles: initialArticles, total: 2 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
    });

    await act(async () => {
      void latestContext!.searchCurrentSource('needle');
    });

    await waitForExpectation(() => {
      expect(articleStore.query).toHaveBeenCalledWith(expect.objectContaining({ searchText: 'needle' }));
    });

    expect(latestContext!.isLoadingArticles).toBe(false);
    expect(latestContext!.isSavedListLoading).toBe(false);
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);

    searchDeferred.resolve({
      articles: [createArticle('needle-1', 'feed-a')],
      total: 1,
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['needle-1']);
    });
  });

  it('restores the cached non-search list immediately while clear-search reload is pending', async () => {
    const initialArticles = [
      createArticle('hash-1', 'feed-a'),
      createArticle('hash-2', 'feed-a'),
    ];
    const searchArticles = [createArticle('needle-1', 'feed-a')];
    const clearDeferred = createDeferred<{ articles: Article[]; total: number }>();
    let nonSearchQueryCount = 0;

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.searchText === 'needle') {
        return Promise.resolve({ articles: searchArticles, total: 1 });
      }

      nonSearchQueryCount += 1;
      if (nonSearchQueryCount === 1) {
        return Promise.resolve({ articles: initialArticles, total: 4 });
      }
      return clearDeferred.promise;
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
      expect(latestContext!.articlesTotalCount).toBe(4);
    });

    await act(async () => {
      await latestContext!.searchCurrentSource('needle');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['needle-1']);
      expect(latestContext!.articlesTotalCount).toBe(1);
    });

    await act(async () => {
      void latestContext!.clearArticleListSearch();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1', 'hash-2']);
      expect(latestContext!.articlesTotalCount).toBe(4);
    });

    clearDeferred.resolve({
      articles: [createArticle('hash-1-fresh', 'feed-a'), createArticle('hash-2-fresh', 'feed-a')],
      total: 5,
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-1-fresh', 'hash-2-fresh']);
      expect(latestContext!.articlesTotalCount).toBe(5);
    });
  });

  it('clears stale feed refresh loading when switching to All Items', async () => {
    const fetchDeferred = createDeferred<never>();
    const feedArticles = [createArticle('hash-feed', 'feed-a')];
    const allArticles = [createArticle('hash-all', 'feed-b')];

    (feedStore.getById as vi.Mock).mockImplementation((id) => {
      if (id === 'feed-a') return Promise.resolve({ id: 'feed-a', url: 'url-a', lastFetched: null });
      return Promise.resolve(null);
    });

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-a')) {
        return Promise.resolve({ articles: feedArticles, total: 1 });
      }
      return Promise.resolve({ articles: allArticles, total: 1 });
    });

    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockReturnValue(fetchDeferred.promise);

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectFeed('feed-a', 'url-a', 'Feed A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedFeedId).toBe('feed-a');
    });

    await act(async () => {
      await latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('all');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-all']);
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.isSavedListLoading).toBe(false);
    });
  });

  it('clears stale feed refresh loading when switching to Saved', async () => {
    const fetchDeferred = createDeferred<never>();
    const feedArticles = [createArticle('hash-feed', 'feed-a')];
    const savedArticles = [createArticle('hash-saved', 'saved')];

    (feedStore.getById as vi.Mock).mockImplementation((id) => {
      if (id === 'feed-a') return Promise.resolve({ id: 'feed-a', url: 'url-a', lastFetched: null });
      return Promise.resolve(null);
    });

    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-a')) {
        return Promise.resolve({ articles: feedArticles, total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockReturnValue(fetchDeferred.promise);
    (savedArticlesService.querySavedViewArticles as vi.Mock).mockResolvedValue({ articles: savedArticles, total: 1 });
    (savedArticlesService.enrichSavedViewArticlesMeta as vi.Mock).mockResolvedValue(savedArticles);

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectFeed('feed-a', 'url-a', 'Feed A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedFeedId).toBe('feed-a');
    });

    await act(async () => {
      await latestContext!.selectSmartView('saved');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('saved');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-saved']);
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.isSavedListLoading).toBe(false);
    });
  });

  it('does not let a stale station feed lookup block All Items', async () => {
    const stationFeedsDeferred = createDeferred<string[]>();
    const allArticles = [createArticle('hash-all', 'feed-b')];

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'A') return stationFeedsDeferred.promise;
      return Promise.resolve([]);
    });
    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-a') || query.tagName === 'A') {
        return Promise.resolve({ articles: [createArticle('hash-stale', 'feed-a')], total: 1 });
      }
      return Promise.resolve({ articles: allArticles, total: 1 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(tagsManager.getFeedsByTag).toHaveBeenCalledWith('A');
    });

    await act(async () => {
      void latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('all');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-all']);
      expect(latestContext!.isLoadingArticles).toBe(false);
    });

    stationFeedsDeferred.resolve(['feed-a']);
    await act(async () => {
      await Promise.resolve();
    });

    expect(latestContext!.selectedSmartView).toBe('all');
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-all']);
    expect((articleStore.query as vi.Mock).mock.calls.some(([query]) => query.tagName === 'A')).toBe(false);
    expect(feedsManager.getFeedById).not.toHaveBeenCalled();
  });

  it('clears stale station refresh loading when switching to All Items', async () => {
    const fetchDeferred = createDeferred<never>();
    const stationArticles = [createArticle('hash-station', 'feed-a')];
    const allArticles = [createArticle('hash-all', 'feed-b')];

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockImplementation((id: string) => {
      if (id === 'feed-a') return Promise.resolve({ id: 'feed-a', url: 'url-a', lastFetched: null });
      return Promise.resolve(null);
    });
    (articleStore.query as vi.Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.feedIds?.includes('feed-a') || query.tagName === 'A') {
        return Promise.resolve({ articles: stationArticles, total: 1 });
      }
      return Promise.resolve({ articles: allArticles, total: 1 });
    });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockReturnValue(fetchDeferred.promise);

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-station']);
    });

    await act(async () => {
      void latestContext!.selectSmartView('all');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('all');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-all']);
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.isSavedListLoading).toBe(false);
    });
  });

  it('clears skeleton after rapid cold station hops settle on the final station', async () => {
    const stationArticles: Record<string, Article[]> = {
      A: [createArticle('hash-a', 'feed-a')],
      B: [createArticle('hash-b', 'feed-b')],
      C: [createArticle('hash-c', 'feed-c')],
    };

    (tagsManager.getFeedsByTag as Mock).mockImplementation((tagName: string) => (
      Promise.resolve([`feed-${tagName.toLowerCase()}`])
    ));
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      const tagName = query.tagName;
      if (tagName && stationArticles[tagName]) {
        const articles = stationArticles[tagName];
        return Promise.resolve({ articles, total: articles.length });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
      void latestContext!.selectTag('B');
      await latestContext!.selectTag('C');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('C');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-c']);
    });
  });

  it('recovers skeleton when the first deferred SQLite attempt fails during rapid hops', async () => {
    let coldQueryAttempts = 0;

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        coldQueryAttempts += 1;
        if (coldQueryAttempts === 1) {
          return Promise.reject(new Error('sqlite busy'));
        }
        return Promise.resolve({
          articles: [createArticle('hash-a', 'feed-a')],
          total: 1,
        });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
      void latestContext!.selectTag('B');
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a']);
      expect(coldQueryAttempts).toBeGreaterThanOrEqual(2);
    }, 3000);
  });

  it('never renders an empty 0-count list between cold-switch skeleton and deferred rows', async () => {
    // Regression: the deferred SQLite commit published rows in a React
    // transition but cleared isLoadingArticles urgently, so the skeleton
    // dropped while articles was still [] — an empty "0 articles" flash.
    const stateHistory: Array<{ isLoadingArticles: boolean; articleCount: number }> = [];

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        return Promise.resolve({
          articles: [createArticle('hash-a', 'feed-a')],
          total: 1,
        });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    const HistoryProbe: React.FC = () => {
      latestContext = useFeed();
      stateHistory.push({
        isLoadingArticles: latestContext.isLoadingArticles,
        articleCount: latestContext.articles.length,
      });
      return null;
    };

    act(() => {
      root.render(
        <FeedProvider>
          <HistoryProbe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a']);
    });

    const skeletonIndex = stateHistory.findIndex((state) => state.isLoadingArticles);
    expect(skeletonIndex).toBeGreaterThanOrEqual(0);
    const emptyListAfterSkeleton = stateHistory
      .slice(skeletonIndex + 1)
      .filter((state) => !state.isLoadingArticles && state.articleCount === 0);
    expect(emptyListAfterSkeleton).toEqual([]);
  });

  it('keeps skeleton when Phase B finishes before slow cold deferred SQLite', async () => {
    // Production race (2026-07-14 logs): Phase B network finally cleared
    // isLoadingArticles while sqlite-query-deferred was still in flight, so the
    // UI flashed an empty "0 articles" list until the DB page landed. Also
    // keep the scheduler pause so a resumed background cycle cannot starve the
    // Phase A read.
    const stateHistory: Array<{ isLoadingArticles: boolean; articleCount: number }> = [];
    const coldDeferred = createDeferred<{ articles: Article[]; total: number }>();
    let tagAQueryCount = 0;

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: new Date() }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: new Date() }),
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        tagAQueryCount += 1;
        // Phase A deferred page always sets includeTotal: false (H12). Phase B
        // reconcile does not — hang only the cold path so network can finish first.
        if (query.includeTotal === false) {
          return coldDeferred.promise;
        }
        return Promise.resolve({ articles: [], total: 0 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    const HistoryProbe: React.FC = () => {
      latestContext = useFeed();
      stateHistory.push({
        isLoadingArticles: latestContext.isLoadingArticles,
        articleCount: latestContext.articles.length,
      });
      return null;
    };

    act(() => {
      root.render(
        <FeedProvider>
          <HistoryProbe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(true);
      expect(latestContext!.articles).toEqual([]);
      expect(tagAQueryCount).toBeGreaterThanOrEqual(1);
    });

    // Let Phase B paint-gate + debounce + reconcile settle while Phase A hangs.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(latestContext!.isLoadingArticles).toBe(true);
    expect(latestContext!.articles).toEqual([]);
    const skeletonIndex = stateHistory.findIndex((state) => state.isLoadingArticles);
    expect(skeletonIndex).toBeGreaterThanOrEqual(0);
    const emptyWhileWaiting = stateHistory
      .slice(skeletonIndex + 1)
      .filter((state) => !state.isLoadingArticles && state.articleCount === 0);
    expect(emptyWhileWaiting).toEqual([]);

    coldDeferred.resolve({
      articles: [createArticle('hash-a', 'feed-a')],
      total: 1,
    });

    await waitForExpectation(() => {
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a']);
    });

    const emptyAfterSkeleton = stateHistory
      .slice(skeletonIndex + 1)
      .filter((state) => !state.isLoadingArticles && state.articleCount === 0);
    expect(emptyAfterSkeleton).toEqual([]);
  });

  it('holds the import switch skeleton until first fetched rows publish', async () => {
    // OPML import inserts feed metadata only, so the cold switch into the
    // imported station commits an empty deferred SQLite page. Phase B awaits
    // the first fetch for import switches; the skeleton must stay up (no
    // empty "0 articles" view) until those fetched rows publish.
    const stateHistory: Array<{ isLoadingArticles: boolean; articleCount: number }> = [];
    const fetchDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();
    const committedRows: Article[] = [];

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: null }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: null }),
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        return Promise.resolve({ articles: [...committedRows], total: committedRows.length });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });
    (articleStore.store as Mock).mockImplementation((_feedId: string, articles: Article[]) => {
      committedRows.push(...articles);
      return Promise.resolve(articles.length);
    });
    (convertFeedItemsToArticles as Mock).mockResolvedValue([createArticle('hash-a', 'feed-a')]);
    (feedsFetcher.fetchFeedNetworkWithCache as Mock).mockImplementation(() => fetchDeferred.promise);

    const HistoryProbe: React.FC = () => {
      latestContext = useFeed();
      stateHistory.push({
        isLoadingArticles: latestContext.isLoadingArticles,
        articleCount: latestContext.articles.length,
      });
      return null;
    };

    act(() => {
      root.render(
        <FeedProvider>
          <HistoryProbe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A', { awaitInitialFetch: true });
    });

    // Let Phase A commit the empty page and Phase B reach the awaited fetch.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(latestContext!.selectedTag).toBe('A');
    expect(latestContext!.isLoadingArticles).toBe(true);
    expect(latestContext!.articles).toEqual([]);
    expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    const skeletonIndex = stateHistory.findIndex((state) => state.isLoadingArticles);
    expect(skeletonIndex).toBeGreaterThanOrEqual(0);
    const emptyWhileWaiting = stateHistory
      .slice(skeletonIndex + 1)
      .filter((state) => !state.isLoadingArticles && state.articleCount === 0);
    expect(emptyWhileWaiting).toEqual([]);

    await act(async () => {
      fetchDeferred.resolve(feedNetworkDataResult());
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a']);
    });

    const emptyAfterSkeleton = stateHistory
      .slice(skeletonIndex + 1)
      .filter((state) => !state.isLoadingArticles && state.articleCount === 0);
    expect(emptyAfterSkeleton).toEqual([]);
  });

  it('lets a newer switch supersede the import switch fetch wait', async () => {
    // Switching away while the awaited import fetch is still in flight must
    // supersede the import attempt: the new source owns the list and the late
    // fetch result cannot clear the new source's rows.
    const fetchDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();

    (tagsManager.getFeedsByTag as Mock).mockImplementation((tagName: string) =>
      Promise.resolve([`feed-${tagName.toLowerCase()}`])
    );
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: null }),
      stationFeed('feed-b', { lastFetched: null }),
    ]);
    (feedsManager.getFeedById as Mock).mockImplementation((feedId: string) =>
      Promise.resolve(stationFeed(feedId, { lastFetched: null }))
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'B') {
        return Promise.resolve({
          articles: [createArticle('hash-b', 'feed-b')],
          total: 1,
        });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });
    (feedsFetcher.fetchFeedNetworkWithCache as Mock).mockImplementation(() => fetchDeferred.promise);

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A', { awaitInitialFetch: true });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(latestContext!.selectedTag).toBe('A');
    expect(latestContext!.isLoadingArticles).toBe(true);
    expect(latestContext!.articles).toEqual([]);

    await act(async () => {
      void latestContext!.selectTag('B');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('B');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b']);
    });

    await act(async () => {
      fetchDeferred.resolve(feedNetworkDataResult());
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestContext!.selectedTag).toBe('B');
    expect(latestContext!.isLoadingArticles).toBe(false);
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b']);
  });

  it('clears the import skeleton to an honest empty view when the first fetch yields no rows', async () => {
    // The awaited import fetch can legitimately return nothing (all feeds
    // failed or empty). The skeleton must then clear onto the honest empty
    // view once Phase B settles — without any timeout.
    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: null }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: null }),
    );

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A', { awaitInitialFetch: true });
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles).toEqual([]);
    }, 5000);
  });

  it('reconciles concurrent-cycle commits when the awaited import fetch inserts nothing', async () => {
    // Dedup race (production 2026-07-29): the awaited Phase B fetch reported
    // 0 inserts because a concurrent import-boost background cycle committed
    // the same rows first (insert dedup by hash). The settle must reconcile
    // SQLite and publish those rows instead of the honest empty view.
    let rowsCommitted = false;

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: null }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: null }),
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A' && rowsCommitted) {
        return Promise.resolve({ articles: [createArticle('hash-a', 'feed-a')], total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });
    (articleStore.store as Mock).mockImplementation(() => {
      rowsCommitted = true;
      return Promise.resolve(0);
    });
    (convertFeedItemsToArticles as Mock).mockResolvedValue([createArticle('hash-a', 'feed-a')]);

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A', { awaitInitialFetch: true });
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a']);
    }, 5000);
  });

  it('skips Phase B reconcile query while cold deferred SQLite owns the skeleton', async () => {
    // Production (2026-07-14 Tech): Phase B reconcile (includeTotal:true) raced
    // the deferred page and stretched sqlite-query-deferred to ~6s. Cold Phase A
    // must be the only DB reader until it publishes.
    const coldDeferred = createDeferred<{ articles: Article[]; total: number }>();
    let tagAQueryCount = 0;
    let reconcileStyleQueryCount = 0;

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: new Date() }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: new Date() }),
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        tagAQueryCount += 1;
        if (query.includeTotal === false) {
          return coldDeferred.promise;
        }
        reconcileStyleQueryCount += 1;
        return Promise.resolve({ articles: [], total: 0 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(true);
      expect(tagAQueryCount).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(latestContext!.isLoadingArticles).toBe(true);
    expect(reconcileStyleQueryCount).toBe(0);

    coldDeferred.resolve({
      articles: [createArticle('hash-a', 'feed-a')],
      total: 1,
    });

    await waitForExpectation(() => {
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a']);
    });

    expect(reconcileStyleQueryCount).toBe(0);
  });

  it('COUNTs after a full cold first page without killing load-more', async () => {
    const coldDeferred = createDeferred<{ articles: Article[]; total: number }>();
    let reconcileStyleQueryCount = 0;
    const firstPage = Array.from({ length: 100 }, (_, index) => (
      createArticle(`hash-full-${index}`, 'feed-a')
    ));

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: new Date() }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: new Date() }),
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        if (query.includeTotal === false) {
          return coldDeferred.promise;
        }
        reconcileStyleQueryCount += 1;
        return Promise.resolve({ articles: firstPage.slice(0, 1), total: 500 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(true);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(reconcileStyleQueryCount).toBe(0);

    coldDeferred.resolve({
      articles: firstPage,
      total: 0,
    });

    await waitForExpectation(() => {
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles).toHaveLength(100);
      expect(latestContext!.articlesTotalKnown).toBe(true);
      expect(latestContext!.articlesTotalCount).toBe(500);
      expect(reconcileStyleQueryCount).toBeGreaterThanOrEqual(1);
    }, 5000);
  });

  it('publishes first fetched rows after an import switch and keeps them when switching back', async () => {
    // Full user flow: OPML import switches into a station whose feeds have no
    // stored rows; Phase B fetches commit rows which must publish; hopping away
    // and back must keep the list visible (no flash back to an empty view).
    const stateHistory: Array<{ isLoadingArticles: boolean; articleCount: number }> = [];
    const db: Record<string, Article[]> = { 'feed-a': [], 'feed-b': [createArticle('hash-b', 'feed-b')] };

    (tagsManager.getFeedsByTag as Mock).mockImplementation((tagName: string) =>
      Promise.resolve(tagName === 'A' ? ['feed-a'] : ['feed-b'])
    );
    (feedStore.getAll as Mock).mockResolvedValue([stationFeed('feed-a'), stationFeed('feed-b')]);
    (feedsManager.getFeedById as Mock).mockImplementation((feedId: string) =>
      Promise.resolve(stationFeed(feedId, { lastFetched: null }))
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        return Promise.resolve({ articles: db['feed-a'], total: db['feed-a'].length });
      }
      if (query.tagName === 'B') {
        return Promise.resolve({ articles: db['feed-b'], total: db['feed-b'].length });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });
    (articleStore.store as Mock).mockImplementation((feedId: string, articles: Article[]) => {
      db[feedId] = articles;
      return Promise.resolve(articles.length);
    });
    (convertFeedItemsToArticles as Mock).mockImplementation((_items: unknown, options: { feedId: string }) =>
      Promise.resolve([createArticle(`hash-${options.feedId}-1`, options.feedId)])
    );
    (feedsFetcher.fetchFeedNetworkWithCache as Mock).mockResolvedValue(feedNetworkDataResult());

    const HistoryProbe: React.FC = () => {
      latestContext = useFeed();
      stateHistory.push({
        isLoadingArticles: latestContext.isLoadingArticles,
        articleCount: latestContext.articles.length,
      });
      return null;
    };

    act(() => {
      root.render(
        <FeedProvider>
          <HistoryProbe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A', { awaitInitialFetch: true });
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-feed-a-1']);
    }, 5000);

    await act(async () => {
      void latestContext!.selectTag('B');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b']);
    });

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-feed-a-1']);
    });

    // The list must never fall back to an empty view once rows are visible.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(latestContext!.selectedTag).toBe('A');
    expect(latestContext!.isLoadingArticles).toBe(false);
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-feed-a-1']);
  });

  it('shows skeleton on a cold smart view switch and clears it once the query lands', async () => {
    const unreadDeferred = createDeferred<{ articles: Article[], total: number }>();

    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.filter?.read === false) {
        return unreadDeferred.promise;
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectSmartView('unread');
    });

    // Immediate paint: cold smart view resets to skeleton without waiting on
    // the store query.
    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('unread');
      expect(latestContext!.isLoadingArticles).toBe(true);
      expect(latestContext!.articles).toEqual([]);
    });

    unreadDeferred.resolve({ articles: [createArticle('hash-unread', 'feed-a')], total: 1 });

    await waitForExpectation(() => {
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-unread']);
    });
  });

  it('restores a cached smart view snapshot while its fresh query is still pending', async () => {
    const unreadArticles = [createArticle('hash-unread', 'feed-a')];
    let unreadQueryCount = 0;
    const secondUnreadDeferred = createDeferred<{ articles: Article[], total: number }>();

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-b']);
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.filter?.read === false) {
        unreadQueryCount += 1;
        if (unreadQueryCount === 1) {
          return Promise.resolve({ articles: unreadArticles, total: 1 });
        }
        return secondUnreadDeferred.promise;
      }
      if (query.tagName === 'B') {
        return Promise.resolve({ articles: [createArticle('hash-b', 'feed-b')], total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    // Warm the smart view snapshot, hop away, then come back while the fresh
    // unread query hangs.
    await act(async () => {
      await latestContext!.selectSmartView('unread');
    });
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-unread']);
    });

    await act(async () => {
      await latestContext!.selectTag('B');
    });
    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('B');
    });

    await act(async () => {
      void latestContext!.selectSmartView('unread');
    });

    // Snapshot restore paints the cached rows immediately with no skeleton.
    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('unread');
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-unread']);
    });

    secondUnreadDeferred.resolve({ articles: unreadArticles, total: 1 });
    await waitForExpectation(() => {
      expect(latestContext!.isLoadingArticles).toBe(false);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-unread']);
    });
  });

  it('does not stamp a station COUNT onto an in-flight search list', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => (
      createArticle(`hash-full-${index}`, 'feed-a')
    ));
    const searchArticles = [createArticle('needle-1', 'feed-a')];
    const countDeferred = createDeferred<{ articles: Article[]; total: number }>();

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: new Date() }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: new Date() }),
    );
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.searchText === 'needle') {
        return Promise.resolve({ articles: searchArticles, total: 1 });
      }
      if (query.tagName === 'A') {
        if (query.includeTotal === false) {
          return Promise.resolve({ articles: firstPage, total: 0 });
        }
        if (query.includeTotal === true) {
          return countDeferred.promise;
        }
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles).toHaveLength(100);
      expect(latestContext!.articlesTotalKnown).toBe(false);
    });

    await waitForExpectation(() => {
      expect(articleStore.query).toHaveBeenCalledWith(expect.objectContaining({
        includeTotal: true,
        limit: 1,
        tagName: 'A',
      }));
    });

    await act(async () => {
      await latestContext!.searchCurrentSource('needle');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['needle-1']);
      expect(latestContext!.articlesTotalCount).toBe(1);
    });

    countDeferred.resolve({ articles: firstPage.slice(0, 1), total: 500 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['needle-1']);
    expect(latestContext!.articlesTotalCount).toBe(1);
  });

  it('reissues a total-only COUNT on Cmd+R even if Phase B fails', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => (
      createArticle(`hash-full-${index}`, 'feed-a')
    ));
    const countDeferreds: Array<ReturnType<typeof createDeferred<{ articles: Article[]; total: number }>>> = [];

    (tagsManager.getFeedsByTag as Mock).mockResolvedValue(['feed-a']);
    (feedStore.getAll as Mock).mockResolvedValue([
      stationFeed('feed-a', { lastFetched: new Date() }),
    ]);
    (feedsManager.getFeedById as Mock).mockResolvedValue(
      stationFeed('feed-a', { lastFetched: new Date() }),
    );
    (feedsFetcher.fetchFeedNetworkWithCache as Mock).mockRejectedValue(new Error('network down'));
    (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
      if (query.tagName === 'A') {
        if (query.includeTotal === false) {
          return Promise.resolve({ articles: firstPage, total: 0 });
        }
        if (query.includeTotal === true) {
          const deferred = createDeferred<{ articles: Article[]; total: number }>();
          countDeferreds.push(deferred);
          return deferred.promise;
        }
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles).toHaveLength(100);
      expect(latestContext!.articlesTotalKnown).toBe(false);
      expect(countDeferreds.length).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      await latestContext!.refreshFeed();
    });

    await waitForExpectation(() => {
      expect(countDeferreds.length).toBeGreaterThanOrEqual(2);
    });

    countDeferreds.forEach((deferred) => {
      deferred.resolve({ articles: firstPage.slice(0, 1), total: 500 });
    });

    await waitForExpectation(() => {
      expect(latestContext!.articlesTotalKnown).toBe(true);
      expect(latestContext!.articlesTotalCount).toBe(500);
    });
  });

  describe('post-clear source reload', () => {
    const powderArticles = [createArticle('hash-powder', 'feed-p')];
    const dailyPreArticles = [
      createArticle('hash-daily-old-1', 'feed-d'),
      createArticle('hash-daily-old-2', 'feed-d'),
    ];
    const dailyPostArticles = [createArticle('hash-daily-new', 'feed-d')];
    const techArticles = [createArticle('hash-tech', 'feed-t')];

    const stubLibrary = () => {
      (feedStore.getById as Mock).mockImplementation((id: string) => {
        if (id === 'feed-p') {
          return Promise.resolve({
            id: 'feed-p',
            url: 'https://powder.example.com/rss.xml',
            title: 'Powderworks',
            lastFetched: new Date(),
          });
        }
        if (id === 'feed-d') {
          return Promise.resolve({
            id: 'feed-d',
            url: 'https://daily.example.com/rss.xml',
            title: 'Daily',
            lastFetched: new Date(),
          });
        }
        if (id === 'feed-t') {
          return Promise.resolve({
            id: 'feed-t',
            url: 'https://tech.example.com/rss.xml',
            title: 'Tech',
            lastFetched: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      (feedsManager.getFeedById as Mock).mockImplementation((id: string) => feedStore.getById(id));
      (tagsManager.getFeedsByTag as Mock).mockImplementation((tag: string) => {
        if (tag === 'Daily') return Promise.resolve(['feed-d']);
        if (tag === 'Tech') return Promise.resolve(['feed-t']);
        return Promise.resolve([]);
      });
    };

    it('stale clear-completion callback publishes the live station, not the start source', async () => {
      stubLibrary();
      let dailyMode: 'pre' | 'post' = 'pre';
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.feedIds?.includes('feed-p')) {
          return Promise.resolve({ articles: powderArticles, total: 1 });
        }
        if (query.tagName === 'Daily') {
          if (dailyMode === 'post') {
            return Promise.resolve({ articles: dailyPostArticles, total: 1 });
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectFeed('feed-p', 'https://powder.example.com/rss.xml', 'Powderworks');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedFeedId).toBe('feed-p');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-powder']);
      });

      const staleReload = latestContext!.reloadCurrentSourceFromStore;

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      dailyMode = 'post';
      await act(async () => {
        await staleReload();
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.selectedFeedId).toBeNull();
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });
    });

    it('stay-on-source clear reload refreshes the current list', async () => {
      stubLibrary();
      let dailyMode: 'pre' | 'post' = 'pre';
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          if (dailyMode === 'post') {
            return Promise.resolve({ articles: dailyPostArticles, total: 1 });
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      dailyMode = 'post';
      await act(async () => {
        await latestContext!.reloadCurrentSourceFromStore();
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });
    });

    it('hop during an in-flight reload does not paint the queried source and follow-up loads the live station', async () => {
      stubLibrary();
      const dailyReloadDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.feedIds?.includes('feed-p')) {
          return Promise.resolve({ articles: powderArticles, total: 1 });
        }
        if (query.tagName === 'Daily') {
          if (hangNextDaily) {
            return dailyReloadDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        if (query.tagName === 'Tech') {
          return Promise.resolve({ articles: techArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectFeed('feed-p', 'https://powder.example.com/rss.xml', 'Powderworks');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-powder']);
      });
      const staleReload = latestContext!.reloadCurrentSourceFromStore;

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      hangNextDaily = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = staleReload();
      });

      await act(async () => {
        await latestContext!.selectTag('Tech');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Tech');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-tech']);
      });

      dailyReloadDeferred.resolve({ articles: dailyPreArticles, total: 2 });
      await act(async () => {
        await reloadPromise;
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Tech');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-tech']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });
    });

    it('does not clear a cold-hop skeleton when a stale reload query settles', async () => {
      stubLibrary();
      const dailyReloadDeferred = createDeferred<{ articles: Article[]; total: number }>();
      const techDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let hangNextDaily = false;
      let hangTech = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          if (hangNextDaily) {
            return dailyReloadDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        if (query.tagName === 'Tech') {
          if (hangTech) {
            return techDeferred.promise;
          }
          return Promise.resolve({ articles: techArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      hangNextDaily = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });

      hangTech = true;
      await act(async () => {
        void latestContext!.selectTag('Tech');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Tech');
        expect(latestContext!.isLoadingArticles).toBe(true);
        expect(latestContext!.articles).toEqual([]);
      });

      dailyReloadDeferred.resolve({ articles: dailyPreArticles, total: 2 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(latestContext!.selectedTag).toBe('Tech');
      expect(latestContext!.isLoadingArticles).toBe(true);
      expect(latestContext!.articles).toEqual([]);

      hangTech = false;
      techDeferred.resolve({ articles: techArticles, total: 1 });
      await act(async () => {
        await reloadPromise;
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Tech');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-tech']);
      });
    });

    it('does not wipe in-flight search results when a stay-on-source reload settles', async () => {
      stubLibrary();
      const reloadDeferred = createDeferred<{ articles: Article[]; total: number }>();
      const searchArticles = [createArticle('hash-daily-search', 'feed-d')];
      let hangUnfilteredDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily' && query.searchText) {
          return Promise.resolve({ articles: searchArticles, total: 1 });
        }
        if (query.tagName === 'Daily') {
          if (hangUnfilteredDaily) {
            return reloadDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      hangUnfilteredDaily = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });

      await act(async () => {
        await latestContext!.searchCurrentSource('needle');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-search']);
      });

      reloadDeferred.resolve({ articles: dailyPostArticles, total: 1 });
      await act(async () => {
        await reloadPromise;
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-search']);
      });
    });

    it('does not re-seed a pre-delete snapshot while the post-clear query is in flight', async () => {
      stubLibrary();
      const dailyReloadDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          if (hangNextDaily) {
            return dailyReloadDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        if (query.tagName === 'Tech') {
          return Promise.resolve({ articles: techArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      hangNextDaily = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });

      await act(async () => {
        await latestContext!.selectTag('Tech');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Tech');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-tech']);
      });

      hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          return Promise.resolve({ articles: dailyPostArticles, total: 1 });
        }
        if (query.tagName === 'Tech') {
          return Promise.resolve({ articles: techArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      await act(async () => {
        void latestContext!.selectTag('Daily');
      });
      expect(latestContext!.articles.map((article) => article.hash)).not.toEqual([
        'hash-daily-old-1',
        'hash-daily-old-2',
      ]);

      dailyReloadDeferred.resolve({ articles: dailyPreArticles, total: 2 });
      await act(async () => {
        await reloadPromise;
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
      });
    });

    it('search-active reload refreshes the unfiltered snapshot used on search exit', async () => {
      stubLibrary();
      const unfilteredDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let hangUnfiltered = false;
      const searchArticles = [createArticle('hash-daily-search', 'feed-d')];
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily' && query.searchText) {
          return Promise.resolve({ articles: searchArticles, total: 1 });
        }
        if (query.tagName === 'Daily') {
          if (hangUnfiltered) {
            return unfilteredDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      await act(async () => {
        await latestContext!.searchCurrentSource('needle');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-search']);
      });

      hangUnfiltered = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-search']);
      });

      unfilteredDeferred.resolve({ articles: dailyPostArticles, total: 1 });
      await act(async () => {
        await reloadPromise;
      });

      await act(async () => {
        await latestContext!.clearArticleListSearch();
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });
    });

    it('does not re-seed a pre-delete snapshot while the post-clear query is in flight', async () => {
      stubLibrary();
      const dailyReloadDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          if (hangNextDaily) {
            return dailyReloadDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        if (query.tagName === 'Tech') {
          return Promise.resolve({ articles: techArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      hangNextDaily = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });

      await act(async () => {
        await latestContext!.selectTag('Tech');
      });
      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Tech');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-tech']);
      });

      hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          return Promise.resolve({ articles: dailyPostArticles, total: 1 });
        }
        if (query.tagName === 'Tech') {
          return Promise.resolve({ articles: techArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      await act(async () => {
        void latestContext!.selectTag('Daily');
      });
      expect(latestContext!.articles.map((article) => article.hash)).not.toEqual([
        'hash-daily-old-1',
        'hash-daily-old-2',
      ]);

      dailyReloadDeferred.resolve({ articles: dailyPreArticles, total: 2 });
      await act(async () => {
        await reloadPromise;
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
      });
    });

    it('search-active reload refreshes the unfiltered snapshot used on search exit', async () => {
      stubLibrary();
      const unfilteredDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let hangUnfiltered = false;
      const searchArticles = [createArticle('hash-daily-search', 'feed-d')];
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily' && query.searchText) {
          return Promise.resolve({ articles: searchArticles, total: 1 });
        }
        if (query.tagName === 'Daily') {
          if (hangUnfiltered) {
            return unfilteredDeferred.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      await act(async () => {
        await latestContext!.searchCurrentSource('needle');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-search']);
      });

      hangUnfiltered = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-search']);
      });

      unfilteredDeferred.resolve({ articles: dailyPostArticles, total: 1 });
      await act(async () => {
        await reloadPromise;
      });

      await act(async () => {
        await latestContext!.clearArticleListSearch();
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });
    });

    it('same-source re-click during reload still lands the post-delete list', async () => {
      stubLibrary();
      const hungReload = createDeferred<{ articles: Article[]; total: number }>();
      let hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          if (hangNextDaily) {
            return hungReload.promise;
          }
          return Promise.resolve({ articles: dailyPreArticles, total: 2 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual([
          'hash-daily-old-1',
          'hash-daily-old-2',
        ]);
      });

      hangNextDaily = true;
      let reloadPromise!: Promise<void>;
      await act(async () => {
        reloadPromise = latestContext!.reloadCurrentSourceFromStore();
      });

      await act(async () => {
        void latestContext!.selectTag('Daily');
      });

      hangNextDaily = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName === 'Daily') {
          return Promise.resolve({ articles: dailyPostArticles, total: 1 });
        }
        return Promise.resolve({ articles: [], total: 0 });
      });
      hungReload.resolve({ articles: dailyPreArticles, total: 2 });
      await act(async () => {
        await reloadPromise;
      });

      await waitForExpectation(() => {
        expect(latestContext!.selectedTag).toBe('Daily');
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });
    });

    it('does not append a pre-delete load-more page after reload publishes', async () => {
      stubLibrary();
      const loadMoreDeferred = createDeferred<{ articles: Article[]; total: number }>();
      const dailyFirstPage = Array.from({ length: 100 }, (_, index) => (
        createArticle(`hash-daily-page-${index}`, 'feed-d')
      ));
      let dailyMode: 'pre' | 'post' = 'pre';
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName !== 'Daily') {
          return Promise.resolve({ articles: [], total: 0 });
        }
        if (query.cursor) {
          return loadMoreDeferred.promise;
        }
        if (dailyMode === 'post') {
          return Promise.resolve({ articles: dailyPostArticles, total: 1 });
        }
        return Promise.resolve({ articles: dailyFirstPage, total: 200 });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles).toHaveLength(100);
      });

      await act(async () => {
        void latestContext!.loadMoreArticles();
      });

      dailyMode = 'post';
      await act(async () => {
        await latestContext!.reloadCurrentSourceFromStore();
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
      });

      loadMoreDeferred.resolve({
        articles: [createArticle('hash-daily-old-3', 'feed-d')],
        total: 100,
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });

      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
      expect(latestContext!.articlesTotalCount).toBe(1);
    });

    it('does not restore a pre-delete COUNT after reload published the new total', async () => {
      stubLibrary();
      const countDeferred = createDeferred<{ articles: Article[]; total: number }>();
      let dailyMode: 'pre' | 'post' = 'pre';
      let holdCount = false;
      (articleStore.query as Mock).mockImplementation((query: MockArticleQuery) => {
        if (query.tagName !== 'Daily') {
          return Promise.resolve({ articles: [], total: 0 });
        }
        if (query.includeTotal === true && query.limit === 1 && holdCount) {
          return countDeferred.promise;
        }
        if (dailyMode === 'post') {
          return Promise.resolve({ articles: dailyPostArticles, total: 1 });
        }
        if (query.includeTotal === false) {
          return Promise.resolve({ articles: Array.from({ length: 100 }, (_, index) => (
            createArticle(`hash-daily-page-${index}`, 'feed-d')
          )), total: 100 });
        }
        return Promise.resolve({
          articles: Array.from({ length: 100 }, (_, index) => (
            createArticle(`hash-daily-page-${index}`, 'feed-d')
          )),
          total: 12300,
        });
      });

      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>
        );
      });
      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        void latestContext!.selectTag('Daily');
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.length).toBeGreaterThan(0);
      });

      holdCount = true;
      dailyMode = 'post';
      await act(async () => {
        await latestContext!.reloadCurrentSourceFromStore();
      });
      await waitForExpectation(() => {
        expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
        expect(latestContext!.articlesTotalCount).toBe(1);
      });

      countDeferred.resolve({ articles: dailyPostArticles.slice(0, 1), total: 12300 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });

      expect(latestContext!.articlesTotalCount).toBe(1);
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-daily-new']);
    });
  });
});
