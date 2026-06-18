import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

const mockUseVirtualizer = vi.fn();
const mockNewArticleHashes = new Set<string>();
const mockLoadMoreArticles = vi.fn();
const mockUpdateArticleInList = vi.fn();
const mockSearchCurrentSource = vi.fn();
const mockClearArticleListSearch = vi.fn();
const mockSelectArticle = vi.fn();
const mockSetActiveArticle = vi.fn();
let mockArticlesTotalCount = 100;
const mockSearchState = {
  searchQuery: '',
  debouncedSearchQuery: '',
  isSearchOpen: false,
};

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: (): unknown => ({
    selectedFeedTitle: 'Test Feed',
    selectedFeedId: 'feed-1',
    selectedTag: null,
    selectedSmartView: null,
  }),
  useFeedCollection: (): unknown => ({
    articles: Array.from({ length: 100 }, (_, index) => ({
      hash: `hash-${index}`,
      title: `Article ${index}`,
      description: `Description ${index}`,
      content: `Content ${index}`,
      fetchedDate: '2026-02-25T00:00:00.000Z',
      feedId: 'feed-1',
      feedUrl: 'https://example.com/rss.xml',
      read: false,
      starred: false,
      saved: false,
      feedTitle: 'Feed',
      publishedDate: '2026-02-25T00:00:00.000Z',
      feedFaviconHasTransparency: false,
    })),
    articlesTotalCount: mockArticlesTotalCount,
    savedArticles: [],
    isLoadingArticles: false,
    isLoadingMoreArticles: false,
    isLoadMoreInFlight: false,
    isSavedListLoading: false,
    isGlobalLoadingIndicatorActive: false,
    loadMoreArticles: mockLoadMoreArticles,
    updateArticleInList: mockUpdateArticleInList,
    searchCurrentSource: mockSearchCurrentSource,
    clearArticleListSearch: mockClearArticleListSearch,
    newArticleHashes: mockNewArticleHashes,
    articleListScrollRequest: null,
    syncArticleListViewport: vi.fn(),
  }),
  useFeedOverlay: (): unknown => ({
    activeArticleHash: null,
    selectArticle: mockSelectArticle,
    setActiveArticle: mockSetActiveArticle,
    articleViewOverlayPhase: 'closed',
  }),
  useFeedUI: (): unknown => ({
    error: null,
    totalFeeds: 1,
  }),
}));

vi.mock('@/components/MainArea/hooks/useFetchIndicatorState', () => ({
  useFetchIndicatorState: () => ({
    isFetchIndicatorVisible: false,
    applySourceSwitchGrace: vi.fn(),
  }),
}));

vi.mock('@/components/MainArea/hooks/useArticleListKeyboardNavigation', () => ({
  useArticleListKeyboardNavigation: vi.fn(),
}));

vi.mock('@/components/MainArea/hooks/useArticleListSearch', () => ({
  useArticleListSearch: () => ({
    searchQuery: mockSearchState.searchQuery,
    debouncedSearchQuery: mockSearchState.debouncedSearchQuery,
    isSearchOpen: mockSearchState.isSearchOpen,
    handleSearchChange: vi.fn(),
    handleToggleSearch: vi.fn(),
    handleCloseSearch: vi.fn(),
  }),
}));

vi.mock('@/components/MainArea/hooks/useArticleListLayoutResize', () => ({
  useArticleListLayoutResize: (): unknown => ({
    isDragging: false,
    widthStyle: undefined,
    showResizeHandle: false,
    handleBorderMouseDown: vi.fn(),
  }),
}));

vi.mock('@/components/MainArea/ArticleListItem', () => ({
  ArticleListItem: ({ article }: { article: { title: string } }) => (
    <div data-testid="mock-article-row">{article.title}</div>
  ),
}));

vi.mock('@/components/MainArea/ArticleListSkeleton', () => ({
  ArticleListHeaderSkeleton: () => <div data-testid="header-skeleton">Header Skeleton</div>,
  ArticleListSkeleton: () => <div data-testid="mock-phantom-skeleton">Phantom Skeleton</div>,
  ArticleListSkeletonGroup: ({ count = 1 }: { count?: number }) => (
    <div data-testid="mock-skeleton-group">{Array.from({ length: count }).map((_, index) => (
      <div key={index} data-testid="mock-phantom-skeleton">Phantom Skeleton</div>
    ))}</div>
  ),
}));

vi.mock('@/components/common/FeedLineLoader', () => ({
  FeedLineLoader: () => <div data-testid="mock-feed-line-loader" />,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (...args: unknown[]) => mockUseVirtualizer(...args),
}));

import { SharedArticleList } from '@/components/MainArea/SharedArticleList';

const renderSharedArticleList = () => render(<SharedArticleList variant="common" />);

