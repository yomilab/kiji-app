import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

const mockUseVirtualizer = vi.fn();

type MockArticle = {
  hash: string;
  title: string;
  description: string;
  content: string;
  fetchedDate: string;
  feedId: string;
  feedUrl: string;
  read: boolean;
  starred: boolean;
  saved: boolean;
  feedTitle: string;
  publishedDate: string;
  feedFaviconHasTransparency: boolean;
};

type MockFeedState = {
  articles: MockArticle[];
  articlesTotalCount: number;
  savedArticles: MockArticle[];
  selectedFeedTitle: string;
  selectedFeedId: string | null;
  selectedTag: string | null;
  selectedSmartView: 'saved' | 'pinned' | 'unread' | 'all' | null;
  activeArticleHash: string | null;
  selectArticle: vi.Mock;
  setActiveArticle: vi.Mock;
  isLoadingArticles: boolean;
  isSavedListLoading: boolean;
  isGlobalLoadingIndicatorActive: boolean;
  articleViewOverlayPhase: 'closed' | 'opening' | 'open' | 'closing';
  newArticleHashes: Set<string>;
  error: string | null;
  totalFeeds: number;
  loadMoreArticles: vi.Mock;
  isLoadingMoreArticles: boolean;
  isLoadMoreInFlight: boolean;
};

const makeArticle = (index: number): MockArticle => ({
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
});

let mockFeedState: MockFeedState = {
  articles: [makeArticle(1)],
  articlesTotalCount: 1,
  savedArticles: [],
  selectedFeedTitle: 'Test Feed',
  selectedFeedId: 'feed-1',
  selectedTag: null as string | null,
  selectedSmartView: null as 'saved' | 'pinned' | 'unread' | 'all' | null,
  activeArticleHash: null as string | null,
  selectArticle: vi.fn(),
  setActiveArticle: vi.fn(),
  isLoadingArticles: false,
  isSavedListLoading: false,
  isGlobalLoadingIndicatorActive: false,
  articleViewOverlayPhase: 'closed',
  newArticleHashes: new Set<string>(),
  error: null as string | null,
  totalFeeds: 1,
  loadMoreArticles: vi.fn(),
  isLoadingMoreArticles: false,
  isLoadMoreInFlight: false,
};

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({
    selectedFeedTitle: mockFeedState.selectedFeedTitle,
    selectedFeedId: mockFeedState.selectedFeedId,
    selectedTag: mockFeedState.selectedTag,
    selectedSmartView: mockFeedState.selectedSmartView,
  }),
  useFeedCollection: (): unknown => ({
    articles: mockFeedState.articles,
    articlesTotalCount: mockFeedState.articlesTotalCount,
    savedArticles: mockFeedState.savedArticles,
    isLoadingArticles: mockFeedState.isLoadingArticles,
    isLoadingMoreArticles: mockFeedState.isLoadingMoreArticles,
    isLoadMoreInFlight: mockFeedState.isLoadMoreInFlight,
    isSavedListLoading: mockFeedState.isSavedListLoading,
    isGlobalLoadingIndicatorActive: mockFeedState.isGlobalLoadingIndicatorActive,
    loadMoreArticles: mockFeedState.loadMoreArticles,
    updateArticleInList: vi.fn(),
    newArticleHashes: mockFeedState.newArticleHashes,
    articleListScrollRequest: null,
    syncArticleListViewport: vi.fn(),
    searchCurrentSource: vi.fn(),
    clearArticleListSearch: vi.fn(),
  }),
  useFeedOverlay: () => ({
    activeArticleHash: mockFeedState.activeArticleHash,
    selectArticle: mockFeedState.selectArticle,
    setActiveArticle: mockFeedState.setActiveArticle,
    articleViewOverlayPhase: mockFeedState.articleViewOverlayPhase,
  }),
  useFeedUI: () => ({
    error: mockFeedState.error,
    totalFeeds: mockFeedState.totalFeeds,
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
    searchQuery: '',
    debouncedSearchQuery: '',
    isSearchOpen: false,
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

vi.mock('@/components/common/FeedLineLoader', () => ({
  FeedLineLoader: () => <div data-testid="mock-feed-line-loader" />,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (...args: unknown[]) => mockUseVirtualizer(...args),
}));

import { SharedArticleList } from '@/components/MainArea/SharedArticleList';

const renderSharedArticleList = () => render(<SharedArticleList variant="common" />);

describe('SharedArticleList error fallback behavior', () => {
  beforeEach(() => {
    mockUseVirtualizer.mockImplementation((config: { count: number }) => ({
      getTotalSize: () => config.count * 100,
      getVirtualItems: () => Array.from({ length: config.count }, (_, index) => ({
        key: `k-${index}`,
        index,
        start: index * 100,
      })),
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps rendering existing articles and hides error text when fetch errors occur', () => {
    mockFeedState = {
      ...mockFeedState,
      articles: [makeArticle(1), makeArticle(2)],
      articlesTotalCount: 2,
      error: 'Server returned an error. The feed may be temporarily unavailable.',
    };

    renderSharedArticleList();

    expect(screen.getByText('Article 1')).toBeInTheDocument();
    expect(screen.getByText('Article 2')).toBeInTheDocument();
    expect(screen.queryByText('Server returned an error. The feed may be temporarily unavailable.')).not.toBeInTheDocument();
  });

  it('shows blocking error when no existing articles are available', () => {
    mockFeedState = {
      ...mockFeedState,
      articles: [],
      articlesTotalCount: 0,
      error: 'Unable to connect to the feed URL.',
    };

    renderSharedArticleList();

    expect(screen.getByText('Unable to connect to the feed URL.')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-article-row')).not.toBeInTheDocument();
  });
});
