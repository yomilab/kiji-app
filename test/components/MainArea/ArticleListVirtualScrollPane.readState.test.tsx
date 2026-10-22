import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { createRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Article } from '@/types/article';

const mocks = vi.hoisted(() => ({
  updateReadStatus: vi.fn(),
  syncFeedCountsBatch: vi.fn(),
  publishFeedsCountsUpdated: vi.fn(),
  showToast: vi.fn(),
  menuItems: [] as Array<{ text: string; action?: (id: string) => void; close: () => Promise<void> }>,
  menus: [] as Array<{ popup: () => Promise<void>; close: () => Promise<void> }>,
}));

vi.mock('@tauri-apps/api/menu', () => ({
  MenuItem: {
    new: vi.fn(async (options: { text: string; action?: (id: string) => void }) => {
      const item = { ...options, close: vi.fn(async () => {}) };
      mocks.menuItems.push(item);
      return item;
    }),
  },
  Menu: {
    new: vi.fn(async () => {
      const menu = { popup: vi.fn(async () => {}), close: vi.fn(async () => {}) };
      mocks.menus.push(menu);
      return menu;
    }),
  },
}));

vi.mock('@/services/articles/articlesManager', () => ({
  articlesManager: { updateReadStatus: mocks.updateReadStatus },
}));

vi.mock('@/stores/articleStore', () => ({
  syncFeedCountsBatch: mocks.syncFeedCountsBatch,
}));

vi.mock('@/services/ui/feedLibraryMutationBus', () => ({
  feedLibraryMutationBus: { publishFeedsCountsUpdated: mocks.publishFeedsCountsUpdated },
}));

vi.mock('@/services/ui/appToastService', () => ({
  appToastService: { show: mocks.showToast, clear: vi.fn() },
}));

