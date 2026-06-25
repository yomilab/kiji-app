import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SharedArticleList } from '@/components/MainArea/SharedArticleList';
import type { Article } from '@/types/article';

// Mock the contexts
const mockSelectArticle = vi.fn();
const mockSetActiveArticle = vi.fn();
const mockLoadMoreArticles = vi.fn();

const makeArticle = (overrides: Partial<Article> = {}): Article => ({
  hash: 'article-1',
  title: 'Article 1',
  description: '',
  content: '',
  fetchedDate: '2026-02-25T00:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  read: false,
  starred: false,
  saved: false,
  ...overrides,
});

const mockNavigationState = {
  selectedFeedId: 'feed-1' as string | null,
  selectedFeedTitle: 'Test Feed' as string | null,
  selectedTag: null as string | null,
  selectedSmartView: null as 'saved' | 'pinned' | 'unread' | 'all' | null,
  navigationNonce: 0,
};

const mockCollectionState = {
  articles: [] as Article[],
  articlesTotalCount: 0,
  savedArticles: [] as Article[],
  isLoadingArticles: true,
  isLoadingMoreArticles: false,
  isLoadMoreInFlight: false,
  isSavedListLoading: false,
  isGlobalLoadingIndicatorActive: true,
  loadMoreArticles: mockLoadMoreArticles,
  updateArticleInList: vi.fn(),
  newArticleHashes: new Set<string>(),
  articleListScrollRequest: null as unknown,
  syncArticleListViewport: vi.fn(),
  searchCurrentSource: vi.fn(),
  clearArticleListSearch: vi.fn(),
};

const mockOverlayState = {
  activeArticleHash: null as string | null,
  selectArticle: mockSelectArticle,
  setActiveArticle: mockSetActiveArticle,
  articleViewOverlayPhase: 'closed' as const,
};

const mockUIState = {
  error: null as string | null,
  totalFeeds: 1,
};

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => mockNavigationState,
  useFeedCollectionArticles: () => ({
    articles: mockCollectionState.articles,
    articlesTotalCount: mockCollectionState.articlesTotalCount,
    newArticleCount: 0,
    newArticleHashes: mockCollectionState.newArticleHashes,
    articleListScrollRequest: mockCollectionState.articleListScrollRequest,
  }),
  useFeedCollectionLoading: () => ({
    isLoadingArticles: mockCollectionState.isLoadingArticles,
    isLoadingMoreArticles: mockCollectionState.isLoadingMoreArticles,
    isLoadMoreInFlight: false,
    isSavedListLoading: mockCollectionState.isSavedListLoading,
    isFetchingNew: false,
    isGlobalLoadingIndicatorActive: mockCollectionState.isGlobalLoadingIndicatorActive,
  }),
  useFeedCollectionActions: () => ({
    loadMoreArticles: mockCollectionState.loadMoreArticles,
    updateArticleInList: mockCollectionState.updateArticleInList,
    searchCurrentSource: mockCollectionState.searchCurrentSource,
    clearArticleListSearch: mockCollectionState.clearArticleListSearch,
    syncArticleListViewport: mockCollectionState.syncArticleListViewport,
    refreshFeed: vi.fn(),
    reloadCurrentSourceFromStore: vi.fn(),
  }),
  useFeedCollection: () => mockCollectionState,
  useFeedOverlay: () => mockOverlayState,
  useFeedUI: () => mockUIState,
}));

// Mock virtualizer
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: (): Array<{ key: string; index: number; start: number }> => [],
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

// Mock hooks
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
  useArticleListLayoutResize: () => ({
    isDragging: false,
    widthStyle: {},
    showResizeHandle: false,
    handleBorderMouseDown: vi.fn(),
  }),
}));

// Mock the skeleton component
vi.mock('@/components/MainArea/ArticleListSkeleton', () => ({
  ArticleListHeaderSkeleton: () => <div data-testid="header-skeleton">Header Skeleton</div>,
  ArticleListSkeletonGroup: () => <div data-testid="list-skeleton">List Skeleton</div>,
}));

vi.mock('@/components/common/FeedLineLoader', () => ({
  FeedLineLoader: () => <div data-testid="mock-feed-line-loader" />,
}));

describe('SharedArticleList header skeleton', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    mockNavigationState.selectedFeedId = 'feed-1';
    mockNavigationState.selectedFeedTitle = 'Test Feed';
    mockNavigationState.selectedTag = null;
    mockNavigationState.selectedSmartView = null;
    mockCollectionState.articles = [];
    mockCollectionState.articlesTotalCount = 0;
    mockCollectionState.isLoadingArticles = true;
    mockCollectionState.isSavedListLoading = false;
    mockCollectionState.isGlobalLoadingIndicatorActive = true;
  });

  it('shows header skeleton when initial loading is true', () => {
    mockCollectionState.isLoadingArticles = true;
    mockCollectionState.articles = [];
    
    render(<SharedArticleList variant="common" />);
    
    expect(screen.getByTestId('header-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Test Feed')).not.toBeInTheDocument();
  });

  it('shows real title when loading is finished', () => {
    mockCollectionState.isLoadingArticles = false;
    mockCollectionState.isGlobalLoadingIndicatorActive = false;
    mockCollectionState.articles = [makeArticle()];
    mockCollectionState.articlesTotalCount = 1;
    
    render(<SharedArticleList variant="common" />);
    
    expect(screen.queryByTestId('header-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Test Feed')).toBeInTheDocument();
    expect(screen.getByText('1 Items')).toBeInTheDocument();
  });

  it('shows real title even when list is empty if selection exists', () => {
    mockCollectionState.isLoadingArticles = false;
    mockCollectionState.isGlobalLoadingIndicatorActive = false;
    mockCollectionState.articles = [];
    mockCollectionState.articlesTotalCount = 0;
    mockNavigationState.selectedFeedTitle = 'Empty Feed';
    
    render(<SharedArticleList variant="common" />);
    
    expect(screen.queryByTestId('header-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Empty Feed')).toBeInTheDocument();
    expect(screen.getByText('0 Items')).toBeInTheDocument();
  });

  it('uses saved-list loading state for the saved article list', () => {
    mockNavigationState.selectedFeedId = null;
    mockNavigationState.selectedFeedTitle = null;
    mockNavigationState.selectedSmartView = 'saved';
    mockCollectionState.isLoadingArticles = false;
    mockCollectionState.isSavedListLoading = true;
    mockCollectionState.isGlobalLoadingIndicatorActive = true;
    mockCollectionState.articles = [];

    render(<SharedArticleList variant="saved" />);

    expect(screen.getAllByTestId('header-skeleton').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('list-skeleton').length).toBeGreaterThan(0);
  });
});
