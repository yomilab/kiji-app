import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedProvider, useFeed } from '@/contexts/FeedContext';
import type { Article } from '@/types/article';
import { tagsManager } from '@/services/tags/tagsManager';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';
import {
  clearArticleListMemoryCaches,
  getInternedFeedMetadataCountForTests,
} from '@/services/articles/articleListMemory';
import { clearTagFeedIdsCacheForTests } from '@/services/tags/tagFeedIdsCache';
import { clearFeedMetadataCacheForTests } from '@/services/feeds/feedMetadataCache';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import {
  TECH_STATION_SCENARIO,
  buildRealisticArticleRecordPage,
  countDistinctFaviconReferences,
  estimateSerializedArticleListBytes,
  estimateInternedRetainedStringBytes,
  logLoadMemoryReport,
  materializePreparedListArticles,
  measureLoadMemoryAsync,
  snapshotProcessMemory,
} from '../helpers/articleListMemoryHarness';

const feedStoreTagsMock = vi.hoisted(() => ({
  listWithFeedIds: vi.fn().mockResolvedValue([]),
  listFeedIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/stores/articleStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/articleStore')>();
  return {
    ...actual,
    query: vi.fn(),
    store: vi.fn(),
    getUnreadCount: vi.fn(),
    getArticleCount: vi.fn(),
    getByHash: vi.fn(),
    getContent: vi.fn(),
  };
});

vi.mock('@/stores/feedStore', () => ({
  getCount: vi.fn(),
  getById: vi.fn(),
  getAll: vi.fn(),
  tags: feedStoreTagsMock,
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
    deleteFeed: vi.fn(),
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

type MockArticleQuery = {
  feedIds?: string[];
  tagName?: string;
  limit?: number;
  cursor?: {
    effectiveDate?: string;
    hash?: string;
  };
  includeTotal?: boolean;
};

const TARGET_LOADED_COUNT = 1200;
const PAGE_SIZE = 100;

const datasetOptions = {
  feedCount: TECH_STATION_SCENARIO.feedCount,
  articleCount: TARGET_LOADED_COUNT,
  faviconSizeKb: 6,
  uniqueFaviconPerRow: false,
};

let preparedArticles: Article[] | null = null;

const getPreparedArticles = (): Article[] => {
  if (!preparedArticles) {
    preparedArticles = materializePreparedListArticles(
      buildRealisticArticleRecordPage(0, TARGET_LOADED_COUNT, datasetOptions),
    );
  }
  return preparedArticles;
};

const paginateArticles = (query: MockArticleQuery): { articles: Article[]; total: number } => {
  const articles = getPreparedArticles();
  const limit = query.limit ?? PAGE_SIZE;
  let startIndex = 0;

  if (query.cursor?.hash) {
    const cursorIndex = articles.findIndex((article) => article.hash === query.cursor?.hash);
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : articles.length;
  }

  return {
    articles: articles.slice(startIndex, startIndex + limit),
    total: articles.length,
  };
};

const waitForExpectation = async (
  expectation: () => void,
  timeoutMs = 3000,
  intervalMs = 10,
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

describe('FeedContext load-more memory scenarios', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestContext: ReturnType<typeof useFeed> | null = null;

  const Probe = () => {
    latestContext = useFeed();
    return null;
  };

  beforeEach(() => {
    clearArticleListMemoryCaches();
    clearTagFeedIdsCacheForTests();
    clearFeedMetadataCacheForTests();
    preparedArticles = null;
    latestContext = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const techFeedIds = Array.from({ length: TECH_STATION_SCENARIO.feedCount }, (_, index) => `feed-${index}`);
    const techFeeds = techFeedIds.map((id) => ({
      id,
      title: id,
      url: `https://${id}.example.com/rss.xml`,
      tags: ['Tech'],
      sortOrder: 0,
      consecutiveFailures: 0,
      lastFetched: null,
    }));

    vi.mocked(feedStore.getCount).mockResolvedValue(TECH_STATION_SCENARIO.feedCount);
    vi.mocked(feedStore.getAll).mockResolvedValue(techFeeds);
    feedStoreTagsMock.listWithFeedIds.mockResolvedValue([{ name: 'Tech', feedIds: techFeedIds }]);
    feedStoreTagsMock.listFeedIds.mockResolvedValue(techFeedIds);
    vi.mocked(tagsManager.getFeedsByTag).mockResolvedValue(techFeedIds);
    vi.mocked(feedsFetcher.fetchFeedNetworkWithCache).mockResolvedValue({
      notModified: true,
      etag: 'etag-1',
      lastModified: 'date-1',
    });
    vi.mocked(articleStore.query as Mock).mockImplementation((query: MockArticleQuery) =>
      Promise.resolve(paginateArticles(query)),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    clearArticleListMemoryCaches();
  });

  it('loads 1200 rows via loadMore and reports bounded RAM usage', async () => {
    const measured = await measureLoadMemoryAsync(async () => {
      act(() => {
        root.render(
          <FeedProvider>
            <Probe />
          </FeedProvider>,
        );
      });

      await waitForExpectation(() => expect(latestContext).not.toBeNull());

      await act(async () => {
        await latestContext!.selectTag('Tech');
      });

      await waitForExpectation(() => {
        expect(latestContext!.articles.length).toBe(PAGE_SIZE);
        expect(latestContext!.articlesTotalCount).toBe(TARGET_LOADED_COUNT);
      });

      for (let page = 1; page * PAGE_SIZE < TARGET_LOADED_COUNT; page += 1) {
        await act(async () => {
          await latestContext!.loadMoreArticles();
        });

        await waitForExpectation(() => {
          expect(latestContext!.articles.length).toBe(Math.min((page + 1) * PAGE_SIZE, TARGET_LOADED_COUNT));
        });
      }

      return latestContext!.articles;
    }, (articles) => ({
      articleCount: articles.length,
      distinctFaviconRefs: countDistinctFaviconReferences(articles),
      internedFeedCount: getInternedFeedMetadataCountForTests(),
      peakHeapUsedMb: snapshotProcessMemory().heapUsedMb,
      serializedRetainedKb: Math.round(estimateSerializedArticleListBytes(articles) / 1024),
      estimatedStringBytes: estimateInternedRetainedStringBytes(articles),
    }));

    logLoadMemoryReport('feedcontext-loadmore-1200', measured.memory);

    expect(measured.result).toHaveLength(TARGET_LOADED_COUNT);
    expect(new Set(measured.result.map((article) => article.hash)).size).toBe(TARGET_LOADED_COUNT);
    expect(measured.memory.internedFeedCount).toBeLessThanOrEqual(TECH_STATION_SCENARIO.feedCount);
    expect(measured.memory.distinctFaviconRefs).toBeLessThanOrEqual(TECH_STATION_SCENARIO.feedCount);
    expect(measured.memory.heapUsedMb).toBeGreaterThan(0);
    expect(measured.memory.rssMb).toBeGreaterThan(0);
    expect(snapshotProcessMemory().heapUsedMb).toBeGreaterThan(0);
  });

  it('preserves single-flight loadMore pagination behavior', async () => {
    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>,
      );
    });

    await waitForExpectation(() => expect(latestContext).not.toBeNull());

    await act(async () => {
      await latestContext!.selectTag('Tech');
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.length).toBe(PAGE_SIZE);
      expect(latestContext!.articlesTotalCount).toBe(TARGET_LOADED_COUNT);
    });

    await act(async () => {
      void latestContext!.loadMoreArticles();
      void latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.length).toBe(PAGE_SIZE * 2);
    });

    const duplicatePageCalls = vi.mocked(articleStore.query as Mock).mock.calls.filter(
      ([query]) => query.cursor?.hash === getPreparedArticles()[PAGE_SIZE - 1].hash,
    );
    expect(duplicatePageCalls).toHaveLength(1);
  });
});