vi.mock('@/components/common/FeedLineLoader', () => ({
  FeedLineLoader: () => null,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => string }) => ({
    getTotalSize: () => count * 112,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: getItemKey(index),
      index,
      start: index * 112,
      end: (index + 1) * 112,
    })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

import { ArticleListVirtualScrollPane } from '@/components/MainArea/ArticleListVirtualScrollPane';
import { ArticleListScrollOffsetProvider } from '@/components/MainArea/hooks/articleListScrollOffsetContext';

const makeArticle = (hash: string, read: boolean): Article => ({
  hash,
  title: `Article ${hash}`,
  description: '',
  content: '',
  fetchedDate: '2026-10-01T00:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  read,
  starred: false,
  saved: false,
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

function renderPane(overrides: Partial<React.ComponentProps<typeof ArticleListVirtualScrollPane>> = {}) {
  const articleListRef = createRef<HTMLDivElement>();
  const selectArticle = vi.fn();
  const updateArticleInList = vi.fn();
  const props: React.ComponentProps<typeof ArticleListVirtualScrollPane> = {
    articleListRef,
    sourceKey: 'feed:1',
    navigationNonce: 0,
    sourceLabel: 'Test Feed',
    variant: 'common',
    filteredArticles: [makeArticle('a', true), makeArticle('b', true), makeArticle('c', false)],
    articlesTotalCount: 3,
    articlesTotalKnown: true,
    pageWasFull: false,
    activeArticleHash: 'a',
    articleViewOverlayPhase: 'closed',
    isInitialLoading: false,
    isLoadingMoreArticles: false,
    isSearchActive: false,
    isSearchDebouncePending: false,
    searchStatus: 'idle',
    debouncedSearchQuery: '',
    isSavedView: false,
    newArticleHashes: new Set(),
    articleListScrollRequest: null,
    totalFeeds: 1,
    selectArticle,
    loadMoreArticles: vi.fn(async () => undefined),
    selectedSmartView: null,
    updateArticleInList,
    syncArticleListViewport: vi.fn(),
    ...overrides,
  };
  const view = render(
    <ArticleListScrollOffsetProvider>
      <div ref={articleListRef}>
        <ArticleListVirtualScrollPane {...props} />
      </div>
    </ArticleListScrollOffsetProvider>,
  );
  return { ...view, selectArticle, updateArticleInList, props };
}

describe('article list read state (m, Space, row menu)', () => {
  beforeEach(() => {
    mocks.updateReadStatus.mockReset().mockResolvedValue(undefined);
    mocks.syncFeedCountsBatch.mockReset().mockResolvedValue([{ feedId: 'feed-1', unreadCount: 2, articleCount: 3 }]);
    mocks.publishFeedsCountsUpdated.mockReset();
    mocks.showToast.mockReset();
    mocks.menuItems.length = 0;
    mocks.menus.length = 0;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
  });

  it('m marks the selected read row unread right away and refreshes the feed count', async () => {
    const { updateArticleInList } = renderPane();
    press('m');
    await flush();

    expect(mocks.updateReadStatus).toHaveBeenCalledWith('feed-1', 'a', false);
    expect(updateArticleInList).toHaveBeenCalledWith('a', { read: false });
    expect(mocks.syncFeedCountsBatch).toHaveBeenCalledWith(['feed-1']);
    expect(mocks.publishFeedsCountsUpdated).toHaveBeenCalledWith([
      { feedId: 'feed-1', unreadCount: 2, articleCount: 3 },
    ]);
  });

  it('m marks an unread row read', async () => {
    const { updateArticleInList } = renderPane({ activeArticleHash: 'c' });
    press('m');
    await flush();
    expect(mocks.updateReadStatus).toHaveBeenCalledWith('feed-1', 'c', true);
    expect(updateArticleInList).toHaveBeenCalledWith('c', { read: true });
  });

  it('m does nothing in the Saved list', async () => {
    renderPane({ isSavedView: true, variant: 'saved' });
    press('m');
    await flush();
    expect(mocks.updateReadStatus).not.toHaveBeenCalled();
  });

  it('m and Space are ignored while the article view covers the list', async () => {
    const { selectArticle } = renderPane({ articleViewOverlayPhase: 'open' });
    press('m');
    press(' ');
    await flush();
    expect(mocks.updateReadStatus).not.toHaveBeenCalled();
    expect(selectArticle).not.toHaveBeenCalled();
  });

  it('Space opens the next unread article, skipping read rows', async () => {
    const { selectArticle } = renderPane();
    press(' ');
    await flush();
    expect(selectArticle).toHaveBeenCalledWith('c');
  });

  it('Space with no unread article after the selection shows a hint', async () => {
    const { selectArticle } = renderPane({ activeArticleHash: 'c' });
    press(' ');
    await flush();
    expect(selectArticle).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('No more unread articles', expect.any(Number));
  });

  it('row menu offers Mark as Unread on a read row and applies it', async () => {
    const { container, updateArticleInList } = renderPane();
    const row = container.querySelector('[data-entity-id="b"]');
    expect(row).not.toBeNull();
    const event = fireEvent.contextMenu(row!);
    await flush();

    expect(event).toBe(false); // default WebView menu suppressed
    expect(mocks.menuItems.map((item) => item.text)).toEqual(['Mark as Unread']);
    expect(mocks.menus[0].popup).toHaveBeenCalled();

    act(() => {
      mocks.menuItems[0].action?.('article-row-toggle-read');
    });
    await flush();
    expect(mocks.updateReadStatus).toHaveBeenCalledWith('feed-1', 'b', false);
    expect(updateArticleInList).toHaveBeenCalledWith('b', { read: false });
  });

  it('row menu offers Mark as Read on an unread row and releases the previous menu', async () => {
    const { container } = renderPane();
    fireEvent.contextMenu(container.querySelector('[data-entity-id="b"]')!);
    await flush();
    fireEvent.contextMenu(container.querySelector('[data-entity-id="c"]')!);
    await flush();

    expect(mocks.menuItems.map((item) => item.text)).toEqual(['Mark as Unread', 'Mark as Read']);
    expect(mocks.menus[0].close).toHaveBeenCalled();
    expect(mocks.menuItems[0].close).toHaveBeenCalled();
  });
});
