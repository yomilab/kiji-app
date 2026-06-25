import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedProvider, useFeed } from '@/contexts/FeedContext';
import type { Article } from '@/types/article';
import { tagsManager } from '@/services/tags/tagsManager';
import { convertFeedItemsToArticles } from '@/services/articles/articleConverter';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';
import { feedNetworkDataResult } from '../helpers/feedNetworkFetchMock';

vi.mock('@/stores/articleStore', () => ({
  query: vi.fn(),
  store: vi.fn(),
  getUnreadCount: vi.fn(),
  getArticleCount: vi.fn(),
  syncFeedCountsBatch: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/stores/feedStore', () => ({
  getCount: vi.fn(),
  getById: vi.fn(),
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

describe('FeedContext selectTag', () => {
  let latestContext: ReturnType<typeof useFeed> | null = null;
  let root: Root;
  let container: HTMLDivElement;
  let consoleWarnSpy: vi.SpyInstance;

  const Probe: React.FC = () => {
    latestContext = useFeed();
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
    (feedStore.getCount as vi.Mock).mockResolvedValue(0);
    (feedStore.getById as vi.Mock).mockResolvedValue(null);
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });
    (articleStore.store as vi.Mock).mockResolvedValue(0);
    (articleStore.getUnreadCount as vi.Mock).mockResolvedValue(0);
    (articleStore.getArticleCount as vi.Mock).mockResolvedValue(0);
    (feedsManager.getAllFeeds as vi.Mock).mockResolvedValue([]);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(null);
    (feedsManager.updateFeed as vi.Mock).mockResolvedValue(undefined);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockResolvedValue(feedNetworkDataResult());
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([]);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
    consoleWarnSpy.mockRestore();
  });

  it('clears visible articles immediately when switching stations', async () => {
    const stationAArticles = [createArticle('hash-a1', 'feed-a')];
    const stationBArticles = [createArticle('hash-b1', 'feed-b')];
    const stationBFeedsDeferred = createDeferred<string[]>();

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'A') return Promise.resolve(['feed-a']);
      if (tagName === 'B') return stationBFeedsDeferred.promise;
      return Promise.resolve([]);
    });
    (articleStore.query as vi.Mock).mockImplementation((query: any) => {
      const feedIds = query.feedIds || [];
      const tagName = query.tagName;
      if (tagName === 'A' || (feedIds.includes('feed-a') && !feedIds.includes('feed-b'))) {
        return Promise.resolve({ articles: stationAArticles, total: stationAArticles.length });
      }
      if (tagName === 'B' || (feedIds.includes('feed-b') && !feedIds.includes('feed-a'))) {
        return Promise.resolve({ articles: stationBArticles, total: stationBArticles.length });
      }
      if (feedIds.includes('feed-a') && feedIds.includes('feed-b')) {
        const both = [...stationAArticles, ...stationBArticles];
        return Promise.resolve({ articles: both, total: both.length });
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
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    await act(async () => {
      void latestContext!.selectTag('B');
    });

    expect(latestContext!.selectedTag).toBe('B');
    expect(latestContext!.isLoadingArticles).toBe(true);
    expect(latestContext!.articles).toEqual([]);

    stationBFeedsDeferred.resolve(['feed-b']);
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1']);
      expect(latestContext!.isLoadingArticles).toBe(false);
    });
  });

  it('ignores stale station responses when user switches quickly', async () => {
    const stationAFeedsDeferred = createDeferred<string[]>();
    const stationBArticles = [createArticle('hash-b1', 'feed-b')];

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'A') return stationAFeedsDeferred.promise;
      if (tagName === 'B') return Promise.resolve(['feed-b']);
      return Promise.resolve([]);
    });
    (articleStore.query as vi.Mock).mockImplementation((query: any) => {
      const feedIds = query.feedIds || [];
      const tagName = query.tagName;
      if (tagName === 'B' || (feedIds.includes('feed-b') && !feedIds.includes('feed-a'))) {
        return Promise.resolve({ articles: stationBArticles, total: stationBArticles.length });
      }
      if (tagName === 'A' || (feedIds.includes('feed-a') && !feedIds.includes('feed-b'))) {
        return Promise.resolve({ articles: [createArticle('hash-a1', 'feed-a')], total: 1 });
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

    let pendingStationARequest: Promise<void> | null = null;
    await act(async () => {
      pendingStationARequest = latestContext!.selectTag('A');
    });

    await act(async () => {
      await latestContext!.selectTag('B');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('B');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1']);
    });

    stationAFeedsDeferred.resolve(['feed-a']);
    await act(async () => {
      await pendingStationARequest;
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('B');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1']);
    });
  });

  it('re-triggers fetching when clicking the same station', async () => {
    const feedA = { id: 'feed-a', url: 'https://a.example.com', lastFetched: new Date(0) };
    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(feedA);
    (feedStore.getById as vi.Mock).mockResolvedValue(feedA);
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(feedNetworkDataResult()), 50)));

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    // First click
    await act(async () => {
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isFetchingNew).toBe(false);
    });

    // Second click (same tag)
    await act(async () => {
      void latestContext!.selectTag('A');
    });

    // Should see isFetchingNew become true
    await waitForExpectation(() => {
      expect(latestContext!.isFetchingNew).toBe(true);
    });

    await waitForExpectation(() => {
      expect(latestContext!.isFetchingNew).toBe(false);
    });
  });

  it('publishes station articles after feed batches complete before the full station refresh settles', async () => {
    const feedA = { id: 'feed-a', url: 'https://a.example.com', title: 'Feed A', lastFetched: new Date(0) };
    const feedB = { id: 'feed-b', url: 'https://b.example.com', title: 'Feed B', lastFetched: new Date(0) };
    const fetchADeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();
    const fetchBDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();
    const storedFeedIds = new Set<string>();
    const stationArticles: Record<string, Article[]> = {
      '': [],
      'feed-a': [createArticle('hash-a1', 'feed-a')],
      'feed-a,feed-b': [
        { ...createArticle('hash-b1', 'feed-b'), publishedDate: '2026-02-26T00:00:00.000Z' },
        createArticle('hash-a1', 'feed-a'),
      ],
    };

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a', 'feed-b']);
    (feedsManager.getFeedById as vi.Mock).mockImplementation((id: string) => {
      if (id === 'feed-a') return Promise.resolve(feedA);
      if (id === 'feed-b') return Promise.resolve(feedB);
      return Promise.resolve(null);
    });
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockImplementation((url: string) => {
      if (url === feedA.url) return fetchADeferred.promise;
      if (url === feedB.url) return fetchBDeferred.promise;
      return Promise.resolve(feedNetworkDataResult());
    });
    (convertFeedItemsToArticles as vi.Mock).mockImplementation((_items: any[], ctx: { feedId: string }) => {
      return Promise.resolve(stationArticles[ctx.feedId] ?? []);
    });
    (articleStore.store as vi.Mock).mockImplementation(async (feedId: string) => {
      storedFeedIds.add(feedId);
      return 1;
    });
    (articleStore.query as vi.Mock).mockImplementation((query: any) => {
      if (query.feedIds?.includes('feed-a') || query.tagName === 'A') {
        const key = Array.from(storedFeedIds).sort().join(',');
        return Promise.resolve({
          articles: stationArticles[key] ?? [],
          total: (stationArticles[key] ?? []).length,
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
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.articles).toEqual([]);
      expect(latestContext!.isFetchingNew).toBe(true);
    });

    fetchADeferred.resolve(feedNetworkDataResult());
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
      expect(latestContext!.isFetchingNew).toBe(true);
    });

    fetchBDeferred.resolve(feedNetworkDataResult());
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-b1', 'hash-a1']);
      expect(latestContext!.isFetchingNew).toBe(false);
    });
  });

  it('defers incremental station publishes while the article view is opening', async () => {
    const feedA = { id: 'feed-a', url: 'https://a.example.com', title: 'Feed A', lastFetched: new Date(0) };
    const fetchADeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();
    let hasStoredFeed = false;
    const refreshedArticles = [createArticle('hash-a1', 'feed-a')];

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(feedA);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockReturnValue(fetchADeferred.promise);
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue(refreshedArticles);
    (articleStore.store as vi.Mock).mockImplementation(async () => {
      hasStoredFeed = true;
      return 1;
    });
    (articleStore.query as vi.Mock).mockImplementation((query: any) => {
      if (query.feedIds?.includes('feed-a') || query.tagName === 'A') {
        return Promise.resolve({
          articles: hasStoredFeed ? refreshedArticles : [],
          total: hasStoredFeed ? refreshedArticles.length : 0,
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
      latestContext!.setArticleViewOverlayPhase('opening');
      void latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedTag).toBe('A');
      expect(latestContext!.isFetchingNew).toBe(true);
    });

    fetchADeferred.resolve(feedNetworkDataResult());
    await waitForExpectation(() => {
      expect(articleStore.store).toHaveBeenCalledWith('feed-a', refreshedArticles);
      expect(latestContext!.isFetchingNew).toBe(false);
    });
    expect(latestContext!.articles).toEqual([]);

    await act(async () => {
      latestContext!.setArticleViewOverlayPhase('open');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });
  });

  it('starts station feed refreshes as one batch', async () => {
    const feedIds = ['feed-a', 'feed-b', 'feed-c', 'feed-d'];
    const feeds = feedIds.map((id) => ({
      id,
      url: `https://${id}.example.com`,
      title: id,
      lastFetched: new Date(0),
    }));
    const fetchesByUrl = new Map(feeds.map((feed) => [feed.url, createDeferred<ReturnType<typeof feedNetworkDataResult>>()]));

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(feedIds);
    (feedsManager.getFeedById as vi.Mock).mockImplementation((id: string) => (
      Promise.resolve(feeds.find((feed) => feed.id === id) ?? null)
    ));
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockImplementation((url: string) => {
      const deferred = fetchesByUrl.get(url);
      if (!deferred) {
        return Promise.resolve(feedNetworkDataResult());
      }
      return deferred.promise;
    });
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([]);
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });

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
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(4);
    });

    for (const deferred of fetchesByUrl.values()) {
      deferred.resolve(feedNetworkDataResult());
    }

    await waitForExpectation(() => {
      expect(latestContext!.isFetchingNew).toBe(false);
    });
  });

  it('coalesces repeated refresh requests for the same station', async () => {
    const feedA = { id: 'feed-a', url: 'https://a.example.com', title: 'Feed A', lastFetched: new Date(0) };
    const firstFetchDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();
    const secondFetchDeferred = createDeferred<ReturnType<typeof feedNetworkDataResult>>();

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(feedA);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock)
      .mockImplementationOnce((_url: string, options?: { signal?: AbortSignal }) => new Promise<ReturnType<typeof feedNetworkDataResult>>((resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        options?.signal?.addEventListener('abort', onAbort, { once: true });
        firstFetchDeferred.promise.then(
          (value) => {
            options?.signal?.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error) => {
            options?.signal?.removeEventListener('abort', onAbort);
            reject(error);
          }
        );
      }))
      .mockImplementationOnce(() => secondFetchDeferred.promise);
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([]);
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      void latestContext!.refreshFeed();
      void latestContext!.refreshFeed();
      void latestContext!.refreshFeed();
    });

    expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);

    firstFetchDeferred.resolve(feedNetworkDataResult());
    await act(async () => {
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(2);
    });

    secondFetchDeferred.resolve(feedNetworkDataResult());
    await waitForExpectation(() => {
      expect(latestContext!.isFetchingNew).toBe(false);
    });
  });

  it('records a failed station fetch and backs off on a same-station re-click', async () => {
    const failedFeed = {
      id: 'feed-a',
      url: 'https://a.example.com',
      title: 'Feed A',
      lastFetched: new Date(0),
      consecutiveFailures: 0,
      lastFailedFetchAt: undefined as Date | undefined,
    };

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(failedFeed);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockRejectedValueOnce(new Error('timeout'));
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(feedsManager.updateFeed).toHaveBeenCalledWith('feed-a', expect.objectContaining({
        consecutiveFailures: 1,
        lastFailedFetchAt: expect.any(Date),
      }));
    });

    await act(async () => {
      await latestContext!.selectTag('A');
    });

    expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
  });

  it('retries feeds in failure backoff when switching to a different station', async () => {
    const backedOffFeed = {
      id: 'feed-a',
      url: 'https://a.example.com',
      title: 'Feed A',
      lastFetched: new Date(0),
      consecutiveFailures: 2,
      lastFailedFetchAt: new Date(),
    };

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'A') {
        return Promise.resolve(['feed-a']);
      }
      if (tagName === 'B') {
        return Promise.resolve(['feed-a']);
      }
      return Promise.resolve([]);
    });
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(backedOffFeed);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockResolvedValue(feedNetworkDataResult());
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([]);
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [], total: 0 });

    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await latestContext!.selectTag('B');
    });

    await waitForExpectation(() => {
      expect(feedsFetcher.fetchFeedNetworkWithCache).toHaveBeenCalledTimes(2);
    });
  });

  it('clears failure backoff after a successful station fetch', async () => {
    const recoveredFeed = {
      id: 'feed-a',
      url: 'https://a.example.com',
      title: 'Feed A',
      lastFetched: new Date(0),
      consecutiveFailures: 2,
      lastFailedFetchAt: new Date(Date.now() - (11 * 60_000)),
    };

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(recoveredFeed);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockResolvedValue(feedNetworkDataResult());
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([createArticle('hash-a1', 'feed-a')]);
    (articleStore.query as vi.Mock).mockImplementation((query: any) => {
      if (query.feedIds?.includes('feed-a') || query.tagName === 'A') {
        return Promise.resolve({ articles: [createArticle('hash-a1', 'feed-a')], total: 1 });
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
      await latestContext!.selectTag('A');
    });

    await waitForExpectation(() => {
      expect(feedsManager.updateFeed).toHaveBeenCalledWith('feed-a', expect.objectContaining({
        consecutiveFailures: 0,
        lastFetched: expect.any(Date),
      }));
    });
  });

  it('skips the post-refresh station query when no feeds insert articles', async () => {
    const feedA = { id: 'feed-a', url: 'https://a.example.com', title: 'Feed A', lastFetched: new Date(0) };
    const cachedArticles = [createArticle('hash-a1', 'feed-a')];

    (tagsManager.getFeedsByTag as vi.Mock).mockResolvedValue(['feed-a']);
    (feedsManager.getFeedById as vi.Mock).mockResolvedValue(feedA);
    (feedsFetcher.fetchFeedNetworkWithCache as vi.Mock).mockResolvedValue(feedNetworkDataResult());
    (convertFeedItemsToArticles as vi.Mock).mockResolvedValue([]);
    (articleStore.store as vi.Mock).mockResolvedValue(0);
    (articleStore.query as vi.Mock).mockResolvedValue({
      articles: cachedArticles,
      total: cachedArticles.length,
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
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
      expect(latestContext!.isFetchingNew).toBe(false);
    });

    expect(articleStore.query).toHaveBeenCalledTimes(1);
  });

  it('requests article close through the shared close lifecycle when switching stations', async () => {
    const stationAArticles = [createArticle('hash-a1', 'feed-a')];
    const stationBFeedsDeferred = createDeferred<string[]>();

    (tagsManager.getFeedsByTag as vi.Mock).mockImplementation((tagName: string) => {
      if (tagName === 'A') return Promise.resolve(['feed-a']);
      if (tagName === 'B') return stationBFeedsDeferred.promise;
      return Promise.resolve([]);
    });
    (articleStore.query as vi.Mock).mockImplementation((query: any) => {
      const feedIds = query.feedIds || [];
      if (feedIds.includes('feed-a')) {
        return Promise.resolve({ articles: stationAArticles, total: stationAArticles.length });
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
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-a1']);
    });

    await act(async () => {
      latestContext!.selectArticle('hash-a1');
      latestContext!.setArticleViewOverlayPhase('open');
    });
    await waitForExpectation(() => {
      expect(latestContext!.activeArticleHash).toBe('hash-a1');
      expect(latestContext!.articleViewOverlayPhase).toBe('open');
    });

    await act(async () => {
      void latestContext!.selectTag('B');
    });

    expect(latestContext!.articleCloseRequest).toBe(1);
    expect(latestContext!.isArticleClosing).toBe(true);
    expect(latestContext!.activeArticleHash).toBeNull();

    stationBFeedsDeferred.resolve(['feed-b']);
  });
});
