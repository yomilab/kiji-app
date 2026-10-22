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
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { userMessageBus } from '@/services/ui/userMessageBus';
import { APP_TOAST_CHANNEL } from '@/services/ui/appToastService';

vi.mock('@/stores/articleStore', () => ({
  beginSearch: vi.fn().mockResolvedValue('1'),
  cancelSearch: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  store: vi.fn(),
  getUnreadCount: vi.fn(),
  getArticleCount: vi.fn(),
  syncFeedCountsBatch: vi.fn(),
  markReadScope: vi.fn(),
  restoreUnread: vi.fn(),
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
    getSavedViewArticle: vi.fn(),
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

describe('FeedContext mark all as read', () => {
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
    (articleStore.markReadScope as vi.Mock).mockReset();
    (articleStore.restoreUnread as vi.Mock).mockReset().mockResolvedValue([]);
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
    userMessageBus.clear(APP_TOAST_CHANNEL);
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

  const unreadRows = () => [
    createArticle('hash-u1', 'feed-1', { read: false, lastReadAt: undefined }),
    createArticle('hash-u2', 'feed-1', { read: false, lastReadAt: undefined }),
  ];

  const showUnread = async () => {
    (articleStore.query as vi.Mock).mockImplementation((query: ArticleQuery) => (
      query.filter?.read === false
        ? Promise.resolve({ articles: unreadRows(), total: 2 })
        : Promise.resolve({ articles: [], total: 0 })
    ));
    await renderProvider();
    await act(async () => {
      await latestContext!.selectSmartView('unread');
    });
    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.hash)).toEqual(['hash-u1', 'hash-u2']);
    });
  };

  const markAll = async (options?: { olderThanDays?: 1 | 7 }) => {
    await act(async () => {
      await latestContext!.markCurrentSourceRead(options);
    });
  };

  it('marks the scope in one native call, patches rows in place and publishes counts', async () => {
    const publishCounts = vi.spyOn(feedLibraryMutationBus, 'publishFeedsCountsUpdated');
    await showUnread();
    const queriesBefore = (articleStore.query as vi.Mock).mock.calls.length;
    (articleStore.markReadScope as vi.Mock).mockResolvedValue({
      changed: 2,
      hashes: ['hash-u1', 'hash-u2'],
      undoable: true,
      feedCounts: [{ feedId: 'feed-1', unreadCount: 0, articleCount: 2 }],
    });

    await markAll();

    expect(articleStore.markReadScope).toHaveBeenCalledTimes(1);
    expect(articleStore.markReadScope).toHaveBeenCalledWith({ smartView: 'unread', olderThan: undefined, searchText: undefined });
    // Rows stay (no reload flash) and show as read.
    expect(latestContext!.articles.map((article) => [article.hash, article.read])).toEqual([
      ['hash-u1', true],
      ['hash-u2', true],
    ]);
    expect((articleStore.query as vi.Mock).mock.calls.length).toBe(queriesBefore);
    expect(publishCounts).toHaveBeenCalledWith([{ feedId: 'feed-1', unreadCount: 0, articleCount: 2 }]);
    // Native wrote read state and counts; nothing per article from here.
    expect(articleStore.syncFeedCountsBatch).not.toHaveBeenCalled();

    const toast = userMessageBus.getMessage(APP_TOAST_CHANNEL);
    expect(toast?.text).toBe('Marked 2 articles as read');
    expect(toast?.action?.label).toBe('Undo');
    publishCounts.mockRestore();
  });

  it('Undo restores exactly the changed articles and their counts', async () => {
    const publishCounts = vi.spyOn(feedLibraryMutationBus, 'publishFeedsCountsUpdated');
    await showUnread();
    (articleStore.markReadScope as vi.Mock).mockResolvedValue({
      changed: 1,
      hashes: ['hash-u2'],
      undoable: true,
      feedCounts: [{ feedId: 'feed-1', unreadCount: 1, articleCount: 2 }],
    });
    (articleStore.restoreUnread as vi.Mock).mockResolvedValue([{ feedId: 'feed-1', unreadCount: 2, articleCount: 2 }]);
    await markAll({ olderThanDays: 7 });
    expect(latestContext!.articles.map((article) => article.read)).toEqual([false, true]);

    await act(async () => {
      userMessageBus.getMessage(APP_TOAST_CHANNEL)!.action!.run();
      await Promise.resolve();
    });

    await waitForExpectation(() => {
      expect(latestContext!.articles.map((article) => article.read)).toEqual([false, false]);
    });
    expect(articleStore.restoreUnread).toHaveBeenCalledWith(['hash-u2']);
    expect(publishCounts).toHaveBeenLastCalledWith([{ feedId: 'feed-1', unreadCount: 2, articleCount: 2 }]);
    publishCounts.mockRestore();
  });

  it('passes the older-than cutoff and runs once when the menu and shortcut both fire', async () => {
    await showUnread();
    let resolve!: (value: unknown) => void;
    (articleStore.markReadScope as vi.Mock).mockImplementation(() => new Promise((done) => {
      resolve = done;
    }));

    await act(async () => {
      const first = latestContext!.markCurrentSourceRead({ olderThanDays: 1 });
      const second = latestContext!.markCurrentSourceRead({ olderThanDays: 1 });
      resolve({ changed: 0, hashes: [], undoable: true, feedCounts: [] });
      await Promise.all([first, second]);
    });

    expect(articleStore.markReadScope).toHaveBeenCalledTimes(1);
    const request = (articleStore.markReadScope as vi.Mock).mock.calls[0][0];
    expect(request.smartView).toBe('unread');
    const ageMs = Date.now() - Date.parse(request.olderThan);
    expect(ageMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(ageMs).toBeLessThan(24 * 60 * 60 * 1000 + 60_000);
    expect(userMessageBus.getMessage(APP_TOAST_CHANNEL)?.text).toBe('No older unread articles');
  });

  it('offers no Undo for batches too large to keep and patches rows by scope', async () => {
    await showUnread();
    (articleStore.markReadScope as vi.Mock).mockResolvedValue({
      changed: 20000,
      hashes: [],
      undoable: false,
      feedCounts: [],
    });
    await markAll();
    expect(latestContext!.articles.every((article) => article.read)).toBe(true);
    const toast = userMessageBus.getMessage(APP_TOAST_CHANNEL);
    expect(toast?.text).toBe('Marked 20,000 articles as read');
    expect(toast?.action).toBeUndefined();
  });

  it('does nothing in Saved', async () => {
    await renderProvider();
    await act(async () => {
      await latestContext!.selectSmartView('saved');
    });
    await markAll();
    expect(articleStore.markReadScope).not.toHaveBeenCalled();
  });
});
