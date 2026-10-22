import type { Theme } from '@/services/settings/types';
import {
  THEME_DEBUG_ARTICLES,
  THEME_DEBUG_FEEDS,
  THEME_DEBUG_LONG_ARTICLE,
  THEME_DEBUG_TAGS,
} from './themeDebugFixtures';

export type ThemeDebugVariant =
  | 'sidebar-default'
  | 'sidebar-overflow'
  | 'article-list-populated'
  | 'article-list-long'
  | 'article-list-loading'
  | 'article-view-standalone'
  | 'article-view-long'
  | 'article-view-images'
  | 'article-view-embedded';

const EMPTY_HASHES = new Set<string>();
const NEW_ARTICLE_HASHES = new Set<string>(['theme-article-1', 'theme-article-3']);

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};

const baseNavigation = {
  selectedFeedId: 'feed-design',
  selectedFeedTitle: 'Design Systems Weekly',
  selectedTag: null,
  selectedSmartView: null,
  navigationNonce: 1,
  selectFeed: asyncNoop,
  selectTag: asyncNoop,
  selectSmartView: asyncNoop,
  clearFeedSelection: noop,
};

const baseCollectionActions = {
  refreshFeed: asyncNoop,
  reloadCurrentSourceFromStore: asyncNoop,
  loadMoreArticles: asyncNoop,
  updateArticleInList: noop,
  syncArticleListViewport: noop,
  searchCurrentSource: asyncNoop,
  clearArticleListSearch: asyncNoop,
  markCurrentSourceRead: asyncNoop,
};

const baseOverlay = {
  activeArticleHash: null,
  articleOpenTrigger: 0,
  articleCloseRequest: 0,
  isArticleClosing: false,
  articleViewOverlayPhase: 'closed' as const,
  selectArticle: noop,
  setActiveArticle: noop,
  requestCloseArticle: noop,
  completeArticleClose: noop,
  setArticleViewOverlayPhase: noop,
};

const baseUi = {
  error: null,
  totalFeeds: THEME_DEBUG_FEEDS.length,
  feedLibraryVersion: 1,
  feedFaviconRefreshed: null,
  clearError: noop,
  refreshTotalFeeds: asyncNoop,
  notifyFeedLibraryChanged: noop,
};

const populatedCollection = {
  articles: THEME_DEBUG_ARTICLES,
  articlesTotalCount: THEME_DEBUG_ARTICLES.length,
  articlesTotalKnown: true,
  pageWasFull: false,
  visibleListIntentGeneration: 1,
  searchStatus: 'idle' as const,
  isLoadingArticles: false,
  isLoadingMoreArticles: false,
  isLoadMoreInFlight: false,
  isSavedListLoading: false,
  newArticleCount: NEW_ARTICLE_HASHES.size,
  newArticleHashes: NEW_ARTICLE_HASHES,
  articleListScrollRequest: null,
};

const loadingCollection = {
  articles: [],
  articlesTotalCount: 0,
  articlesTotalKnown: true,
  pageWasFull: false,
  visibleListIntentGeneration: 1,
  searchStatus: 'idle' as const,
  isLoadingArticles: true,
  isLoadingMoreArticles: false,
  isLoadMoreInFlight: false,
  isSavedListLoading: false,
  newArticleCount: 0,
  newArticleHashes: EMPTY_HASHES,
  articleListScrollRequest: null,
};

const embeddedCollection = {
  ...populatedCollection,
  articles: [THEME_DEBUG_LONG_ARTICLE],
  articlesTotalCount: 1,
  newArticleCount: 0,
  newArticleHashes: EMPTY_HASHES,
};

const embeddedOverlay = {
  ...baseOverlay,
  activeArticleHash: THEME_DEBUG_LONG_ARTICLE.hash,
  articleOpenTrigger: 1,
  articleViewOverlayPhase: 'open' as const,
};

const variants = {
  'sidebar-default': {
    navigation: {
      ...baseNavigation,
      selectedFeedId: null,
      selectedFeedTitle: 'Unread',
      selectedSmartView: 'unread',
    },
    collection: populatedCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'sidebar-overflow': {
    navigation: {
      ...baseNavigation,
      selectedFeedId: 'feed-long',
      selectedFeedTitle: THEME_DEBUG_FEEDS[6].title,
    },
    collection: populatedCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'article-list-populated': {
    navigation: baseNavigation,
    collection: populatedCollection,
    actions: baseCollectionActions,
    overlay: {
      ...baseOverlay,
      activeArticleHash: THEME_DEBUG_ARTICLES[0].hash,
    },
    ui: baseUi,
  },
  'article-list-long': {
    navigation: {
      ...baseNavigation,
      selectedFeedId: 'feed-long',
      selectedFeedTitle: THEME_DEBUG_FEEDS[6].title,
    },
    collection: populatedCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'article-list-loading': {
    navigation: baseNavigation,
    collection: loadingCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'article-view-standalone': {
    navigation: baseNavigation,
    collection: populatedCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'article-view-long': {
    navigation: baseNavigation,
    collection: embeddedCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'article-view-images': {
    navigation: baseNavigation,
    collection: embeddedCollection,
    actions: baseCollectionActions,
    overlay: baseOverlay,
    ui: baseUi,
  },
  'article-view-embedded': {
    navigation: baseNavigation,
    collection: embeddedCollection,
    actions: baseCollectionActions,
    overlay: embeddedOverlay,
    ui: baseUi,
  },
} as const;

let activeVariant: ThemeDebugVariant = 'sidebar-default';
let activeTheme: Theme = 'light';

export function selectThemeDebugVariant(variant: ThemeDebugVariant): void {
  activeVariant = variant;
}

export function selectThemeDebugTheme(theme: Theme): void {
  activeTheme = theme;
}

export function getThemeDebugTheme(): Theme {
  return activeTheme;
}

export function getThemeDebugState() {
  return variants[activeVariant];
}

export function getThemeDebugFeeds() {
  return THEME_DEBUG_FEEDS;
}

export function getThemeDebugTags() {
  return THEME_DEBUG_TAGS;
}

export function setThemeDebugRootTheme(theme: Theme): void {
  const effectiveTheme = theme === 'auto' ? 'light' : theme;
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  document.documentElement.style.colorScheme = effectiveTheme;
}