describe('SharedArticleList virtualization', () => {
  beforeEach(() => {
    mockLoadMoreArticles.mockClear();
    mockSearchState.searchQuery = '';
    mockSearchState.debouncedSearchQuery = '';
    mockSearchState.isSearchOpen = false;
    mockArticlesTotalCount = 100;
    mockSearchCurrentSource.mockClear();
    mockClearArticleListSearch.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const makeVirtualizerMock = (indexes = [0, 1, 2, 3, 4]) => ({
    getTotalSize: () => 2000,
    getOffsetForIndex: (index: number) => index * 100,
    getVirtualItems: () => indexes.map((index) => ({
      key: `k-${index}`,
      index,
      start: index * 100,
    })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  });

  it('renders only virtualized rows instead of the full list', () => {
    mockUseVirtualizer.mockReturnValue(makeVirtualizerMock());

    const { getAllByTestId, queryByText } = renderSharedArticleList();

    expect(mockUseVirtualizer).toHaveBeenCalledWith(expect.objectContaining({
      count: 100,
      overscan: 16,
    }));
    expect(getAllByTestId('mock-article-row')).toHaveLength(5);
    expect(queryByText('Article 50')).not.toBeInTheDocument();
  });

  it('pauses bottom pagination while search input is waiting for debounce', () => {
    mockSearchState.searchQuery = 'article';
    mockSearchState.debouncedSearchQuery = '';
    mockSearchState.isSearchOpen = true;
    mockArticlesTotalCount = 200;
    mockUseVirtualizer.mockReturnValue(makeVirtualizerMock([95, 96, 97, 98, 99]));

    const { container } = renderSharedArticleList();
    const listElement = container.querySelector('.article-list-items') as HTMLDivElement;

    Object.defineProperties(listElement, {
      scrollTop: { value: 1500, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollHeight: { value: 2000, configurable: true },
    });

    fireEvent.scroll(listElement);

    expect(mockLoadMoreArticles).not.toHaveBeenCalled();
  });

  it('keeps bottom pagination enabled for debounced database search results', () => {
    mockSearchState.searchQuery = 'article';
    mockSearchState.debouncedSearchQuery = 'article';
    mockSearchState.isSearchOpen = true;
    mockArticlesTotalCount = 200;
    mockUseVirtualizer.mockReturnValue(makeVirtualizerMock([55, 56, 57, 58, 59]));

    const { container } = renderSharedArticleList();
    const listElement = container.querySelector('.article-list-items') as HTMLDivElement;

    Object.defineProperties(listElement, {
      scrollTop: { value: 1500, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollHeight: { value: 2000, configurable: true },
    });

    fireEvent.scroll(listElement);

    expect(mockLoadMoreArticles).toHaveBeenCalledWith({
      showLoadingIndicator: false,
      priority: 'prefetch',
    });
    expect(mockSearchCurrentSource).toHaveBeenCalledWith('article');
  });

  it('keeps bottom pagination enabled when no search filter is active', () => {
    mockArticlesTotalCount = 200;
    mockUseVirtualizer.mockReturnValue(makeVirtualizerMock([55, 56, 57, 58, 59]));

    const { container } = renderSharedArticleList();
    const listElement = container.querySelector('.article-list-items') as HTMLDivElement;

    Object.defineProperties(listElement, {
      scrollTop: { value: 1500, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollHeight: { value: 2000, configurable: true },
    });

    fireEvent.scroll(listElement);

    expect(mockLoadMoreArticles).toHaveBeenCalledWith({
      showLoadingIndicator: false,
      priority: 'prefetch',
    });
  });

  it('does not start pagination around the middle of the loaded rows', () => {
    mockArticlesTotalCount = 200;
    mockUseVirtualizer.mockReturnValue(makeVirtualizerMock([35, 36, 37, 38, 39]));

    renderSharedArticleList();

    expect(mockLoadMoreArticles).not.toHaveBeenCalled();
  });

  it('flushes pending prefetch when loaded rows are almost exhausted', () => {
    mockArticlesTotalCount = 200;
    mockUseVirtualizer.mockReturnValue(makeVirtualizerMock([87, 88, 89, 90, 91]));

    renderSharedArticleList();

    expect(mockLoadMoreArticles).toHaveBeenCalledWith({
      showLoadingIndicator: false,
      priority: 'urgent',
    });
  });

  it('prefers ResizeObserver entry height for row measurement', () => {
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 2000,
      getVirtualItems: (): unknown[] => [],
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
    });

    renderSharedArticleList();

    const options = mockUseVirtualizer.mock.calls.at(-1)?.[0];
    expect(options).toBeTruthy();
    expect(typeof options.measureElement).toBe('function');

    const measuredHeight = options.measureElement(
      {
        getBoundingClientRect: () => ({ height: 240 }),
      },
      {
        contentRect: {
          height: 180,
        },
      }
    );

    expect(measuredHeight).toBe(180);
  });
});
