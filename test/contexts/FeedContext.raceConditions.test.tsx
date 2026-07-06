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
      expect(techQueryCount).toBeGreaterThanOrEqual(2);
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
});
