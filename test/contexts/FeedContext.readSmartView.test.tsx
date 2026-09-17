import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedProvider, useFeed } from '@/contexts/FeedContext';
import type { Article } from '@/types/article';
import type { ArticleQuery } from '@/types/articleQuery';
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

vi.mock('@/stores/feedStore', () => {
  const getAll = vi.fn();
  return {
    getCount: vi.fn(),
    getById: vi.fn(),
    getAll,
    listSidebarSnapshot: vi.fn(async () => ({
      feeds: await getAll(),
      stations: [],
    })),
    tags: {
      listWithFeedIds: vi.fn().mockResolvedValue([]),
      listFeedIds: vi.fn().mockResolvedValue([]),
    },
  };
});

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

const createArticle = (
  hash: string,
  feedId: string,
  overrides: Partial<Article> = {},
): Article => ({
  hash,
  title: `Article ${hash}`,
  description: `Description ${hash}`,
  content: `<p>${hash}</p>`,
  fetchedDate: '2026-02-25T00:00:00.000Z',
  feedId,
  feedUrl: `https://${feedId}.example.com/rss.xml`,
  read: true,
  starred: false,
  saved: false,
  feedTitle: `Feed ${feedId}`,
  publishedDate: '2026-02-25T00:00:00.000Z',
  lastReadAt: '2026-09-10T12:00:00.000Z',
  ...overrides,
});

const waitForExpectation = async (
  expectation: () => void,
  timeoutMs = 1500,
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FeedContext Read smart view', () => {
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
    (savedArticlesService.enrichSavedViewArticlesMeta as vi.Mock).mockReset().mockImplementation(
      (articles: Article[]) => Promise.resolve(articles),
    );
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

  const renderProvider = async () => {
    act(() => {
      root.render(
        <FeedProvider>
          <Probe />
        </FeedProvider>,
      );
    });
    await waitForExpectation(() => expect(latestContext).not.toBeNull());
  };

  it('queries read=true sorted by lastReadAt from both switch and search builders', async () => {
    const readArticles = [createArticle('hash-r1', 'feed-1')];
    (articleStore.query as vi.Mock).mockImplementation((query: ArticleQuery) => {
      if (query.filter?.read === true) {
        return Promise.resolve({ articles: readArticles, total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    await renderProvider();
    await act(async () => {
      await latestContext!.selectSmartView('read');
    });

    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('read');
      expect(latestContext!.selectedFeedTitle).toBe('Read');
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-r1']);
    });

    const switchQuery = (articleStore.query as vi.Mock).mock.calls.find(
      ([query]: [ArticleQuery]) => query.filter?.read === true && !query.searchText && !query.cursor,
    )?.[0] as ArticleQuery | undefined;
    expect(switchQuery?.sort).toEqual({ field: 'lastReadAt', order: 'desc' });
    expect(switchQuery?.filter).toEqual({ read: true });

    await act(async () => {
      await latestContext!.searchCurrentSource('alpha');
    });

    const searchQuery = (articleStore.query as vi.Mock).mock.calls.find(
      ([query]: [ArticleQuery]) => query.searchText === 'alpha',
    )?.[0] as ArticleQuery | undefined;
    expect(searchQuery?.filter).toEqual({ read: true });
    expect(searchQuery?.sort).toEqual({ field: 'lastReadAt', order: 'desc' });
  });

  it('pages Read with a lastReadAt cursor, including the NULL tail', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => (
      createArticle(`hash-r${index}`, 'feed-1', {
        lastReadAt: `2026-09-10T${String(10 - Math.floor(index / 10)).padStart(2, '0')}:00:00.000Z`,
      })
    ));
    const nullTail = createArticle('hash-null', 'feed-1', { lastReadAt: undefined });
    firstPage[99] = nullTail;

    (articleStore.query as vi.Mock).mockImplementation((query: ArticleQuery) => {
      if (query.filter?.read !== true) {
        return Promise.resolve({ articles: [], total: 0 });
      }
      if (query.cursor) {
        expect(query.sort).toEqual({ field: 'lastReadAt', order: 'desc' });
        expect(query.cursor).toEqual({ effectiveDate: null, hash: 'hash-null' });
        return Promise.resolve({ articles: [createArticle('hash-null-2', 'feed-1', { lastReadAt: undefined })], total: 101 });
      }
      return Promise.resolve({ articles: firstPage, total: 101 });
    });

    await renderProvider();
    await act(async () => {
      await latestContext!.selectSmartView('read');
    });
    await waitForExpectation(() => {
      expect(latestContext!.articles).toHaveLength(100);
    });

    await act(async () => {
      await latestContext!.loadMoreArticles();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toContain('hash-null-2');
    });
  });

  it('inserts or moves a flushed article to the top of Read and removes on unread', async () => {
    const older = createArticle('hash-old', 'feed-1', { lastReadAt: '2026-09-01T00:00:00.000Z' });
    const newer = createArticle('hash-new', 'feed-1', { lastReadAt: '2026-09-02T00:00:00.000Z' });
    (articleStore.query as vi.Mock).mockImplementation((query: ArticleQuery) => {
      if (query.filter?.read === true) {
        return Promise.resolve({ articles: [newer, older], total: 2 });
      }
      if (query.filter?.read === false) {
        return Promise.resolve({ articles: [createArticle('hash-u', 'feed-1', { read: false, lastReadAt: undefined })], total: 1 });
      }
      return Promise.resolve({ articles: [], total: 0 });
    });

    await renderProvider();
    await act(async () => {
      await latestContext!.selectSmartView('read');
    });
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-new', 'hash-old']);
    });

    act(() => {
      latestContext!.updateArticleInList('hash-old', { lastReadAt: '2026-09-11T00:00:00.000Z' });
    });
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-old', 'hash-new']);
    expect(latestContext!.articles[0].lastReadAt).toBe('2026-09-11T00:00:00.000Z');

    const incoming = createArticle('hash-incoming', 'feed-2', { lastReadAt: '2026-09-12T00:00:00.000Z' });
    act(() => {
      latestContext!.updateArticleInList('hash-incoming', { read: true, lastReadAt: incoming.lastReadAt }, incoming);
    });
    expect(latestContext!.articles.map((article) => article.hash)).toEqual([
      'hash-incoming',
      'hash-old',
      'hash-new',
    ]);

    act(() => {
      latestContext!.updateArticleInList('hash-incoming', { read: false });
    });
    expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-old', 'hash-new']);

    await act(async () => {
      await latestContext!.selectSmartView('unread');
    });
    await waitForExpectation(() => {
      expect(latestContext!.selectedSmartView).toBe('unread');
    });
    act(() => {
      latestContext!.updateArticleInList('hash-u', { read: true });
    });
    expect(latestContext!.articles.map((article) => article.hash)).toEqual([]);
  });

  it('does not use Saved loading or a publishedDate sort for Read', async () => {
    (articleStore.query as vi.Mock).mockResolvedValue({
      articles: [createArticle('hash-r1', 'feed-1')],
      total: 1,
    });

    await renderProvider();
    await act(async () => {
      await latestContext!.selectSmartView('read');
    });
    await waitForExpectation(() => {
      expect(latestContext!.isSavedListLoading).toBe(false);
      expect(latestContext!.articles).toHaveLength(1);
    });
    expect(savedArticlesService.querySavedViewArticles).not.toHaveBeenCalled();

    const query = (articleStore.query as vi.Mock).mock.calls[0][0] as ArticleQuery;
    expect(query.sort?.field).not.toBe('publishedDate');
    expect(query.sort?.field).toBe('lastReadAt');
  });
});
