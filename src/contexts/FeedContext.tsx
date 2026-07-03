import React, { createContext, useContext, useCallback, ReactNode, useTransition, useRef, useReducer, useMemo } from 'react';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import * as articleStore from '@/stores/articleStore';
import { mergeUniqueArticlesByHash } from '@/services/articles/mergeUniqueArticlesByHash';
import { getInternedFeedMetadataCount } from '@/services/articles/articleListMemory';
import * as feedStore from '@/stores/feedStore';
import { getAllFeedMetadataCached } from '@/services/feeds/feedMetadataCache';
import {
  ensureTagFeedIdsCache,
  getCachedFeedIdsForTag,
  seedTagFeedIdsCache,
} from '@/services/tags/tagFeedIdsCache';
import type { Article } from '@/types/article';
import type { ArticleQuery } from '@/types/articleQuery';
import { FEED_FETCH_COOLDOWN_MS } from '@/constants';
import { maybeRefreshFavicon } from '@/services/favicons/faviconRefreshService';
import { getFeedRefreshBlock } from '@/services/feeds/feedRefreshPolicy';
import type { Feed } from '@/services/feeds/feedsManager';
import { logger } from '@/services/logger';
import { debugOnly } from '@/services/system/env';
import { getE2eConfig, writeE2eEvent } from '@/services/e2e/e2eHarness';
import { storage } from '@/services/storage/storageFactory';
import { useDependencyEffect, useMountEffect } from '@/hooks/useLifecycleEffects';
import type { SmartViewId } from '@/constants';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { isNativeFeedIngestionEnabled } from '@/services/scheduler/nativeSchedulerCycle';
import { runNativeFeedRefresh } from '@/services/scheduler/nativeFeedRefresh';
import {
  estimateSerializedArticleListKb,
  startRendererSessionMemoryDiagnostics,
} from '@/services/diagnostics/rendererSessionMemoryDiagnostics';
import { logListRefreshAttribution } from '@/services/diagnostics/webKitAttribution';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { feedRefreshCoordinator } from '@/services/feeds/feedRefreshCoordinator';
import { feedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { interactionPerformance } from '@/services/performance/interactionPerformance';
import { sidebarSwitchTrace, traceSidebarSwitchAsync } from '@/services/performance/sidebarSwitchTrace';
import { sourceSelectionBus } from '@/services/feeds/sourceSelectionBus';
import {
  cancelSourceSelectionRefreshSchedule,
  scheduleSourceRefreshAfterPaint,
  waitForArticleListPaintGate,
} from '@/services/feeds/sourceSelectionPaintGate';
import {
  LARGE_STATION_FEED_THRESHOLD,
  STATION_SWITCH_FOREGROUND_REFRESH_CAP,
  STATION_SWITCH_SQLITE_RECONCILE_LIMIT,
} from '@/services/feeds/stationSwitchLimits';
import type {
  FeedSourceRefreshPayload,
  TagSourceRefreshPayload,
  SourceRefreshIntent,
} from '@/services/feeds/sourceSelectionTypes';

const SMART_VIEW_ARTICLE_LIMIT = 100;
const ARTICLE_LIST_LOAD_MORE_LIMIT = 100;
const SOURCE_ARTICLE_SNAPSHOT_CACHE_MAX_ENTRIES = 8;
const SOURCE_ARTICLE_SNAPSHOT_MAX_ROWS = 500;
const STATION_REFRESH_WORKER_COUNT = 4;
const STATION_REFRESH_UI_BUDGET_POLL_MS = 50;
const SCHEDULER_UI_BATCH_DELAY_MS = 250;
const BACKGROUND_REFRESH_SCROLL_IDLE_DELAY_MS = 450;
/** After rapid station hops, retry cold-switch SQLite if skeleton is still up. */
const DEFERRED_SWITCH_SQLITE_RECOVERY_DELAY_MS = 250;
const DEFAULT_ARTICLE_LIST_SORT: NonNullable<ArticleQuery['sort']> = { field: 'publishedDate', order: 'desc' };
const LAST_SIDEBAR_SELECTION_KEY = 'last-sidebar-selection';
const HAS_PERFORMANCE_API = typeof performance !== 'undefined' && typeof performance.mark === 'function';
export type ArticleViewOverlayPhase = 'closed' | 'opening' | 'open' | 'closing';
export type ArticleListUpdatePayload = Partial<Pick<Article, 'read' | 'saved' | 'savedArticleId' | 'starred' | 'lastReadAt'>>;
type LoadMoreArticlesOptions = {
  showLoadingIndicator?: boolean;
  priority?: 'prefetch' | 'urgent';
};

type LoadMoreQueryMetric = {
  token: number;
  sourceKey: string | null;
  searchText: string | null;
  offset: number;
  requestedLimit: number;
  receivedCount: number;
  queryStartedAtMs: number;
  queryDurationMs: number;
  buffered: boolean;
};

type PendingLoadMoreCommitMetric = LoadMoreQueryMetric & {
  appendStartedAtMs: number;
  appendMode: 'urgent' | 'transition';
  minimumVisibleLength: number;
};

type SourceArticleListSnapshot = {
  list: Article[];
  total: number;
  query: ArticleQuery | null;
};

const getArticlePaginationCursor = (article: Article | undefined): ArticleQuery['cursor'] | undefined => {
  if (!article) {
    return undefined;
  }

  const effectiveDate = article.publishedDate || article.fetchedDate;
  return effectiveDate ? { effectiveDate, hash: article.hash } : undefined;
};

const createTagArticleListQuery = (tagName: string, searchText?: string | null): ArticleQuery => {
  const normalizedSearchText = searchText?.trim();
  return {
    tagName,
    limit: SMART_VIEW_ARTICLE_LIMIT,
    sort: DEFAULT_ARTICLE_LIST_SORT,
    ...(normalizedSearchText ? { searchText: normalizedSearchText } : {}),
  };
};

const getPerformanceTimeMs = (): number => {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
};

const yieldToArticleListPrefetchFrame = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    window.setTimeout(resolve, 0);
  });
};
export type FeedEditTarget =
  | { kind: 'feed'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'smart-view'; id: SmartViewId };

type SmartViewType = 'saved' | 'pinned' | 'unread' | 'all';

type SidebarSelectionSnapshot =
  | { type: 'feed'; feedId: string }
  | { type: 'tag'; tagName: string }
  | { type: 'smart'; viewType: SmartViewType };

type RefreshTriggerOptions = {
  forceNetwork?: boolean;
  /** Station switch bypasses failure backoff but still respects the 60s fetch cooldown. */
  bypassBackoff?: boolean;
};

type RefreshFeedFromNetworkOptions = {
  updateCounts?: boolean;
  waitForUiBudget?: () => Promise<void>;
  onFetchSettled?: () => void;
  skipNativeActivityQueue?: boolean;
};

type FeedNetworkRefreshResult = {
  inserted: number;
};

// ─── Specialized Context Types ───

interface NavigationState {
  selectedFeedId: string | null;
  selectedFeedTitle: string | null;
  selectedTag: string | null;
  selectedSmartView: SmartViewType | null;
  isFeedEditView: boolean;
  feedEditTarget: FeedEditTarget | null;
  navigationNonce: number;
}

interface NavigationActions {
  selectFeed: (feedId: string, feedUrl: string, feedTitle: string, options?: RefreshTriggerOptions) => Promise<void>;
  selectTag: (tagName: string, options?: RefreshTriggerOptions, feedIdsHint?: string[]) => Promise<void>;
  selectSmartView: (viewType: SmartViewType) => Promise<void>;
  clearFeedSelection: () => void;
  openFeedEditView: (target?: FeedEditTarget) => void;
  closeFeedEditView: () => void;
  clearFeedEditTarget: () => void;
}

interface CollectionState {
  articles: Article[];
  articlesTotalCount: number;
  isLoadingArticles: boolean;
  isLoadingMoreArticles: boolean;
  isLoadMoreInFlight: boolean;
  isSavedListLoading: boolean;
  newArticleCount: number;
  newArticleHashes: Set<string>;
  articleListScrollRequest: ArticleListScrollRequest | null;
}

export type CollectionArticlesState = Pick<
  CollectionState,
  'articles' | 'articlesTotalCount' | 'newArticleCount' | 'newArticleHashes' | 'articleListScrollRequest'
>;

export type CollectionLoadingState = Pick<
  CollectionState,
  | 'isLoadingArticles'
  | 'isLoadingMoreArticles'
  | 'isLoadMoreInFlight'
  | 'isSavedListLoading'
>;

interface ArticleListViewportSnapshot {
  isSearchActive: boolean;
  isAtTop: boolean;
  anchorHash: string | null;
  scrollTop?: number;
  isScrolling?: boolean;
}

export interface ArticleListScrollRequest {
  revision: number;
  mode: 'top' | 'anchor';
  anchorHash: string | null;
  preserveScrollTop?: number;
  prependedItemCount?: number;
}

interface CollectionActions {
  refreshFeed: () => Promise<void>;
  reloadCurrentSourceFromStore: () => Promise<void>;
  loadMoreArticles: (options?: LoadMoreArticlesOptions) => Promise<void>;
  updateArticleInList: (hash: string, updates?: ArticleListUpdatePayload) => void;
  syncArticleListViewport: (snapshot: ArticleListViewportSnapshot) => void;
  searchCurrentSource: (query: string) => Promise<void>;
  clearArticleListSearch: () => Promise<void>;
}

interface OverlayState {
  activeArticleHash: string | null;
  articleOpenTrigger: number;
  articleCloseRequest: number;
  isArticleClosing: boolean;
  articleViewOverlayPhase: ArticleViewOverlayPhase;
}

interface OverlayActions {
  selectArticle: (articleId: string) => void;
  setActiveArticle: (articleId: string | null) => void;
  requestCloseArticle: () => void;
  completeArticleClose: () => void;
  setArticleViewOverlayPhase: (phase: ArticleViewOverlayPhase) => void;
}

interface UIState {
  error: string | null;
  totalFeeds: number;
  feedLibraryVersion: number;
  feedFaviconRefreshed: { feedId: string } | null;
}

interface UIActions {
  clearError: () => void;
  refreshTotalFeeds: () => Promise<void>;
  notifyFeedLibraryChanged: () => void;
}

// ─── Unified Context Type (Backward Compatibility) ───

export interface FeedContextType extends NavigationState, NavigationActions, CollectionArticlesState, CollectionLoadingState, CollectionActions, OverlayState, OverlayActions, UIState, UIActions {}

const NavigationContext = createContext<(NavigationState & NavigationActions) | undefined>(undefined);
const CollectionArticlesContext = createContext<CollectionArticlesState | undefined>(undefined);
const CollectionLoadingContext = createContext<CollectionLoadingState | undefined>(undefined);
const CollectionActionsContext = createContext<CollectionActions | undefined>(undefined);
const OverlayContext = createContext<(OverlayState & OverlayActions) | undefined>(undefined);
const UIContext = createContext<(UIState & UIActions) | undefined>(undefined);
const UIActionsContext = createContext<UIActions | undefined>(undefined);
const FeedFaviconRefreshedContext = createContext<UIState['feedFaviconRefreshed'] | undefined>(undefined);

// ─── Reducers ───

type NavigationAction =
  | { type: 'NAVIGATE_FEED'; payload: { id: string; title: string } }
  | { type: 'NAVIGATE_TAG'; payload: string }
  | { type: 'NAVIGATE_SMART'; payload: SmartViewType }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'OPEN_EDIT_VIEW'; payload: FeedEditTarget | null }
  | { type: 'CLOSE_EDIT_VIEW' }
  | { type: 'CLEAR_EDIT_TARGET' };

function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'NAVIGATE_FEED':
      return {
        ...state,
        selectedFeedId: action.payload.id,
        selectedFeedTitle: action.payload.title,
        selectedTag: null,
        selectedSmartView: null,
        isFeedEditView: false,
        navigationNonce: state.navigationNonce + 1,
      };
    case 'NAVIGATE_TAG':
      return {
        ...state,
        selectedFeedId: null,
        selectedFeedTitle: action.payload,
        selectedTag: action.payload,
        selectedSmartView: null,
        isFeedEditView: false,
        navigationNonce: state.navigationNonce + 1,
      };
    case 'NAVIGATE_SMART':
      return {
        ...state,
        selectedFeedId: null,
        selectedFeedTitle: action.payload === 'saved' ? 'Saved' : action.payload === 'pinned' ? 'Pinned' : action.payload === 'unread' ? 'Unread' : 'All Items',
        selectedTag: null,
        selectedSmartView: action.payload,
        isFeedEditView: false,
        navigationNonce: state.navigationNonce + 1,
      };
    case 'CLEAR_SELECTION':
      return { ...state, selectedFeedId: null, selectedFeedTitle: null, selectedTag: null, selectedSmartView: null, isFeedEditView: false, navigationNonce: state.navigationNonce + 1 };
    case 'OPEN_EDIT_VIEW':
      return { ...state, selectedFeedId: null, selectedTag: null, selectedSmartView: null, isFeedEditView: true, feedEditTarget: action.payload, navigationNonce: state.navigationNonce + 1 };
    case 'CLOSE_EDIT_VIEW':
      return { ...state, isFeedEditView: false, navigationNonce: state.navigationNonce + 1 };
    case 'CLEAR_EDIT_TARGET':
      return { ...state, feedEditTarget: null };
    default:
      return state;
  }
}

type CollectionAction =
  | { type: 'SET_ARTICLES'; payload: { list: Article[]; total: number } }
  | {
    type: 'APPLY_BACKGROUND_REFRESH';
    payload: {
      list: Article[];
      total: number;
      newArticleHashes: Set<string>;
      scrollRequest: ArticleListScrollRequest | null;
    };
  }
  | { type: 'APPEND_ARTICLES'; payload: Article[] }
  | { type: 'UPDATE_ARTICLE'; payload: { hash: string; updates: ArticleListUpdatePayload; removeFromUnread?: boolean; removeFromSaved?: boolean } }
  | { type: 'SET_LOADING'; payload: Partial<CollectionState> }
  | { type: 'RESET_ARTICLES' }
  | { type: 'RESTORE_SOURCE_SNAPSHOT'; payload: { list: Article[]; total: number } }
  | { type: 'RESET_FOR_SOURCE_SWITCH' };

const areArticleListsEquivalent = (current: Article[], next: Article[]): boolean => {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let i = 0; i < current.length; i += 1) {
    const a = current[i];
    const b = next[i];
    if (
      a.hash !== b.hash
      || a.title !== b.title
      || a.description !== b.description
      || a.read !== b.read
      || a.saved !== b.saved
      || a.starred !== b.starred
      || (a.feedTitle ?? '') !== (b.feedTitle ?? '')
      || (a.feedFavicon ?? '') !== (b.feedFavicon ?? '')
      || (a.feedFaviconHasTransparency ? '1' : '0') !== (b.feedFaviconHasTransparency ? '1' : '0')
      || (a.feedFaviconBgLight ?? '') !== (b.feedFaviconBgLight ?? '')
      || (a.feedFaviconBgDark ?? '') !== (b.feedFaviconBgDark ?? '')
      || (a.publishedDate ?? '') !== (b.publishedDate ?? '')
      || (a.previewImage ?? '') !== (b.previewImage ?? '')
    ) {
      return false;
    }
  }

  return true;
};

const logFeedRefreshSkip = (feed: Pick<Feed, 'id' | 'title'>, refreshBlock: ReturnType<typeof getFeedRefreshBlock>) => {
  if (!refreshBlock) return;

  logger.info('FeedContext', 'Skipping UI feed refresh', {
    feedId: feed.id,
    feedTitle: feed.title,
    reason: refreshBlock.kind,
    waitMs: refreshBlock.waitMs,
    failures: refreshBlock.failureCount,
  });
};

function collectionReducer(state: CollectionState, action: CollectionAction): CollectionState {
  switch (action.type) {
    case 'SET_ARTICLES':
      if (
        state.articlesTotalCount === action.payload.total &&
        areArticleListsEquivalent(state.articles, action.payload.list)
      ) {
        return state;
      }
      return { ...state, articles: action.payload.list, articlesTotalCount: action.payload.total };
    case 'APPLY_BACKGROUND_REFRESH':
      return {
        ...state,
        articles: action.payload.list,
        articlesTotalCount: action.payload.total,
        newArticleCount: action.payload.newArticleHashes.size,
        newArticleHashes: action.payload.newArticleHashes,
        articleListScrollRequest: action.payload.scrollRequest,
      };
    case 'APPEND_ARTICLES':
      if (action.payload.length === 0) return state;
      return { ...state, articles: mergeUniqueArticlesByHash(state.articles, action.payload) };
    case 'UPDATE_ARTICLE': {
      const { hash, updates, removeFromUnread, removeFromSaved } = action.payload;
      let nextArticles = state.articles;
      let nextTotal = state.articlesTotalCount;

      if (removeFromUnread || removeFromSaved) {
        const index = nextArticles.findIndex(a => a.hash === hash);
        if (index !== -1) {
          nextArticles = nextArticles.filter(a => a.hash !== hash);
          nextTotal = Math.max(0, nextTotal - 1);
        }
      } else {
        nextArticles = nextArticles.map(a => a.hash === hash ? { ...a, ...updates } : a);
      }

      return { ...state, articles: nextArticles, articlesTotalCount: nextTotal };
    }
    case 'SET_LOADING':
      for (const [key, value] of Object.entries(action.payload)) {
        if (state[key as keyof CollectionState] !== value) {
          return { ...state, ...action.payload };
        }
      }
      return state;
    case 'RESET_ARTICLES':
      return {
        ...state,
        articles: [],
        articlesTotalCount: 0,
        newArticleCount: 0,
        newArticleHashes: new Set<string>(),
        articleListScrollRequest: null,
      };
    case 'RESTORE_SOURCE_SNAPSHOT':
      if (
        state.articlesTotalCount === action.payload.total
        && areArticleListsEquivalent(state.articles, action.payload.list)
        && !state.isLoadingArticles
        && !state.isSavedListLoading
        && !state.isLoadingMoreArticles
        && !state.isLoadMoreInFlight
      ) {
        return state;
      }
      return {
        ...state,
        articles: action.payload.list,
        articlesTotalCount: action.payload.total,
        newArticleCount: 0,
        newArticleHashes: new Set<string>(),
        articleListScrollRequest: null,
        isLoadingArticles: false,
        isSavedListLoading: false,
        isLoadingMoreArticles: false,
        isLoadMoreInFlight: false,
      };
    case 'RESET_FOR_SOURCE_SWITCH':
      if (
        state.articles.length === 0
        && state.articlesTotalCount === 0
        && state.isLoadingArticles
        && !state.isSavedListLoading
        && !state.isLoadingMoreArticles
        && !state.isLoadMoreInFlight
      ) {
        return state;
      }
      return {
        ...state,
        articles: [],
        articlesTotalCount: 0,
        newArticleCount: 0,
        newArticleHashes: new Set<string>(),
        articleListScrollRequest: null,
        isLoadingArticles: true,
        isSavedListLoading: false,
        isLoadingMoreArticles: false,
        isLoadMoreInFlight: false,
      };
    default:
      return state;
  }
}

type OverlayAction =
  | { type: 'SET_ACTIVE'; payload: string | null; trigger?: boolean }
  | { type: 'REQUEST_CLOSE' }
  | { type: 'COMPLETE_CLOSE' }
  | { type: 'SET_PHASE'; payload: ArticleViewOverlayPhase };

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case 'SET_ACTIVE':
      return {
        ...state,
        activeArticleHash: action.payload,
        articleOpenTrigger: action.trigger ? state.articleOpenTrigger + 1 : state.articleOpenTrigger
      };
    case 'REQUEST_CLOSE':
      // Closing is a two-step lifecycle: shared callers request a close, and
      // ArticleView completes it after the exit animation has finished.
      return {
        ...state,
        articleCloseRequest: state.articleCloseRequest + 1,
        isArticleClosing: true,
        articleViewOverlayPhase: 'closing',
      };
    case 'COMPLETE_CLOSE':
      // Preserve the active row highlight, but release the global overlay lock
      // so the main library UI becomes interactive again.
      return {
        ...state,
        isArticleClosing: false,
        articleViewOverlayPhase: 'closed',
      };
    case 'SET_PHASE':
      return { ...state, articleViewOverlayPhase: action.payload };
    default:
      return state;
  }
}

type UIAction =
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_TOTAL_FEEDS'; payload: number }
  | { type: 'INCREMENT_VERSION' }
  | { type: 'SET_FAVICON_REFRESHED'; payload: { feedId: string } | null };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_TOTAL_FEEDS':
      return { ...state, totalFeeds: action.payload };
    case 'INCREMENT_VERSION':
      return { ...state, feedLibraryVersion: state.feedLibraryVersion + 1 };
    case 'SET_FAVICON_REFRESHED':
      return { ...state, feedFaviconRefreshed: action.payload };
    default:
      return state;
  }
}

function createArticleListQuery(query: Omit<ArticleQuery, 'limit' | 'sort'>): ArticleQuery {
  return {
    ...query,
    limit: SMART_VIEW_ARTICLE_LIMIT,
    sort: DEFAULT_ARTICLE_LIST_SORT,
  };
}

type RefreshSourceDescriptor =
  | { type: 'feed'; key: string; feedId: string }
  | { type: 'tag'; key: string; tagName: string }
  | { type: 'smart'; key: string; viewType: SmartViewType };

const getRefreshSourceDescriptor = (navigationState: NavigationState): RefreshSourceDescriptor | null => {
  if (navigationState.selectedFeedId) {
    return {
      type: 'feed',
      key: `feed:${navigationState.selectedFeedId}`,
      feedId: navigationState.selectedFeedId,
    };
  }

  if (navigationState.selectedTag) {
    return {
      type: 'tag',
      key: `tag:${navigationState.selectedTag}`,
      tagName: navigationState.selectedTag,
    };
  }

  if (navigationState.selectedSmartView) {
    return {
      type: 'smart',
      key: `smart:${navigationState.selectedSmartView}`,
      viewType: navigationState.selectedSmartView,
    };
  }

  return null;
};

export const FeedProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [navigationState, navigationDispatch] = useReducer(navigationReducer, {
    selectedFeedId: null,
    selectedFeedTitle: null,
    selectedTag: null,
    selectedSmartView: null,
    isFeedEditView: false,
    feedEditTarget: null,
    navigationNonce: 0,
  });
  const [collectionState, collectionDispatch] = useReducer(collectionReducer, {
    articles: [],
    articlesTotalCount: 0,
    isLoadingArticles: false,
    isLoadingMoreArticles: false,
    isLoadMoreInFlight: false,
    isSavedListLoading: false,
    newArticleCount: 0,
    newArticleHashes: new Set<string>(),
    articleListScrollRequest: null,
  });
  const [overlayState, overlayDispatch] = useReducer(overlayReducer, {
    activeArticleHash: null,
    articleOpenTrigger: 0,
    articleCloseRequest: 0,
    isArticleClosing: false,
    articleViewOverlayPhase: 'closed',
  });
  const [uiState, uiDispatch] = useReducer(uiReducer, {
    error: null,
    totalFeeds: 0,
    feedLibraryVersion: 0,
    feedFaviconRefreshed: null,
  });

  const selectionTokenRef = useRef(0);
  const immediateSwitchPaintTokenRef = useRef(0);
  const selectionAbortControllerRef = useRef<AbortController | null>(null);
  const selectionSchedulerPauseTokenRef = useRef<number | null>(null);
  const interactiveRefreshScopeTokenRef = useRef(0);
  const lastQueryRef = useRef<ArticleQuery | null>(null);
  const hasAttemptedSidebarRestoreRef = useRef(false);
  const backgroundScrollRequestRevisionRef = useRef(0);
  const activeSourceRef = useRef<RefreshSourceDescriptor | null>(null);
  const currentArticlesRef = useRef<Article[]>([]);
  const nonSearchArticlesRef = useRef<Article[]>([]);
  const nonSearchArticlesTotalCountRef = useRef(0);
  const articleListSearchActiveRef = useRef(false);
  const articleListSearchQueryRef = useRef<string | null>(null);
  const articleListSearchRevisionRef = useRef(0);
  const articleListAtTopRef = useRef(true);
  const articleListAnchorHashRef = useRef<string | null>(null);
  const articleListScrollTopRef = useRef(0);
  const articleListScrollActiveRef = useRef(false);
  const articleListScrollIdleTimerRef = useRef<number | null>(null);
  const pendingLoadMoreCommitMetricRef = useRef<PendingLoadMoreCommitMetric | null>(null);
  const backgroundRefreshInFlightRef = useRef(false);
  const pendingBackgroundRefreshSourceKeyRef = useRef<string | null>(null);
  const sourceArticleSnapshotCacheRef = useRef<Map<string, SourceArticleListSnapshot>>(new Map());
  const pendingSchedulerFeedUpdatesRef = useRef<Map<string, number>>(new Map());
  const schedulerUiBatchTimerRef = useRef<number | null>(null);
  const schedulerUiFlushInFlightRef = useRef(false);
  const schedulerUiFlushQueuedRef = useRef(false);
  const stationUiBatchTimerRef = useRef<number | null>(null);
  const pendingStationRefreshSourceKeyRef = useRef<string | null>(null);
  const pendingSwitchVisibleReconcileRef = useRef<{
    token: number;
    sourceKey: string;
    tagQuery: ArticleQuery;
  } | null>(null);
  const stationSwitchSideWorkGenerationRef = useRef(0);
  const cancelStationSwitchIdleWorkRef = useRef<(() => void) | null>(null);
  const deferredSwitchRecoveryTimerRef = useRef<number | null>(null);
  const articleViewOverlayPhaseRef = useRef<ArticleViewOverlayPhase>('closed');
  const activeArticleHashRef = useRef<string | null>(null);
  const isFeedProviderMountedRef = useRef(false);

  const refreshFeedFromNetwork = useCallback(async (
    feed: Feed,
    options?: RefreshFeedFromNetworkOptions,
    signal?: AbortSignal,
  ): Promise<FeedNetworkRefreshResult> => {
    const waitForUiBudget = async (): Promise<void> => {
      if (!options?.waitForUiBudget) {
        return;
      }

      await options.waitForUiBudget();
    };

    return await feedRefreshCoordinator.run(feed.id, async () => {
      if (signal?.aborted) return { inserted: 0 };
      await waitForUiBudget();
      if (signal?.aborted) return { inserted: 0 };

      if (isNativeFeedIngestionEnabled()) {
        let fetchSettled = false;
        const settleFetch = (): void => {
          if (fetchSettled) {
            return;
          }
          fetchSettled = true;
          options?.onFetchSettled?.();
        };

        try {
          const nativeResult = await runNativeFeedRefresh({
            feedIds: [feed.id],
            forceRefreshFeedIds: new Set([feed.id]),
            signal,
            activityKind: 'foreground',
            skipActivityQueue: options?.skipNativeActivityQueue,
            onFeedSettled: settleFetch,
          });
          settleFetch();

          const feedResult = nativeResult.feedResults.find((result) => result.feedId === feed.id);
          if (feedResult?.error) {
            throw new Error(feedResult.error);
          }

          const inserted = nativeResult.insertedByFeedId.get(feed.id) ?? 0;
          const updates: Partial<Feed> = {
            lastFetched: new Date(),
            lastFailedFetchAt: undefined,
            consecutiveFailures: 0,
          };

          if (options?.updateCounts) {
            const syncedCounts = await articleStore.syncFeedCountsBatch([feed.id]);
            const counts = syncedCounts[0];
            if (counts) {
              updates.unreadCount = counts.unreadCount;
              updates.articleCount = counts.articleCount;
              feedLibraryMutationBus.publishFeedsCountsUpdated([{
                feedId: feed.id,
                unreadCount: counts.unreadCount,
                articleCount: counts.articleCount,
              }]);
            }
          }

          await feedsManager.updateFeed(feed.id, updates);
          return { inserted };
        } catch (error) {
          settleFetch();
          throw error;
        }
      }

      // Successful UI-triggered refreshes clear any prior failure backoff so the
      // feed immediately returns to the normal freshness/cooldown path.
      const networkResult = await feedRefreshActivity.track(feed.id, () =>
        feedsFetcher.fetchFeedNetworkWithCache(feed.url, { signal }),
      );
      options?.onFetchSettled?.();
      if (signal?.aborted) return { inserted: 0 };
      await waitForUiBudget();
      if (signal?.aborted) return { inserted: 0 };

      if (networkResult.notModified || !networkResult.data) {
        await feedsManager.updateFeed(feed.id, {
          lastFetched: new Date(),
          lastFailedFetchAt: undefined,
          consecutiveFailures: 0,
          etag: networkResult.etag,
          lastModifiedHeader: networkResult.lastModified,
        });
        return { inserted: 0 };
      }

      await waitForUiBudget();
      if (signal?.aborted) return { inserted: 0 };

      const stored = await storeParsedFeedContent({
        feedId: feed.id,
        feedUrl: feed.url,
        feed,
        rawText: networkResult.data,
        signal,
      });
      if (signal?.aborted) return { inserted: 0 };

      // [DEDUPLICATION_DEBUG]
      debugOnly(() => {
        logger.info('FeedContext', `Refresh results for ${feed.title}`, {
          feedId: feed.id,
          total: stored.articles.length,
          inserted: stored.insertedCount,
          skipped: stored.articles.length - stored.insertedCount,
        });
      });

      const updates: Partial<Feed> = {
        lastFetched: new Date(),
        lastFailedFetchAt: undefined,
        consecutiveFailures: 0,
        etag: networkResult.etag,
        lastModifiedHeader: networkResult.lastModified,
        updateFrequencyScore: stored.updateFrequencyScore ?? feed.updateFrequencyScore,
      };

      if (options?.updateCounts) {
        const syncedCounts = await articleStore.syncFeedCountsBatch([feed.id]);
        const counts = syncedCounts[0];
        if (counts) {
          updates.unreadCount = counts.unreadCount;
          updates.articleCount = counts.articleCount;
          feedLibraryMutationBus.publishFeedsCountsUpdated([{
            feedId: feed.id,
            unreadCount: counts.unreadCount,
            articleCount: counts.articleCount,
          }]);
        }
      }

      await feedsManager.updateFeed(feed.id, updates);
      return { inserted: stored.insertedCount };
    }, { signal });
  }, []);

  const recordFeedRefreshFailure = useCallback(async (feed: Feed, error: unknown) => {
    // Persist UI refresh failures with the same metadata used by the scheduler
    // so repeated station/feed clicks respect exponential backoff.
    const nextFailures = (feed.consecutiveFailures ?? 0) + 1;
    const failedAt = new Date();
    const message = error instanceof Error ? error.message : 'Unknown error';

    logger.warn('FeedContext', 'Feed fetch failed from UI refresh', {
      feedId: feed.id,
      feedTitle: feed.title,
      consecutiveFailures: nextFailures,
      error: message,
    });

    await feedsManager.updateFeed(feed.id, {
      consecutiveFailures: nextFailures,
      lastFailedFetchAt: failedAt,
    });
  }, []);
  const prevNavRef = useRef<{ id: string | null, tag: string | null, smart: string | null }>({ id: null, tag: null, smart: null });
  const hasBootstrappedTotalFeedsRef = useRef(false);
  // Scroll events can fire before React publishes loading state. A ref lock
  // prevents concurrent pagination requests for the same window.
  const loadMoreInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshSourceKeyRef = useRef<string | null>(null);
  const activeRefreshSourceKeyRef = useRef<string | null>(null);
  const [, startTransition] = useTransition();

  const isSelectionActive = useCallback((token: number): boolean => {
    const controller = selectionAbortControllerRef.current;
    if (!controller) return false;
    return token === selectionTokenRef.current && !controller.signal.aborted;
  }, []);

  const dispatchArticlesTransition = useCallback((list: Article[], total: number) => {
    // Treat full-list swaps as non-urgent so rapid sidebar navigation can keep
    // updating selection affordances while the heavier article tree catches up.
    startTransition(() => {
      collectionDispatch({ type: 'SET_ARTICLES', payload: { list, total } });
    });
  }, [startTransition]);

  const dispatchArticlesTransitionIfChanged = useCallback((list: Article[], total: number): boolean => {
    const isSearchActive = articleListSearchQueryRef.current !== null;

    if (isSearchActive) {
      if (areArticleListsEquivalent(currentArticlesRef.current, list)) {
        return false;
      }

      currentArticlesRef.current = list;
      dispatchArticlesTransition(list, total);
      return true;
    }

    if (
      nonSearchArticlesTotalCountRef.current === total
      && areArticleListsEquivalent(currentArticlesRef.current, list)
    ) {
      return false;
    }

    currentArticlesRef.current = list;
    nonSearchArticlesRef.current = list;
    nonSearchArticlesTotalCountRef.current = total;
    dispatchArticlesTransition(list, total);
    return true;
  }, [dispatchArticlesTransition]);

  const rememberSourceArticleSnapshot = useCallback((
    sourceKey: string,
    list: Article[],
    total: number,
    query: ArticleQuery | null
  ) => {
    if (list.length === 0) {
      return;
    }

    const cache = sourceArticleSnapshotCacheRef.current;
    const boundedList = list.length > SOURCE_ARTICLE_SNAPSHOT_MAX_ROWS
      ? list.slice(0, SOURCE_ARTICLE_SNAPSHOT_MAX_ROWS)
      : list;

    cache.delete(sourceKey);
    cache.set(sourceKey, { list: boundedList, total, query });

    while (cache.size > SOURCE_ARTICLE_SNAPSHOT_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      cache.delete(oldestKey);
    }
  }, []);

  const restoreSourceArticleSnapshot = useCallback((sourceKey: string): SourceArticleListSnapshot | null => {
    const snapshot = sourceArticleSnapshotCacheRef.current.get(sourceKey);
    if (!snapshot) {
      return null;
    }

    rememberSourceArticleSnapshot(sourceKey, snapshot.list, snapshot.total, snapshot.query);
    currentArticlesRef.current = snapshot.list;
    nonSearchArticlesRef.current = snapshot.list;
    nonSearchArticlesTotalCountRef.current = snapshot.total;
    lastQueryRef.current = snapshot.query;
    collectionDispatch({
      type: 'RESTORE_SOURCE_SNAPSHOT',
      payload: { list: snapshot.list, total: snapshot.total },
    });

    return snapshot;
  }, [rememberSourceArticleSnapshot]);

  const yieldToSelectionCoalescing = useCallback(async (token: number): Promise<boolean> => {
    // Give the event loop one turn before local list work so a burst of sidebar
    // clicks can cancel stale selections before they queue more IPC + mapping.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    return isSelectionActive(token);
  }, [isSelectionActive]);

  const clearStationUiRefreshTimer = useCallback(() => {
    if (stationUiBatchTimerRef.current !== null) {
      window.clearTimeout(stationUiBatchTimerRef.current);
      stationUiBatchTimerRef.current = null;
    }
    pendingStationRefreshSourceKeyRef.current = null;
  }, []);

  const cancelStationSwitchSideWork = useCallback(() => {
    stationSwitchSideWorkGenerationRef.current += 1;
    cancelStationSwitchIdleWorkRef.current?.();
    cancelStationSwitchIdleWorkRef.current = null;
  }, []);

  const isStationSwitchSideWorkCurrent = useCallback((token: number, generation: number): boolean => {
    return isSelectionActive(token) && generation === stationSwitchSideWorkGenerationRef.current;
  }, [isSelectionActive]);

  const abortSelectionSwitchPriority = useCallback((token?: number) => {
    feedRefreshActivity.releaseAllForegroundQueued();
    if (selectionSchedulerPauseTokenRef.current === null) {
      return;
    }
    if (token !== undefined && selectionSchedulerPauseTokenRef.current !== token) {
      return;
    }
    feedScheduler.releaseStationSelectionPause('selection-changed');
    selectionSchedulerPauseTokenRef.current = null;
  }, []);

  const completeSelectionSwitchNetworkPriority = useCallback((token: number) => {
    if (selectionSchedulerPauseTokenRef.current === token) {
      feedScheduler.resumeAfterStationSelection();
      selectionSchedulerPauseTokenRef.current = null;
    }
  }, []);

  const beginSelectionSwitchNetworkPriority = useCallback((token: number) => {
    feedScheduler.pauseForStationSelection();
    selectionSchedulerPauseTokenRef.current = token;
  }, []);

  const beginSelectionRequest = useCallback((): number => {
    const previousToken = selectionTokenRef.current;
    abortSelectionSwitchPriority();
    selectionAbortControllerRef.current?.abort();
    pendingLoadMoreCommitMetricRef.current = null;
    pendingBackgroundRefreshSourceKeyRef.current = null;
    pendingSwitchVisibleReconcileRef.current = null;
    clearStationUiRefreshTimer();
    if (deferredSwitchRecoveryTimerRef.current !== null) {
      window.clearTimeout(deferredSwitchRecoveryTimerRef.current);
      deferredSwitchRecoveryTimerRef.current = null;
    }
    cancelStationSwitchSideWork();
    cancelSourceSelectionRefreshSchedule();
    const controller = new AbortController();
    selectionAbortControllerRef.current = controller;
    selectionTokenRef.current += 1;
    if (previousToken > 0) {
      sidebarSwitchTrace.cancel(previousToken, 'superseded');
    }
    const token = selectionTokenRef.current;
    feedScheduler.acknowledgeSidebarInteraction();
    beginSelectionSwitchNetworkPriority(token);
    return token;
  }, [abortSelectionSwitchPriority, beginSelectionSwitchNetworkPriority, cancelStationSwitchSideWork, clearStationUiRefreshTimer]);

  const clearArticleListScrollIdleState = useCallback(() => {
    if (articleListScrollIdleTimerRef.current !== null) {
      window.clearTimeout(articleListScrollIdleTimerRef.current);
      articleListScrollIdleTimerRef.current = null;
    }
    articleListScrollActiveRef.current = false;
  }, []);

  const queueLoadMoreCommitMetric = useCallback((
    metric: LoadMoreQueryMetric,
    appendMode: 'urgent' | 'transition'
  ) => {
    if (metric.receivedCount === 0) {
      return;
    }

    pendingLoadMoreCommitMetricRef.current = {
      ...metric,
      appendMode,
      appendStartedAtMs: getPerformanceTimeMs(),
      minimumVisibleLength: metric.offset + 1,
    };
  }, []);

  const waitForStationRefreshUiBudget = useCallback(async (signal?: AbortSignal): Promise<void> => {
    while (!signal?.aborted && (articleListScrollActiveRef.current || loadMoreInFlightRef.current)) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, STATION_REFRESH_UI_BUDGET_POLL_MS);
      });
    }

    if (!signal?.aborted) {
      await yieldToArticleListPrefetchFrame();
    }
  }, []);

  const clearError = useCallback(() => {
    uiDispatch({ type: 'SET_ERROR', payload: null });
  }, []);

  const refreshTotalFeeds = useCallback(async () => {
    const count = await feedStore.getCount();
    uiDispatch({ type: 'SET_TOTAL_FEEDS', payload: count });
  }, []);

  const notifyFeedLibraryChanged = useCallback(() => {
    uiDispatch({ type: 'INCREMENT_VERSION' });
  }, []);

  const createArticleQueryForSource = useCallback((
    source: RefreshSourceDescriptor,
    visibleCount: number,
    searchText?: string | null
  ): ArticleQuery => {
    const limit = Math.max(SMART_VIEW_ARTICLE_LIMIT, visibleCount);
    const normalizedSearchText = searchText?.trim();
    const withSearchText = (query: ArticleQuery): ArticleQuery => normalizedSearchText
      ? { ...query, searchText: normalizedSearchText }
      : query;

    if (source.type === 'feed') {
      return withSearchText({
        feedIds: [source.feedId],
        limit,
        sort: DEFAULT_ARTICLE_LIST_SORT,
      });
    }

    if (source.type === 'tag') {
      return withSearchText({
        tagName: source.tagName,
        limit,
        sort: DEFAULT_ARTICLE_LIST_SORT,
      });
    }

    if (source.viewType === 'saved') {
      return withSearchText({
        limit,
        sort: DEFAULT_ARTICLE_LIST_SORT,
      });
    }

    if (source.viewType === 'pinned') {
      return withSearchText({
        tagName: 'pinned',
        limit,
        sort: DEFAULT_ARTICLE_LIST_SORT,
      });
    }

    if (source.viewType === 'unread') {
      return withSearchText({
        filter: { read: false },
        limit,
        sort: DEFAULT_ARTICLE_LIST_SORT,
      });
    }

    return withSearchText({
      limit,
      sort: DEFAULT_ARTICLE_LIST_SORT,
    });
  }, []);

  const queryArticleListSource = useCallback(async (
    source: RefreshSourceDescriptor,
    visibleCount: number,
    searchText?: string | null
  ): Promise<{ articles: Article[]; total: number; query: ArticleQuery | null }> => {
    const normalizedSearchText = searchText?.trim() || undefined;

    if (source.type === 'smart' && source.viewType === 'saved') {
      const { articles: saved, total } = await savedArticlesService.querySavedViewArticles(
        Math.max(SMART_VIEW_ARTICLE_LIMIT, visibleCount),
        undefined,
        normalizedSearchText
      );
      const enriched = await savedArticlesService.enrichSavedViewArticlesMeta(saved);
      return { articles: enriched, total, query: null };
    }

    const query = createArticleQueryForSource(source, visibleCount, normalizedSearchText);
    const { articles, total } = await articleStore.query(query);
    return { articles, total, query };
  }, [createArticleQueryForSource]);

  const createBackgroundScrollRequest = useCallback((
    mode: ArticleListScrollRequest['mode'],
    anchorHash: string | null = null,
    options?: Pick<ArticleListScrollRequest, 'preserveScrollTop' | 'prependedItemCount'>,
  ): ArticleListScrollRequest => {
    backgroundScrollRequestRevisionRef.current += 1;
    return {
      revision: backgroundScrollRequestRevisionRef.current,
      mode,
      anchorHash,
      preserveScrollTop: options?.preserveScrollTop,
      prependedItemCount: options?.prependedItemCount,
    };
  }, []);

  const isSchedulerUpdateRelevantToSource = useCallback(async (
    source: RefreshSourceDescriptor,
    feedUpdates: Map<string, number>
  ): Promise<boolean> => {
    const hasNewArticles = (feedId: string): boolean => (feedUpdates.get(feedId) ?? 0) > 0;
    const hasAnyNewArticles = (): boolean => {
      for (const newArticleCount of feedUpdates.values()) {
        if (newArticleCount > 0) return true;
      }
      return false;
    };

    // Scheduler events should only touch the currently visible source when the
    // updated feed can actually contribute new rows to that source.
    if (source.type === 'feed') {
      return hasNewArticles(source.feedId);
    }

    if (source.type === 'tag') {
      const stationFeedIds = await tagsManager.getFeedsByTag(source.tagName);
      return stationFeedIds.some(hasNewArticles);
    }

    if (source.viewType === 'saved') {
      return false;
    }

    if (source.viewType === 'all') {
      return hasAnyNewArticles();
    }

    if (source.viewType === 'unread') {
      return hasAnyNewArticles();
    }

    const pinnedFeedIds = await tagsManager.getFeedsByTag('pinned');
    return pinnedFeedIds.some(hasNewArticles);
  }, []);

  const isArticleViewTransitioning = useCallback((): boolean => {
    return articleViewOverlayPhaseRef.current === 'opening'
      || articleViewOverlayPhaseRef.current === 'closing';
  }, []);

  const reconcileSwitchVisiblePage = useCallback(async (args: {
    token: number;
    sourceKey: string;
    tagQuery: ArticleQuery;
  }): Promise<void> => {
    const { token, sourceKey, tagQuery } = args;
    if (!isSelectionActive(token)) {
      return;
    }

    if (
      articleListScrollActiveRef.current
      || loadMoreInFlightRef.current
      || articleListSearchActiveRef.current
    ) {
      pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery };
      return;
    }

    pendingSwitchVisibleReconcileRef.current = null;

    const visibleCount = Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT);
    const { articles: fresh, total: freshTotal } = await articleStore.query({ ...tagQuery, limit: visibleCount });
    if (!isSelectionActive(token)) {
      return;
    }

    dispatchArticlesTransitionIfChanged(fresh, freshTotal);
  }, [dispatchArticlesTransitionIfChanged, isSelectionActive]);

  const flushPendingSwitchVisibleReconcileIfIdle = useCallback((): void => {
    const pendingReconcile = pendingSwitchVisibleReconcileRef.current;
    if (!pendingReconcile) {
      return;
    }

    const activeSource = activeSourceRef.current;
    if (!activeSource || pendingReconcile.sourceKey !== activeSource.key) {
      return;
    }

    if (
      articleListScrollActiveRef.current
      || loadMoreInFlightRef.current
      || articleListSearchActiveRef.current
    ) {
      return;
    }

    void reconcileSwitchVisiblePage(pendingReconcile);
  }, [reconcileSwitchVisiblePage]);

  const applyBackgroundRefreshForSource = useCallback(async (source: RefreshSourceDescriptor): Promise<void> => {
    if (source.type === 'smart' && source.viewType === 'saved') {
      return;
    }

    // Search, scroll, and article-view deck transitions freeze visible list
    // publishes so inserted rows do not fight filtered rows, virtualized scroll,
    // or the article-view open/close animation.
    if (
      articleListSearchActiveRef.current
      || articleListScrollActiveRef.current
      || isArticleViewTransitioning()
    ) {
      pendingBackgroundRefreshSourceKeyRef.current = source.key;
      return;
    }

    if (backgroundRefreshInFlightRef.current) {
      pendingBackgroundRefreshSourceKeyRef.current = source.key;
      return;
    }

    backgroundRefreshInFlightRef.current = true;

    try {
      let nextSource: RefreshSourceDescriptor | null = source;

      while (nextSource) {
        if (isArticleViewTransitioning()) {
          pendingBackgroundRefreshSourceKeyRef.current = nextSource.key;
          return;
        }

        pendingBackgroundRefreshSourceKeyRef.current = null;

        const previousArticles = currentArticlesRef.current;
        const previousHashes = new Set(previousArticles.map((article) => article.hash));
        const query = createArticleQueryForSource(nextSource, previousArticles.length);
        const { articles: freshArticles, total } = await articleStore.query(query);
        const activeSource = activeSourceRef.current;

        if (!activeSource || activeSource.key !== nextSource.key) {
          nextSource = null;
          continue;
        }

        if (articleListSearchActiveRef.current || isArticleViewTransitioning()) {
          pendingBackgroundRefreshSourceKeyRef.current = activeSource.key;
          nextSource = null;
          continue;
        }

        if (articleListScrollActiveRef.current) {
          pendingBackgroundRefreshSourceKeyRef.current = activeSource.key;
          nextSource = null;
          continue;
        }

        const newHashes = freshArticles
          .filter((article) => !previousHashes.has(article.hash))
          .map((article) => article.hash);

        const latestActiveSource = activeSourceRef.current;
        if (!latestActiveSource || latestActiveSource.key !== nextSource.key) {
          nextSource = null;
          continue;
        }

        currentArticlesRef.current = freshArticles;

        if (newHashes.length > 0) {
          logListRefreshAttribution({
            sourceKey: nextSource.key,
            rowCount: freshArticles.length,
            totalCount: total,
            newHashCount: newHashes.length,
            estimatedSerializedListKb: estimateSerializedArticleListKb(freshArticles),
            trigger: 'background-refresh',
          });

          // Keep users anchored after passive inserts: jump to the top only
          // when they are already there, otherwise preserve a nearby row.
          const scrollRequest = articleListAtTopRef.current
            ? createBackgroundScrollRequest('top')
            : createBackgroundScrollRequest('anchor', articleListAnchorHashRef.current, {
              preserveScrollTop: articleListScrollTopRef.current,
              prependedItemCount: newHashes.length,
            });

          startTransition(() => {
            collectionDispatch({
              type: 'APPLY_BACKGROUND_REFRESH',
              payload: {
                list: freshArticles,
                total,
                newArticleHashes: new Set(newHashes),
                scrollRequest,
              },
            });
          });
        }

        const pendingSourceKey = pendingBackgroundRefreshSourceKeyRef.current;
        const latestSource = activeSourceRef.current;
        nextSource = pendingSourceKey !== null && latestSource?.key === pendingSourceKey
          ? latestSource
          : null;
      }
    } finally {
      backgroundRefreshInFlightRef.current = false;
    }
  }, [createArticleQueryForSource, createBackgroundScrollRequest, isArticleViewTransitioning, startTransition]);

  const flushStationUiUpdates = useCallback(async (): Promise<void> => {
    if (stationUiBatchTimerRef.current !== null) {
      window.clearTimeout(stationUiBatchTimerRef.current);
      stationUiBatchTimerRef.current = null;
    }

    const pendingSourceKey = pendingStationRefreshSourceKeyRef.current;
    pendingStationRefreshSourceKeyRef.current = null;
    const activeSource = activeSourceRef.current;
    if (!pendingSourceKey || !activeSource || activeSource.key !== pendingSourceKey) {
      return;
    }

    await applyBackgroundRefreshForSource(activeSource);
  }, [applyBackgroundRefreshForSource]);

  const scheduleStationUiRefresh = useCallback((sourceKey: string): void => {
    const activeSource = activeSourceRef.current;
    if (!activeSource || activeSource.key !== sourceKey) {
      return;
    }

    pendingStationRefreshSourceKeyRef.current = sourceKey;
    if (stationUiBatchTimerRef.current !== null) {
      return;
    }

    stationUiBatchTimerRef.current = window.setTimeout(() => {
      stationUiBatchTimerRef.current = null;
      void flushStationUiUpdates();
    }, SCHEDULER_UI_BATCH_DELAY_MS);
  }, [flushStationUiUpdates]);

  const resolveEligibleStationFeedIds = useCallback(async (
    feedIds: string[],
    options: RefreshTriggerOptions,
    token: number,
    maxEligible?: number,
  ): Promise<string[]> => {
    const allFeeds = await getAllFeedMetadataCached();
    const feedById = new Map(allFeeds.map((feed) => [feed.id, feed]));
    const eligibleFeedIds: string[] = [];

    for (const id of feedIds) {
      if (!isSelectionActive(token)) {
        break;
      }

      const feed = feedById.get(id);
      if (!feed) {
        continue;
      }

      const refreshBlock = options.forceNetwork
        ? null
        : getFeedRefreshBlock(feed, FEED_FETCH_COOLDOWN_MS, {
            includeBackoff: !options.bypassBackoff,
          });
      if (refreshBlock) {
        logFeedRefreshSkip(feed, refreshBlock);
        continue;
      }

      eligibleFeedIds.push(id);
      if (maxEligible !== undefined && eligibleFeedIds.length >= maxEligible) {
        break;
      }
    }

    return eligibleFeedIds;
  }, [isSelectionActive]);

  const refreshStationFeeds = useCallback(async (
    feedIds: string[],
    options: RefreshTriggerOptions,
    token: number,
    sourceKey: string,
    intent: SourceRefreshIntent = 'manual',
  ): Promise<number> => {
    if (feedIds.length === 0) {
      return 0;
    }

    // Native station switch: schedule a scoped high-priority background cycle
    // instead of blocking Phase B on a foreground native await. Keeps scroll
    // responsive while activeStationFocus front-loads this station's feeds.
    if (intent === 'switch' && isNativeFeedIngestionEnabled()) {
      if (!isSelectionActive(token)) {
        return 0;
      }

      sidebarSwitchTrace.mark(token, 'station-network-refresh-started', {
        feedCount: feedIds.length,
        scheduledBackground: true,
      });
      feedRefreshActivity.beginQueuedFeeds([], 'foreground', { scopeTotal: feedIds.length });
      interactiveRefreshScopeTokenRef.current = feedRefreshActivity.getInteractiveRefreshScopeGeneration();
      feedRefreshActivity.markInteractiveRefreshDeferredTail(true, feedIds.length);
      feedScheduler.boostMany(feedIds);
      sidebarSwitchTrace.mark(token, 'station-refresh-scheduled', {
        feedCount: feedIds.length,
      });
      sidebarSwitchTrace.markDuration(
        token,
        'station-network-refresh',
        0,
        { insertedTotal: 0, deferredFeedCount: feedIds.length, scheduledBackground: true },
      );
      return 0;
    }

    const eligibleFeedIds = await traceSidebarSwitchAsync(
      token,
      'eligible-feeds-resolved',
      () => (intent === 'switch'
        ? resolveEligibleStationFeedIds(
          feedIds,
          options,
          token,
          STATION_SWITCH_FOREGROUND_REFRESH_CAP,
        )
        : resolveEligibleStationFeedIds(feedIds, options, token)),
      { feedCount: feedIds.length, intent },
    );

    const foregroundFeedIds = eligibleFeedIds;
    const foregroundFeedIdSet = new Set(foregroundFeedIds);
    const deferredFeedIds = intent === 'switch'
      ? feedIds.filter((feedId) => !foregroundFeedIdSet.has(feedId))
      : [];

    if (eligibleFeedIds.length === 0) {
      if (deferredFeedIds.length > 0 && isSelectionActive(token)) {
        feedRefreshActivity.beginQueuedFeeds([], 'foreground', { scopeTotal: feedIds.length });
        interactiveRefreshScopeTokenRef.current = feedRefreshActivity.getInteractiveRefreshScopeGeneration();
        feedRefreshActivity.markInteractiveRefreshDeferredTail(true, deferredFeedIds.length);
        feedScheduler.boostMany(deferredFeedIds);
        sidebarSwitchTrace.mark(token, 'station-refresh-deferred', {
          deferredFeedCount: deferredFeedIds.length,
        });
      }
      return 0;
    }

    if (!isSelectionActive(token)) {
      return 0;
    }

    // Atomic: record the true switch scope (station feed count, NOT the
    // foreground cap) in the same publish as the foreground queue so the first
    // snapshot already carries the scope — no transient `Refreshing 6 feeds`
    // frame. The generation token lets the `finally` clear only this switch's
    // scope, so a stale switch cannot clobber a newer one during rapid hopping.
    const releaseQueuedFeed = feedRefreshActivity.beginQueuedFeeds(
      foregroundFeedIds,
      'foreground',
      { scopeTotal: feedIds.length },
    );
    const interactiveRefreshScopeToken = feedRefreshActivity.getInteractiveRefreshScopeGeneration();
    interactiveRefreshScopeTokenRef.current = interactiveRefreshScopeToken;
    const activeSignal = selectionAbortControllerRef.current?.signal;
    const feedsNeedingCountSync = new Set<string>();
    let nextFeedIndex = 0;
    let insertedTotal = 0;
    sidebarSwitchTrace.mark(token, 'station-network-refresh-started', {
      eligibleFeedCount: eligibleFeedIds.length,
      foregroundFeedCount: foregroundFeedIds.length,
      deferredFeedCount: deferredFeedIds.length,
    });
    const stationNetworkRefreshStartedAt = performance.now();

    const refreshOneFeed = async (id: string): Promise<number> => {
      let queuedFeedReleased = false;
      const releaseQueuedStationFeed = (): void => {
        if (queuedFeedReleased) {
          return;
        }
        queuedFeedReleased = true;
        releaseQueuedFeed(id);
      };

      try {
        const feed = await feedsManager.getFeedById(id);
        if (!feed || !isSelectionActive(token)) {
          releaseQueuedStationFeed();
          return 0;
        }

        try {
          const result = await refreshFeedFromNetwork(
            feed,
            {
              onFetchSettled: releaseQueuedStationFeed,
              waitForUiBudget: () => waitForStationRefreshUiBudget(activeSignal),
              skipNativeActivityQueue: true,
            },
            activeSignal,
          );
          if (result.inserted > 0) {
            feedsNeedingCountSync.add(id);
            if (isSelectionActive(token)) {
              scheduleStationUiRefresh(sourceKey);
            }
          }
          return result.inserted;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return 0;
          }
          await recordFeedRefreshFailure(feed, error);
          return 0;
        } finally {
          releaseQueuedStationFeed();
        }
      } finally {
        await yieldToArticleListPrefetchFrame();
      }
    };

    try {
      if (isNativeFeedIngestionEnabled()) {
        const settledFeedIds = new Set<string>();
        const settleFeed = (feedId: string): void => {
          if (settledFeedIds.has(feedId)) {
            return;
          }
          settledFeedIds.add(feedId);
          releaseQueuedFeed(feedId);
        };

        try {
          await waitForStationRefreshUiBudget(activeSignal);
          const nativeResult = await runNativeFeedRefresh({
            feedIds: foregroundFeedIds,
            forceRefreshFeedIds: (options.forceNetwork || options.bypassBackoff)
              ? new Set(foregroundFeedIds)
              : undefined,
            signal: activeSignal,
            activityKind: 'foreground',
            skipActivityQueue: true,
            onFeedSettled: settleFeed,
          });

          for (const id of foregroundFeedIds) {
            settleFeed(id);
          }

          for (const feedResult of nativeResult.feedResults) {
            if (feedResult.error) {
              const feed = await feedsManager.getFeedById(feedResult.feedId);
              if (feed) {
                await recordFeedRefreshFailure(feed, new Error(feedResult.error));
              }
              continue;
            }

            if ((feedResult.insertedCount ?? 0) > 0) {
              feedsNeedingCountSync.add(feedResult.feedId);
              if (isSelectionActive(token)) {
                scheduleStationUiRefresh(sourceKey);
              }
            }
          }

          insertedTotal = nativeResult.insertedArticles;
        } catch (error) {
          for (const id of foregroundFeedIds) {
            settleFeed(id);
          }
          if (!(error instanceof Error && error.name === 'AbortError')) {
            throw error;
          }
        }
      } else {
        const runWorker = async (): Promise<void> => {
          while (isSelectionActive(token)) {
            const feedId = foregroundFeedIds[nextFeedIndex];
            nextFeedIndex += 1;
            if (!feedId) {
              return;
            }
            insertedTotal += await refreshOneFeed(feedId);
          }
        };

        const workerCount = Math.min(STATION_REFRESH_WORKER_COUNT, foregroundFeedIds.length);
        await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));
      }

      if (
        feedsNeedingCountSync.size > 0
        && isSelectionActive(token)
        && !activeSignal?.aborted
      ) {
        const syncedCounts = await articleStore.syncFeedCountsBatch(Array.from(feedsNeedingCountSync));
        if (syncedCounts.length > 0) {
          feedLibraryMutationBus.publishFeedsCountsUpdated(
            syncedCounts.map((counts) => ({
              feedId: counts.feedId,
              unreadCount: counts.unreadCount,
              articleCount: counts.articleCount,
            })),
          );
        }
      }

      // Only the foreground feeds were actually fetched this turn; suppress just
      // those so the next background cycle avoids re-fetching them. Suppressing
      // the deferred feeds too would block the background from surfacing new
      // articles for feeds the switch path deferred to boostMany.
      if (foregroundFeedIds.length > 0 && isSelectionActive(token) && !activeSignal?.aborted) {
        feedScheduler.suppressFeedsForNextCycle(foregroundFeedIds);
      }

      return insertedTotal;
    } finally {
      releaseQueuedFeed();
      if (deferredFeedIds.length > 0 && isSelectionActive(token)) {
        feedRefreshActivity.markInteractiveRefreshDeferredTail(true, deferredFeedIds.length);
        feedScheduler.boostMany(deferredFeedIds);
        sidebarSwitchTrace.mark(token, 'station-refresh-deferred', {
          deferredFeedCount: deferredFeedIds.length,
        });
      }
      sidebarSwitchTrace.markDuration(
        token,
        'station-network-refresh',
        performance.now() - stationNetworkRefreshStartedAt,
        { insertedTotal, deferredFeedCount: deferredFeedIds.length },
      );
    }
  }, [
    isSelectionActive,
    recordFeedRefreshFailure,
    refreshFeedFromNetwork,
    resolveEligibleStationFeedIds,
    scheduleStationUiRefresh,
    waitForStationRefreshUiBudget,
  ]);

  const selectArticle = useCallback((id: string) => {
    overlayDispatch({ type: 'SET_ACTIVE', payload: id, trigger: true });
  }, []);

  const setActiveArticle = useCallback((id: string | null) => {
    overlayDispatch({ type: 'SET_ACTIVE', payload: id });
  }, []);

  const requestCloseArticle = useCallback(() => {
    overlayDispatch({ type: 'REQUEST_CLOSE' });
  }, []);

  const completeArticleClose = useCallback(() => {
    overlayDispatch({ type: 'COMPLETE_CLOSE' });
  }, []);

  const setArticleViewOverlayPhase = useCallback((phase: ArticleViewOverlayPhase) => {
    overlayDispatch({ type: 'SET_PHASE', payload: phase });
  }, []);

  const closeActiveArticleForSourceSwitch = useCallback(() => {
    const hasActiveArticle = activeArticleHashRef.current !== null;
    const isOverlayActive = articleViewOverlayPhaseRef.current !== 'closed';

    if (isOverlayActive) {
      requestCloseArticle();
    }
    if (hasActiveArticle) {
      setActiveArticle(null);
    }
  }, [requestCloseArticle, setActiveArticle]);

  const applyImmediateSelectionSwitchPaint = useCallback((sourceKey: string) => {
    const restored = restoreSourceArticleSnapshot(sourceKey);
    if (!restored) {
      collectionDispatch({ type: 'RESET_FOR_SOURCE_SWITCH' });
    } else {
      dispatchArticlesTransitionIfChanged(restored.list, restored.total);
      collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
    }
  }, [dispatchArticlesTransitionIfChanged, restoreSourceArticleSnapshot]);

  const commitDeferredSwitchSqlitePage = useCallback(async (args: {
    token: number;
    sourceKey: string;
    query: ArticleQuery;
    taggedFeedCount: number;
    limit?: number;
    interactionExtra?: Record<string, unknown>;
    sideWorkGeneration: number;
  }): Promise<boolean> => {
    const {
      token,
      sourceKey,
      query,
      taggedFeedCount,
      limit,
      interactionExtra,
      sideWorkGeneration,
    } = args;

    return await traceSidebarSwitchAsync(
      token,
      'sqlite-query-deferred',
      async () => {
        if (!isStationSwitchSideWorkCurrent(token, sideWorkGeneration)) {
          return false;
        }

        const queryLimit = Math.min(
          limit ?? SMART_VIEW_ARTICLE_LIMIT,
          STATION_SWITCH_SQLITE_RECONCILE_LIMIT,
        );
        const { articles: stored } = await articleStore.query({
          ...query,
          limit: queryLimit,
          // H12: includeTotal: true runs COUNT(DISTINCT) on large stations and
          // regresses skeleton-load switch freeze — floor total until reconcile.
          includeTotal: false,
        });
        if (!isStationSwitchSideWorkCurrent(token, sideWorkGeneration)) {
          return false;
        }

        // Full page without total: use row count as a floor until reconcile.
        const resolvedTotal = stored.length < queryLimit
          ? stored.length
          : Math.max(stored.length, nonSearchArticlesTotalCountRef.current);

        const dispatchStartedAt = performance.now();
        dispatchArticlesTransitionIfChanged(stored, resolvedTotal);
        collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
        sidebarSwitchTrace.markDuration(
          token,
          'dispatch-articles',
          performance.now() - dispatchStartedAt,
          { articleCount: stored.length, deferred: true },
        );
        interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'cachedReady', {
          cachedArticleCount: stored.length,
          cachedArticleTotal: resolvedTotal,
          taggedFeedCount,
          deferredSqlite: true,
          ...interactionExtra,
        });
        return true;
      },
      { limit: limit ?? SMART_VIEW_ARTICLE_LIMIT, taggedFeedCount, deferred: true },
    );
  }, [
    dispatchArticlesTransitionIfChanged,
    isStationSwitchSideWorkCurrent,
  ]);

  const scheduleDeferredSwitchSqliteRecovery = useCallback((args: {
    token: number;
    sourceKey: string;
    query: ArticleQuery;
    taggedFeedCount: number;
    limit?: number;
    interactionExtra?: Record<string, unknown>;
    sideWorkGeneration: number;
  }) => {
    if (deferredSwitchRecoveryTimerRef.current !== null) {
      window.clearTimeout(deferredSwitchRecoveryTimerRef.current);
    }

    deferredSwitchRecoveryTimerRef.current = window.setTimeout(() => {
      deferredSwitchRecoveryTimerRef.current = null;
      void (async () => {
        const {
          token,
          sourceKey,
          sideWorkGeneration,
        } = args;

        if (!isSelectionActive(token) || !isStationSwitchSideWorkCurrent(token, sideWorkGeneration)) {
          return;
        }

        if (currentArticlesRef.current.length > 0) {
          collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
          return;
        }

        try {
          const dispatched = await commitDeferredSwitchSqlitePage(args);
          if (
            !dispatched
            && isSelectionActive(token)
            && isStationSwitchSideWorkCurrent(token, sideWorkGeneration)
          ) {
            collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
          }
        } catch (error) {
          logger.warn('FeedContext', 'Deferred switch SQLite recovery failed', { error, sourceKey, token });
          if (isSelectionActive(token) && isStationSwitchSideWorkCurrent(token, sideWorkGeneration)) {
            collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
          }
        }
      })();
    }, DEFERRED_SWITCH_SQLITE_RECOVERY_DELAY_MS);
  }, [commitDeferredSwitchSqlitePage, isSelectionActive, isStationSwitchSideWorkCurrent]);

  const scheduleDeferredSwitchSqlitePage = useCallback((args: {
    token: number;
    sourceKey: string;
    query: ArticleQuery;
    taggedFeedCount: number;
    limit?: number;
    interactionExtra?: Record<string, unknown>;
  }) => {
    const { token, sourceKey } = args;
    const sideWorkGeneration = stationSwitchSideWorkGenerationRef.current;
    let paintGateCancelled = false;
    const cancelPaintGateWait = (): void => {
      paintGateCancelled = true;
    };
    cancelStationSwitchIdleWorkRef.current = cancelPaintGateWait;

    void (async () => {
      let dispatched = false;
      const sideWorkArgs = { ...args, sideWorkGeneration };

      try {
        const painted = await waitForArticleListPaintGate(isSelectionActive, token, {
          isCancelled: () => paintGateCancelled,
        });
        if (!painted || !isStationSwitchSideWorkCurrent(token, sideWorkGeneration)) {
          return;
        }

        dispatched = await commitDeferredSwitchSqlitePage(sideWorkArgs);
      } catch (error) {
        logger.warn('FeedContext', 'Deferred switch SQLite page failed', { error, sourceKey, token });
      } finally {
        if (cancelStationSwitchIdleWorkRef.current === cancelPaintGateWait) {
          cancelStationSwitchIdleWorkRef.current = null;
        }

        if (
          !dispatched
          && isSelectionActive(token)
          && isStationSwitchSideWorkCurrent(token, sideWorkGeneration)
          && currentArticlesRef.current.length === 0
        ) {
          scheduleDeferredSwitchSqliteRecovery(sideWorkArgs);
        }
      }
    })();
  }, [
    commitDeferredSwitchSqlitePage,
    isSelectionActive,
    isStationSwitchSideWorkCurrent,
    scheduleDeferredSwitchSqliteRecovery,
  ]);

  const syncArticleListViewport = useCallback((snapshot: ArticleListViewportSnapshot) => {
    const wasSearchActive = articleListSearchActiveRef.current;

    articleListSearchActiveRef.current = snapshot.isSearchActive;
    articleListAtTopRef.current = snapshot.isAtTop;
    articleListAnchorHashRef.current = snapshot.anchorHash;
    if (typeof snapshot.scrollTop === 'number') {
      articleListScrollTopRef.current = snapshot.scrollTop;
    }

    if (snapshot.isScrolling) {
      articleListScrollActiveRef.current = true;
      feedScheduler.setRuntimeUiState({ scrollActive: true });
      if (articleListScrollIdleTimerRef.current !== null) {
        window.clearTimeout(articleListScrollIdleTimerRef.current);
      }
      articleListScrollIdleTimerRef.current = window.setTimeout(() => {
        articleListScrollIdleTimerRef.current = null;
        articleListScrollActiveRef.current = false;
        feedScheduler.setRuntimeUiState({ scrollActive: false });

        const activeSource = activeSourceRef.current;
        if (!activeSource || articleListSearchActiveRef.current) {
          return;
        }

        const pendingReconcile = pendingSwitchVisibleReconcileRef.current;
        if (pendingReconcile && pendingReconcile.sourceKey === activeSource.key) {
          void reconcileSwitchVisiblePage(pendingReconcile);
        }

        if (pendingBackgroundRefreshSourceKeyRef.current === activeSource.key) {
          void applyBackgroundRefreshForSource(activeSource);
        }
      }, BACKGROUND_REFRESH_SCROLL_IDLE_DELAY_MS);
    }

    if (!wasSearchActive || snapshot.isSearchActive) {
      return;
    }

    const activeSource = activeSourceRef.current;
    if (!activeSource || pendingBackgroundRefreshSourceKeyRef.current !== activeSource.key) {
      return;
    }

    if (articleListScrollActiveRef.current) {
      return;
    }

    void applyBackgroundRefreshForSource(activeSource);
  }, [applyBackgroundRefreshForSource, reconcileSwitchVisiblePage]);

  useDependencyEffect(() => {
    const pending = pendingLoadMoreCommitMetricRef.current;
    if (!pending) {
      return;
    }

    if (pending.token !== selectionTokenRef.current || pending.searchText !== articleListSearchQueryRef.current) {
      pendingLoadMoreCommitMetricRef.current = null;
      return;
    }

    if (collectionState.articles.length < pending.minimumVisibleLength) {
      return;
    }

    pendingLoadMoreCommitMetricRef.current = null;
    const renderCommitMs = getPerformanceTimeMs() - pending.appendStartedAtMs;
    const totalDurationMs = getPerformanceTimeMs() - pending.queryStartedAtMs;

    interactionPerformance.reportArticleListLoadMore({
      sourceKey: pending.sourceKey,
      requestedLimit: pending.requestedLimit,
      nextLimit: ARTICLE_LIST_LOAD_MORE_LIMIT,
      receivedCount: pending.receivedCount,
      queryDurationMs: Number(pending.queryDurationMs.toFixed(1)),
      renderCommitMs: Number(renderCommitMs.toFixed(1)),
      totalDurationMs: Number(totalDurationMs.toFixed(1)),
      offset: pending.offset,
      buffered: pending.buffered,
      appendMode: pending.appendMode,
      isSearchActive: pending.searchText !== null,
    });
  }, [collectionState.articles.length]);

  const runFeedNetworkRefreshPhase = useCallback(async (payload: FeedSourceRefreshPayload) => {
    const { feedId, feedQuery, token, refreshOptions, perfMark, sourceKey } = payload;
    if (!isSelectionActive(token)) {
      return;
    }

    let insertedCount = 0;
    const feedNetworkRefreshStartedAt = performance.now();
    try {
      const feedMeta = await feedStore.getById(feedId);
      if (!feedMeta || !isSelectionActive(token)) {
        return;
      }

      sidebarSwitchTrace.mark(token, 'phase-b-started', { kind: 'feed' });
      const refreshBlock = refreshOptions.forceNetwork
        ? null
        : getFeedRefreshBlock(feedMeta, FEED_FETCH_COOLDOWN_MS, { includeBackoff: true });
      if (refreshBlock) {
        logFeedRefreshSkip(feedMeta, refreshBlock);
        return;
      }

      const releaseQueuedFeed = feedRefreshActivity.beginQueuedFeeds([feedId], 'foreground');
      const activeSignal = selectionAbortControllerRef.current?.signal;
      try {
        const result = await refreshFeedFromNetwork(
          feedMeta,
          {
            updateCounts: true,
            skipNativeActivityQueue: true,
            onFetchSettled: () => releaseQueuedFeed(feedId),
          },
          activeSignal,
        );
        insertedCount = result.inserted;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        await recordFeedRefreshFailure(feedMeta, error);
        throw error;
      } finally {
        releaseQueuedFeed();
      }
      if (!isSelectionActive(token)) {
        return;
      }

      const { articles: fresh, total: freshTotal } = await articleStore.query(feedQuery);
      if (!isSelectionActive(token)) {
        return;
      }
      dispatchArticlesTransitionIfChanged(fresh, freshTotal);
      interactionPerformance.markTimedInteractionStage('sidebar-switch', `feed:${feedId}`, 'freshReady', {
        freshArticleCount: fresh.length,
        freshArticleTotal: freshTotal,
      });

      if (perfMark && HAS_PERFORMANCE_API) {
        performance.mark(`${perfMark}:fresh-ready`);
        performance.measure(`${perfMark}:total-selection`, `${perfMark}:start`, `${perfMark}:fresh-ready`);
      }

      sourceSelectionBus.publishRefreshSettled(token, sourceKey, insertedCount);

      void maybeRefreshFavicon(feedId, feedMeta.url, () => {
        notifyFeedLibraryChanged();
      });
    } catch {
      clearError();
    } finally {
      if (isSelectionActive(token)) {
        collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
      }
      completeSelectionSwitchNetworkPriority(token);
      sidebarSwitchTrace.markDuration(
        token,
        'feed-network-refresh',
        performance.now() - feedNetworkRefreshStartedAt,
        { insertedCount },
      );
      sidebarSwitchTrace.completeNetwork(token, { kind: 'feed', insertedCount });
    }
  }, [
    clearError,
    completeSelectionSwitchNetworkPriority,
    dispatchArticlesTransitionIfChanged,
    isSelectionActive,
    notifyFeedLibraryChanged,
    recordFeedRefreshFailure,
    refreshFeedFromNetwork,
  ]);

  const runTagNetworkRefreshPhase = useCallback(async (payload: TagSourceRefreshPayload) => {
    const {
      tagName,
      feedIds,
      tagQuery,
      token,
      sourceKey,
      refreshOptions,
      shouldReset,
      perfMark,
      intent,
    } = payload;
    if (!isSelectionActive(token)) {
      return;
    }

    let insertedCount = 0;
    try {
      sidebarSwitchTrace.mark(token, 'phase-b-started', { kind: 'tag' });
      insertedCount = await refreshStationFeeds(
        feedIds,
        { ...refreshOptions, bypassBackoff: shouldReset || refreshOptions.bypassBackoff },
        token,
        sourceKey,
        intent,
      );
      // Suppress is scoped to the foreground feeds actually refreshed, inside
      // refreshStationFeeds, so deferred feeds stay eligible for the next
      // background cycle to surface new articles.

      if (!isSelectionActive(token)) {
        return;
      }

      let freshArticleCount = currentArticlesRef.current.length;
      let freshArticleTotal = nonSearchArticlesTotalCountRef.current;
      if (isArticleViewTransitioning()) {
        pendingBackgroundRefreshSourceKeyRef.current = sourceKey;
      } else {
        await reconcileSwitchVisiblePage({
          token,
          sourceKey,
          tagQuery,
        });
        freshArticleCount = currentArticlesRef.current.length;
        freshArticleTotal = nonSearchArticlesTotalCountRef.current;
      }

      interactionPerformance.markTimedInteractionStage('sidebar-switch', `tag:${tagName}`, 'freshReady', {
        freshArticleCount,
        freshArticleTotal,
        taggedFeedCount: feedIds.length,
      });

      if (perfMark && HAS_PERFORMANCE_API) {
        performance.mark(`${perfMark}:fresh-ready`);
        performance.measure(`${perfMark}:total-selection`, `${perfMark}:start`, `${perfMark}:fresh-ready`);
      }

      if (!isSelectionActive(token)) {
        return;
      }

      sourceSelectionBus.publishRefreshSettled(token, sourceKey, insertedCount);
      opmlWorkflowService.scheduleMissingFaviconsAfterStationSelection(feedIds);
    } finally {
      if (isSelectionActive(token)) {
        collectionDispatch({
          type: 'SET_LOADING',
          payload: { isLoadingArticles: false },
        });
      }
      feedRefreshActivity.clearInteractiveRefreshScope(interactiveRefreshScopeTokenRef.current);
      completeSelectionSwitchNetworkPriority(token);
      sidebarSwitchTrace.completeNetwork(token, {
        kind: 'tag',
        insertedCount: insertedCount ?? 0,
      });
    }
  }, [
    completeSelectionSwitchNetworkPriority,
    dispatchArticlesTransitionIfChanged,
    isArticleViewTransitioning,
    isSelectionActive,
    reconcileSwitchVisiblePage,
    refreshStationFeeds,
  ]);

  const requestSwitchNetworkRefresh = useCallback((payload: FeedSourceRefreshPayload | TagSourceRefreshPayload) => {
    scheduleSourceRefreshAfterPaint(payload, {
      isSelectionActive,
      onRefreshRequested: (readyPayload) => {
        if (readyPayload.kind === 'feed') {
          void runFeedNetworkRefreshPhase(readyPayload);
          return;
        }

        void runTagNetworkRefreshPhase(readyPayload);
      },
    });
  }, [isSelectionActive, runFeedNetworkRefreshPhase, runTagNetworkRefreshPhase]);

  const handleFeedSelection = useCallback(async (
    feedId: string,
    shouldReset: boolean,
    token: number,
    options: RefreshTriggerOptions = {},
  ) => {
    const perfMark = `select-feed:${feedId}:${token}`;
    const sourceKey = `feed:${feedId}`;
    const feedQuery = createArticleListQuery({ feedIds: [feedId] });
    let restoredSnapshot: SourceArticleListSnapshot | null = null;

    if (HAS_PERFORMANCE_API) {
      performance.mark(`${perfMark}:start`);
    }

    if (shouldReset) {
      const immediatePaintApplied = immediateSwitchPaintTokenRef.current === token;
      restoredSnapshot = restoreSourceArticleSnapshot(sourceKey);
      if (restoredSnapshot) {
        sidebarSwitchTrace.mark(token, 'snapshot-restored', {
          cachedArticleCount: restoredSnapshot.list.length,
          cachedArticleTotal: restoredSnapshot.total,
        });
      } else if (!immediatePaintApplied) {
        collectionDispatch({ type: 'RESET_FOR_SOURCE_SWITCH' });
      }
      setActiveArticle(null);
      sidebarSwitchTrace.mark(token, 'source-reset');
    }

    if (shouldReset && immediateSwitchPaintTokenRef.current !== token) {
      const stillActive = await traceSidebarSwitchAsync(token, 'coalesce-yield', async () => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
        return isSelectionActive(token);
      });
      if (!stillActive) return;
    }

    if (shouldReset) {
      try {
        lastQueryRef.current = feedQuery;

        if (restoredSnapshot) {
          interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'snapshotReady', {
            cachedArticleCount: restoredSnapshot.list.length,
            cachedArticleTotal: restoredSnapshot.total,
            taggedFeedCount: 1,
          });
          interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'cachedReady', {
            cachedArticleCount: restoredSnapshot.list.length,
            cachedArticleTotal: restoredSnapshot.total,
            taggedFeedCount: 1,
            fromSnapshot: true,
          });
          sidebarSwitchTrace.mark(token, 'articles-published', {
            fromSnapshot: true,
            articleCount: restoredSnapshot.list.length,
          });

          if (HAS_PERFORMANCE_API) {
            performance.mark(`${perfMark}:cached-ready`);
            performance.measure(`${perfMark}:to-cached`, `${perfMark}:start`, `${perfMark}:cached-ready`);
          }

          requestSwitchNetworkRefresh({
            kind: 'feed',
            token,
            sourceKey,
            intent: 'switch',
            refreshOptions: options,
            feedId,
            feedQuery,
            perfMark,
          });
          return;
        }

        sidebarSwitchTrace.mark(token, 'articles-published', {
          deferredSqlite: true,
          articleCount: 0,
        });

        requestSwitchNetworkRefresh({
          kind: 'feed',
          token,
          sourceKey,
          intent: 'switch',
          refreshOptions: options,
          feedId,
          feedQuery,
          perfMark,
        });

        scheduleDeferredSwitchSqlitePage({
          token,
          sourceKey,
          query: feedQuery,
          taggedFeedCount: 1,
          interactionExtra: { feedId },
        });
      } catch {
        clearError();
        abortSelectionSwitchPriority(token);
      }
      return;
    }

    void runFeedNetworkRefreshPhase({
      kind: 'feed',
      token,
      sourceKey,
      intent: 'manual',
      refreshOptions: options,
      feedId,
      feedQuery,
      perfMark,
    });
  }, [
    abortSelectionSwitchPriority,
    clearError,
    isSelectionActive,
    requestSwitchNetworkRefresh,
    restoreSourceArticleSnapshot,
    runFeedNetworkRefreshPhase,
    scheduleDeferredSwitchSqlitePage,
    setActiveArticle,
  ]);

  const handleTagSelection = useCallback(async (
    tagName: string,
    shouldReset: boolean,
    token: number,
    options: RefreshTriggerOptions = {},
  ) => {
    const perfMark = `select-tag:${tagName}:${token}`;
    const sourceKey = `tag:${tagName}`;
    let restoredSnapshot: SourceArticleListSnapshot | null = null;

    if (HAS_PERFORMANCE_API) {
      performance.mark(`${perfMark}:start`);
    }

    if (shouldReset) {
      const immediatePaintApplied = immediateSwitchPaintTokenRef.current === token;
      restoredSnapshot = restoreSourceArticleSnapshot(sourceKey);
      if (restoredSnapshot) {
        sidebarSwitchTrace.mark(token, 'snapshot-restored', {
          cachedArticleCount: restoredSnapshot.list.length,
          cachedArticleTotal: restoredSnapshot.total,
        });
      } else if (!immediatePaintApplied) {
        collectionDispatch({ type: 'RESET_FOR_SOURCE_SWITCH' });
      }
      closeActiveArticleForSourceSwitch();
      sidebarSwitchTrace.mark(token, 'article-close-requested');
    }

    if (shouldReset && immediateSwitchPaintTokenRef.current !== token) {
      const stillActive = await traceSidebarSwitchAsync(token, 'coalesce-yield', async () => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
        return isSelectionActive(token);
      });
      if (!stillActive) {
        return;
      }
    }

    try {
      const tagQuery = createTagArticleListQuery(tagName);
      lastQueryRef.current = tagQuery;

      if (shouldReset && !restoredSnapshot) {
        sidebarSwitchTrace.mark(token, 'cold-station-deferred-sqlite', { tagName });
        sidebarSwitchTrace.mark(token, 'articles-published', {
          deferredSqlite: true,
          articleCount: 0,
        });
        scheduleDeferredSwitchSqlitePage({
          token,
          sourceKey,
          query: tagQuery,
          taggedFeedCount: 0,
          limit: SMART_VIEW_ARTICLE_LIMIT,
          interactionExtra: { tagName },
        });
      }

      let feedIds = getCachedFeedIdsForTag(tagName);
      if (feedIds) {
        sidebarSwitchTrace.mark(token, 'feed-ids-cached', {
          tagName,
          feedCount: feedIds.length,
        });
      } else {
        feedIds = await traceSidebarSwitchAsync(
          token,
          'feed-ids-resolved',
          () => tagsManager.getFeedsByTag(tagName),
          { tagName },
        );
      }
      if (!isSelectionActive(token)) return;
      feedScheduler.setActiveStationFocus(sourceKey, feedIds);

      if (shouldReset) {
        if (restoredSnapshot) {
          interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'snapshotReady', {
            cachedArticleCount: restoredSnapshot.list.length,
            cachedArticleTotal: restoredSnapshot.total,
            taggedFeedCount: feedIds.length,
          });
          interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'cachedReady', {
            cachedArticleCount: restoredSnapshot.list.length,
            cachedArticleTotal: restoredSnapshot.total,
            taggedFeedCount: feedIds.length,
            fromSnapshot: true,
          });
          sidebarSwitchTrace.mark(token, 'articles-published', {
            fromSnapshot: true,
            articleCount: restoredSnapshot.list.length,
          });

          if (HAS_PERFORMANCE_API) {
            performance.mark(`${perfMark}:cached-ready`);
            performance.measure(`${perfMark}:to-cached`, `${perfMark}:start`, `${perfMark}:cached-ready`);
          }

          requestSwitchNetworkRefresh({
            kind: 'tag',
            token,
            sourceKey,
            intent: 'switch',
            refreshOptions: options,
            tagName,
            feedIds,
            tagQuery,
            shouldReset,
            perfMark,
          });
          return;
        }

        if (feedIds.length >= LARGE_STATION_FEED_THRESHOLD) {
          sidebarSwitchTrace.mark(token, 'large-station-fast-path', {
            taggedFeedCount: feedIds.length,
          });
          if (getE2eConfig()) {
            void writeE2eEvent('large-station-fast-path', {
              token,
              tagName,
              taggedFeedCount: feedIds.length,
            });
          }
        }

        requestSwitchNetworkRefresh({
          kind: 'tag',
          token,
          sourceKey,
          intent: 'switch',
          refreshOptions: options,
          tagName,
          feedIds,
          tagQuery,
          shouldReset,
          perfMark,
        });
        return;
      }

      void runTagNetworkRefreshPhase({
        kind: 'tag',
        token,
        sourceKey,
        intent: 'manual',
        refreshOptions: options,
        tagName,
        feedIds,
        tagQuery,
        shouldReset,
        perfMark,
      });
    } catch {
      clearError();
      abortSelectionSwitchPriority(token);
    }
  }, [
    abortSelectionSwitchPriority,
    clearError,
    closeActiveArticleForSourceSwitch,
    dispatchArticlesTransitionIfChanged,
    isSelectionActive,
    requestSwitchNetworkRefresh,
    restoreSourceArticleSnapshot,
    runTagNetworkRefreshPhase,
    scheduleDeferredSwitchSqlitePage,
  ]);

  const handleSmartViewSelection = useCallback(async (type: SmartViewType, shouldReset: boolean, token: number) => {
    if (shouldReset) {
      collectionDispatch({ type: 'RESET_ARTICLES' });
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: false, isSavedListLoading: false, },
      });
      setActiveArticle(null);
      lastQueryRef.current = null;
    }

    if (shouldReset && !await yieldToSelectionCoalescing(token)) return;

    if (type === 'saved') {
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: false, isSavedListLoading: true, },
      });

      try {
        const { articles: saved, total } = await savedArticlesService.querySavedViewArticles(SMART_VIEW_ARTICLE_LIMIT);
        if (!isSelectionActive(token)) return;

        dispatchArticlesTransitionIfChanged(saved, total);
        interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'cachedReady', {
          cachedArticleCount: saved.length,
          cachedArticleTotal: total,
        });

        const enriched = await savedArticlesService.enrichSavedViewArticlesMeta(saved);
        if (isSelectionActive(token)) {
          dispatchArticlesTransitionIfChanged(enriched, total);
          interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'enrichedReady', {
            enrichedArticleCount: enriched.length,
            enrichedArticleTotal: total,
          });
        }
      } finally {
        if (isSelectionActive(token)) {
          collectionDispatch({ type: 'SET_LOADING', payload: { isSavedListLoading: false, } });
        }
      }
      return;
    }

    collectionDispatch({
      type: 'SET_LOADING',
      payload: { isLoadingArticles: true, isSavedListLoading: false, },
    });

    try {
      const query = type === 'unread'
        ? createArticleListQuery({ filter: { read: false } })
        : type === 'pinned'
          ? createArticleListQuery({ tagName: 'pinned' })
          : createArticleListQuery({});

      const { articles: list, total } = await articleStore.query(query);
      if (!isSelectionActive(token)) return;
      lastQueryRef.current = query;
      dispatchArticlesTransitionIfChanged(list, total);
      interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'cachedReady', {
        cachedArticleCount: list.length,
        cachedArticleTotal: total,
      });
    } finally {
      if (isSelectionActive(token)) {
        collectionDispatch({
          type: 'SET_LOADING',
          payload: { isLoadingArticles: false, isSavedListLoading: false, },
        });
      }
    }
  }, [dispatchArticlesTransitionIfChanged, isSelectionActive, setActiveArticle, startTransition, yieldToSelectionCoalescing]);

  if (!hasBootstrappedTotalFeedsRef.current) {
    hasBootstrappedTotalFeedsRef.current = true;
    void refreshTotalFeeds();
  }

  const selectFeed = useCallback(async (
    feedId: string,
    _url: string,
    title: string,
    options: RefreshTriggerOptions = {},
  ) => {
    feedScheduler.clearActiveStationFocus();
    const isSameFeed = feedId === prevNavRef.current.id && feedId !== null;
    if (!isSameFeed) {
      clearArticleListScrollIdleState();
    }
    prevNavRef.current = { id: feedId, tag: null, smart: null };

    navigationDispatch({ type: 'NAVIGATE_FEED', payload: { id: feedId, title } });
    void storage.set(LAST_SIDEBAR_SELECTION_KEY, JSON.stringify({ type: 'feed', feedId } as SidebarSelectionSnapshot));
    if (!isSameFeed) {
      // Treat sidebar switches as one active interaction so rapid source changes
      // replace stale samples instead of filling logs with abandoned attempts.
      interactionPerformance.beginTimedInteraction('sidebar-switch', `feed:${feedId}`, {
        sourceType: 'feed',
        sourceKey: `feed:${feedId}`,
        sourceId: feedId,
        sourceLabel: title,
      }, { exclusiveByKind: true });
    }

    const token = beginSelectionRequest();
    if (!isSameFeed) {
      applyImmediateSelectionSwitchPaint(`feed:${feedId}`);
      immediateSwitchPaintTokenRef.current = token;
    }
    sidebarSwitchTrace.begin(token, `feed:${feedId}`, 'feed', {
      sourceId: feedId,
      sourceLabel: title,
      isSameSource: isSameFeed,
    });
    void handleFeedSelection(feedId, !isSameFeed, token, options);
  }, [applyImmediateSelectionSwitchPaint, beginSelectionRequest, clearArticleListScrollIdleState, handleFeedSelection]);

  const selectTag = useCallback(async (
    tagName: string,
    options: RefreshTriggerOptions = {},
    feedIdsHint?: string[],
  ) => {
    if (feedIdsHint !== undefined) {
      seedTagFeedIdsCache([[tagName, feedIdsHint]]);
    }
    const isSameTag = tagName === prevNavRef.current.tag && tagName !== null;
    if (!isSameTag) {
      feedScheduler.clearActiveStationFocus();
      clearArticleListScrollIdleState();
    }
    prevNavRef.current = { id: null, tag: tagName, smart: null };

    navigationDispatch({ type: 'NAVIGATE_TAG', payload: tagName });
    void storage.set(LAST_SIDEBAR_SELECTION_KEY, JSON.stringify({ type: 'tag', tagName } as SidebarSelectionSnapshot));
    if (!isSameTag) {
      interactionPerformance.beginTimedInteraction('sidebar-switch', `tag:${tagName}`, {
        sourceType: 'tag',
        sourceKey: `tag:${tagName}`,
        sourceId: tagName,
        sourceLabel: tagName,
      }, { exclusiveByKind: true });
    }

    const token = beginSelectionRequest();
    if (!isSameTag) {
      applyImmediateSelectionSwitchPaint(`tag:${tagName}`);
      immediateSwitchPaintTokenRef.current = token;
    }
    sidebarSwitchTrace.begin(token, `tag:${tagName}`, 'tag', {
      sourceId: tagName,
      sourceLabel: tagName,
      isSameSource: isSameTag,
    });
    void handleTagSelection(tagName, !isSameTag, token, options);
  }, [applyImmediateSelectionSwitchPaint, beginSelectionRequest, clearArticleListScrollIdleState, handleTagSelection]);

  const selectSmartView = useCallback(async (viewType: SmartViewType) => {
    feedScheduler.clearActiveStationFocus();
    const isSameSmart = viewType === prevNavRef.current.smart && viewType !== null;
    if (!isSameSmart) {
      clearArticleListScrollIdleState();
    }
    prevNavRef.current = { id: null, tag: null, smart: viewType };

    navigationDispatch({ type: 'NAVIGATE_SMART', payload: viewType });
    void storage.set(LAST_SIDEBAR_SELECTION_KEY, JSON.stringify({ type: 'smart', viewType } as SidebarSelectionSnapshot));
    if (!isSameSmart) {
      interactionPerformance.beginTimedInteraction('sidebar-switch', `smart:${viewType}`, {
        sourceType: 'smart',
        sourceKey: `smart:${viewType}`,
        sourceId: viewType,
        sourceLabel: viewType === 'saved' ? 'Saved' : viewType === 'pinned' ? 'Pinned' : viewType === 'unread' ? 'Unread' : 'All Items',
      }, { exclusiveByKind: true });
    }

    const token = beginSelectionRequest();
    void handleSmartViewSelection(viewType, !isSameSmart, token);
  }, [beginSelectionRequest, clearArticleListScrollIdleState, handleSmartViewSelection]);

  const clearFeedSelection = useCallback(() => {
    feedScheduler.clearActiveStationFocus();
    abortSelectionSwitchPriority();
    clearArticleListScrollIdleState();
    selectionAbortControllerRef.current?.abort();
    selectionAbortControllerRef.current = null;
    prevNavRef.current = { id: null, tag: null, smart: null };
    selectionTokenRef.current += 1;
    navigationDispatch({ type: 'CLEAR_SELECTION' });
    collectionDispatch({ type: 'RESET_ARTICLES' });
    collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false, isSavedListLoading: false, } });
  }, [abortSelectionSwitchPriority, clearArticleListScrollIdleState]);

  useMountEffect(() => {
    void ensureTagFeedIdsCache();
  });

  useMountEffect(() => {
    return sourceSelectionBus.subscribe((event) => {
      if (event.type === 'source-refresh-aborted') {
        abortSelectionSwitchPriority(event.payload.token);
      }
    });
  });

  useMountEffect(() => {
    if (hasAttemptedSidebarRestoreRef.current) return;
    hasAttemptedSidebarRestoreRef.current = true;

    void (async () => {
      try {
        const raw = await storage.get(LAST_SIDEBAR_SELECTION_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw) as SidebarSelectionSnapshot;

        if (parsed.type === 'smart') {
          await selectSmartView(parsed.viewType);
          return;
        }

        if (parsed.type === 'feed') {
          const feed = await feedsManager.getFeedById(parsed.feedId);
          if (!feed) {
            await storage.remove(LAST_SIDEBAR_SELECTION_KEY);
            return;
          }
          await selectFeed(feed.id, feed.url, feed.title);
          return;
        }

        if (parsed.type === 'tag') {
          const tags = await tagsManager.getAllTags();
          const exists = tags.some((tag) => tag.name === parsed.tagName);
          if (!exists) {
            await storage.remove(LAST_SIDEBAR_SELECTION_KEY);
            return;
          }
          await selectTag(parsed.tagName);
        }
      } catch (error) {
        logger.warn('FeedContext', 'Failed to restore last sidebar selection', { error });
      }
    })();
  });

  const openFeedEditView = useCallback((target?: FeedEditTarget) => {
    feedScheduler.clearActiveStationFocus();
    clearArticleListScrollIdleState();
    selectionAbortControllerRef.current?.abort();
    selectionAbortControllerRef.current = null;
    prevNavRef.current = { id: null, tag: null, smart: null };
    selectionTokenRef.current += 1;
    navigationDispatch({ type: 'OPEN_EDIT_VIEW', payload: target ?? null });
    collectionDispatch({ type: 'RESET_ARTICLES' });
    collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false, isSavedListLoading: false, } });
  }, [clearArticleListScrollIdleState]);

  const closeFeedEditView = useCallback(() => {
    navigationDispatch({ type: 'CLOSE_EDIT_VIEW' });
  }, []);

  const clearFeedEditTarget = useCallback(() => {
    navigationDispatch({ type: 'CLEAR_EDIT_TARGET' });
  }, []);

  const refreshFeed = useCallback(async () => {
    const source = getRefreshSourceDescriptor(navigationState);
    if (!source) {
      return;
    }

    if (refreshInFlightRef.current) {
      // Re-clicks for the active source should collapse into the in-flight
      // refresh, while real source changes still request one follow-up pass.
      if (source.key !== activeRefreshSourceKeyRef.current) {
        pendingRefreshSourceKeyRef.current = source.key;
      }
      return;
    }

    refreshInFlightRef.current = true;

    try {
      let nextSource: RefreshSourceDescriptor | null = source;

      while (nextSource) {
        pendingRefreshSourceKeyRef.current = null;
        activeRefreshSourceKeyRef.current = nextSource.key;

        // Refreshes need a fresh cancellation scope just like navigation so a
        // newer refresh can invalidate stale local and network work.
        const token = beginSelectionRequest();
        const forceNetwork = true;
        if (nextSource.type === 'feed') {
          await handleFeedSelection(nextSource.feedId, false, token, { forceNetwork });
        } else if (nextSource.type === 'tag') {
          await handleTagSelection(nextSource.tagName, false, token, { forceNetwork });
        } else {
          await handleSmartViewSelection(nextSource.viewType, false, token);
        }

        const pendingRefreshSourceKey = pendingRefreshSourceKeyRef.current;
        const currentSource = getRefreshSourceDescriptor(navigationState);
        nextSource = pendingRefreshSourceKey !== null && currentSource?.key === pendingRefreshSourceKey
          ? currentSource
          : null;
      }
    } finally {
      activeRefreshSourceKeyRef.current = null;
      refreshInFlightRef.current = false;
    }
  }, [beginSelectionRequest, handleFeedSelection, handleSmartViewSelection, handleTagSelection, navigationState]);

  const reloadCurrentSourceFromStore = useCallback(async () => {
    const source = getRefreshSourceDescriptor(navigationState);
    if (!source) {
      collectionDispatch({ type: 'RESET_ARTICLES' });
      collectionDispatch({
        type: 'SET_LOADING',
        payload: {
          isLoadingArticles: false,
          isSavedListLoading: false,
          isLoadingMoreArticles: false,
          isLoadMoreInFlight: false,
        },
      });
      return;
    }

    const visibleCount = Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT);
    const { articles: list, total, query } = await queryArticleListSource(source, visibleCount);

    currentArticlesRef.current = list;
    nonSearchArticlesRef.current = list;
    nonSearchArticlesTotalCountRef.current = total;
    lastQueryRef.current = query;
    collectionDispatch({ type: 'SET_ARTICLES', payload: { list, total } });
    collectionDispatch({
      type: 'SET_LOADING',
      payload: {
        isLoadingArticles: false,
        isSavedListLoading: false,
        isLoadingMoreArticles: false,
        isLoadMoreInFlight: false,
      },
    });
  }, [navigationState, queryArticleListSource]);

  const searchCurrentSource = useCallback(async (rawQuery: string) => {
    const searchText = rawQuery.trim();
    if (!searchText) {
      articleListSearchQueryRef.current = null;
      articleListSearchRevisionRef.current += 1;
      return;
    }

    const source = getRefreshSourceDescriptor(navigationState);
    if (!source) {
      return;
    }

    const requestRevision = articleListSearchRevisionRef.current + 1;
    articleListSearchRevisionRef.current = requestRevision;
    articleListSearchQueryRef.current = searchText;
    const token = selectionTokenRef.current;

    const result = await queryArticleListSource(source, SMART_VIEW_ARTICLE_LIMIT, searchText);
    const activeSource = activeSourceRef.current;
    if (
      token !== selectionTokenRef.current
      || articleListSearchRevisionRef.current !== requestRevision
      || articleListSearchQueryRef.current !== searchText
      || activeSource?.key !== source.key
    ) {
      return;
    }

    dispatchArticlesTransitionIfChanged(result.articles, result.total);
  }, [dispatchArticlesTransitionIfChanged, navigationState, queryArticleListSource]);

  const clearArticleListSearch = useCallback(async () => {
    if (articleListSearchQueryRef.current === null) {
      return;
    }

    const source = getRefreshSourceDescriptor(navigationState);
    articleListSearchQueryRef.current = null;
    const requestRevision = articleListSearchRevisionRef.current + 1;
    articleListSearchRevisionRef.current = requestRevision;

    if (!source) {
      return;
    }

    const token = selectionTokenRef.current;
    const visibleCount = Math.max(nonSearchArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT);
    const cachedList = nonSearchArticlesRef.current;
    const cachedTotal = nonSearchArticlesTotalCountRef.current;

    currentArticlesRef.current = cachedList;
    collectionDispatch({ type: 'SET_ARTICLES', payload: { list: cachedList, total: cachedTotal } });

    const { articles: list, total, query } = await queryArticleListSource(source, visibleCount);
    const activeSource = activeSourceRef.current;
    if (
      token !== selectionTokenRef.current
      || articleListSearchRevisionRef.current !== requestRevision
      || articleListSearchQueryRef.current !== null
      || activeSource?.key !== source.key
    ) {
      return;
    }

    lastQueryRef.current = query;
    dispatchArticlesTransitionIfChanged(list, total);
  }, [dispatchArticlesTransitionIfChanged, navigationState, queryArticleListSource]);

  const loadMoreArticles = useCallback(async (options: LoadMoreArticlesOptions = {}) => {
    const showLoadingIndicator = options.showLoadingIndicator ?? true;
    const priority = options.priority ?? (showLoadingIndicator ? 'urgent' : 'prefetch');
    const isUrgentLoadMore = priority === 'urgent';
    if (collectionState.isLoadingMoreArticles || loadMoreInFlightRef.current) return;
    if (collectionState.articles.length >= collectionState.articlesTotalCount) return;

    loadMoreInFlightRef.current = true;
    const token = selectionTokenRef.current;
    const activeSearchText = articleListSearchQueryRef.current;
    const offset = collectionState.articles.length;
    const requestedLimit = ARTICLE_LIST_LOAD_MORE_LIMIT;
    const sourceKey = activeSourceRef.current?.key ?? null;
    collectionDispatch({
      type: 'SET_LOADING',
      payload: {
        isLoadMoreInFlight: true,
        ...(showLoadingIndicator ? { isLoadingMoreArticles: true } : {}),
      },
    });
    try {
      if (!isUrgentLoadMore && !showLoadingIndicator) {
        await yieldToArticleListPrefetchFrame();
        if (token !== selectionTokenRef.current || activeSearchText !== articleListSearchQueryRef.current) {
          return;
        }
      }

      let more: { articles: Article[] };
      const cursor = getArticlePaginationCursor(collectionState.articles[collectionState.articles.length - 1]);
      const queryStartedAtMs = getPerformanceTimeMs();
      if (activeSearchText) {
        const source = activeSourceRef.current;
        if (!source) {
          return;
        }

        if (source.type === 'smart' && source.viewType === 'saved') {
          more = await savedArticlesService.querySavedViewArticles(requestedLimit, offset, activeSearchText);
        } else {
          const searchQuery = createArticleQueryForSource(source, SMART_VIEW_ARTICLE_LIMIT, activeSearchText);
          more = await articleStore.query({ ...searchQuery, limit: requestedLimit, cursor, includeTotal: false });
        }
      } else if (navigationState.selectedSmartView === 'saved') {
        more = await savedArticlesService.querySavedViewArticles(requestedLimit, offset);
      } else if (lastQueryRef.current) {
        more = await articleStore.query({ ...lastQueryRef.current, limit: requestedLimit, cursor, includeTotal: false });
      } else {
        return;
      }
      const queryDurationMs = getPerformanceTimeMs() - queryStartedAtMs;

      if (token !== selectionTokenRef.current || activeSearchText !== articleListSearchQueryRef.current) {
        return;
      }
      const metric: LoadMoreQueryMetric = {
        token,
        sourceKey,
        searchText: activeSearchText,
        offset,
        requestedLimit,
        receivedCount: more.articles.length,
        queryStartedAtMs,
        queryDurationMs,
        buffered: false,
      };
      if (isUrgentLoadMore || showLoadingIndicator) {
        queueLoadMoreCommitMetric(metric, 'urgent');
        collectionDispatch({ type: 'APPEND_ARTICLES', payload: more.articles });
      } else {
        queueLoadMoreCommitMetric(metric, 'transition');
        startTransition(() => {
          collectionDispatch({ type: 'APPEND_ARTICLES', payload: more.articles });
        });
      }
    } finally {
      // Always release the lock. Only mutate visible loading flags if this
      // request still belongs to the active navigation token.
      loadMoreInFlightRef.current = false;
      collectionDispatch({
        type: 'SET_LOADING',
        payload: {
          isLoadMoreInFlight: false,
          ...(showLoadingIndicator && token === selectionTokenRef.current
            ? { isLoadingMoreArticles: false }
            : {}),
        },
      });
      flushPendingSwitchVisibleReconcileIfIdle();
    }
  }, [
    collectionState.articles.length,
    collectionState.articlesTotalCount,
    collectionState.isLoadingMoreArticles,
    createArticleQueryForSource,
    flushPendingSwitchVisibleReconcileIfIdle,
    queueLoadMoreCommitMetric,
    navigationState.selectedSmartView
  ]);

  const updateArticleInList = useCallback((hash: string, updates: ArticleListUpdatePayload = { read: true }) => {
    const removeFromUnread = navigationState.selectedSmartView === 'unread' && updates.read === true;
    const removeFromSaved = navigationState.selectedSmartView === 'saved' && updates.saved === false;
    collectionDispatch({ type: 'UPDATE_ARTICLE', payload: { hash, updates, removeFromUnread, removeFromSaved } });
  }, [navigationState.selectedSmartView]);

  const flushSchedulerUiUpdates = useCallback(async (forceLibraryRefresh = false): Promise<void> => {
    if (schedulerUiBatchTimerRef.current !== null) {
      window.clearTimeout(schedulerUiBatchTimerRef.current);
      schedulerUiBatchTimerRef.current = null;
    }

    if (schedulerUiFlushInFlightRef.current) {
      schedulerUiFlushQueuedRef.current = true;
      return;
    }

    schedulerUiFlushInFlightRef.current = true;

    try {
      let shouldContinue = true;
      let shouldNotifyLibrary = forceLibraryRefresh;

      while (shouldContinue) {
        if (!isFeedProviderMountedRef.current) {
          pendingSchedulerFeedUpdatesRef.current.clear();
          return;
        }

        schedulerUiFlushQueuedRef.current = false;
        const feedUpdates = new Map(pendingSchedulerFeedUpdatesRef.current);
        pendingSchedulerFeedUpdatesRef.current.clear();

        if (shouldNotifyLibrary) {
          notifyFeedLibraryChanged();
          shouldNotifyLibrary = false;
        }

        const activeSource = activeSourceRef.current;
        if (activeSource && feedUpdates.size > 0) {
          const isRelevant = await isSchedulerUpdateRelevantToSource(activeSource, feedUpdates);
          if (isRelevant) {
            await applyBackgroundRefreshForSource(activeSource);
          }
        }

        shouldContinue = schedulerUiFlushQueuedRef.current || pendingSchedulerFeedUpdatesRef.current.size > 0;
      }
    } finally {
      schedulerUiFlushInFlightRef.current = false;
    }
  }, [applyBackgroundRefreshForSource, isSchedulerUpdateRelevantToSource, notifyFeedLibraryChanged]);

  const scheduleSchedulerUiFlush = useCallback(() => {
    if (schedulerUiBatchTimerRef.current !== null) {
      return;
    }

    schedulerUiBatchTimerRef.current = window.setTimeout(() => {
      schedulerUiBatchTimerRef.current = null;
      void flushSchedulerUiUpdates();
    }, SCHEDULER_UI_BATCH_DELAY_MS);
  }, [flushSchedulerUiUpdates]);

  const activeSourceSnapshot = getRefreshSourceDescriptor(navigationState);
  currentArticlesRef.current = collectionState.articles;
  if (articleListSearchQueryRef.current === null) {
    nonSearchArticlesRef.current = collectionState.articles;
    nonSearchArticlesTotalCountRef.current = collectionState.articlesTotalCount;
    if (activeSourceSnapshot && lastQueryRef.current !== null) {
      rememberSourceArticleSnapshot(
        activeSourceSnapshot.key,
        collectionState.articles,
        collectionState.articlesTotalCount,
        lastQueryRef.current
      );
    }
  }
  activeSourceRef.current = activeSourceSnapshot;
  articleViewOverlayPhaseRef.current = overlayState.articleViewOverlayPhase;
  activeArticleHashRef.current = overlayState.activeArticleHash;

  useDependencyEffect(() => {
    feedScheduler.setRuntimeUiState({
      articleViewOpen: overlayState.articleViewOverlayPhase !== 'closed',
    });
  }, [overlayState.articleViewOverlayPhase]);

  useDependencyEffect(() => {
    articleViewOverlayPhaseRef.current = overlayState.articleViewOverlayPhase;
    if (overlayState.articleViewOverlayPhase === 'opening' || overlayState.articleViewOverlayPhase === 'closing') {
      return;
    }

    const activeSource = activeSourceRef.current;
    if (
      !activeSource
      || pendingBackgroundRefreshSourceKeyRef.current !== activeSource.key
      || articleListSearchActiveRef.current
      || articleListScrollActiveRef.current
    ) {
      return;
    }

    void applyBackgroundRefreshForSource(activeSource);
  }, [applyBackgroundRefreshForSource, overlayState.articleViewOverlayPhase]);

  useMountEffect(() => {
    isFeedProviderMountedRef.current = true;
    const stopMemoryDiagnostics = startRendererSessionMemoryDiagnostics(() => ({
      loadedArticleCount: currentArticlesRef.current.length,
      articlesTotalCount: nonSearchArticlesTotalCountRef.current,
      estimatedSerializedListKb: estimateSerializedArticleListKb(currentArticlesRef.current),
      internFeedCount: getInternedFeedMetadataCount(),
      articleViewOpen: articleViewOverlayPhaseRef.current !== 'closed',
      articleListScrollActive: articleListScrollActiveRef.current,
      searchActive: articleListSearchActiveRef.current,
    }));

    const unsubscribe = feedScheduler.on((event) => {
      if (event.type === 'cycle-complete') {
        void flushSchedulerUiUpdates(true);
        return;
      }

      if (event.type !== 'feed-updated' || !event.feedId) {
        return;
      }

      const pendingUpdates = pendingSchedulerFeedUpdatesRef.current;
      const previousNewArticleCount = pendingUpdates.get(event.feedId) ?? 0;
      pendingUpdates.set(event.feedId, Math.max(previousNewArticleCount, event.newArticleCount ?? 0));
      scheduleSchedulerUiFlush();
    });

    return () => {
      stopMemoryDiagnostics();
      unsubscribe();
      if (schedulerUiBatchTimerRef.current !== null) {
        window.clearTimeout(schedulerUiBatchTimerRef.current);
        schedulerUiBatchTimerRef.current = null;
      }
      if (articleListScrollIdleTimerRef.current !== null) {
        window.clearTimeout(articleListScrollIdleTimerRef.current);
        articleListScrollIdleTimerRef.current = null;
      }
      if (stationUiBatchTimerRef.current !== null) {
        window.clearTimeout(stationUiBatchTimerRef.current);
        stationUiBatchTimerRef.current = null;
      }
      if (deferredSwitchRecoveryTimerRef.current !== null) {
        window.clearTimeout(deferredSwitchRecoveryTimerRef.current);
        deferredSwitchRecoveryTimerRef.current = null;
      }
      pendingSchedulerFeedUpdatesRef.current.clear();
      pendingBackgroundRefreshSourceKeyRef.current = null;
      pendingStationRefreshSourceKeyRef.current = null;
      schedulerUiFlushQueuedRef.current = false;
      schedulerUiFlushInFlightRef.current = false;
      feedScheduler.clearActiveStationFocus();
      isFeedProviderMountedRef.current = false;
    };
  });

  const navigationValue = useMemo(() => ({
    ...navigationState,
    selectFeed,
    selectTag,
    selectSmartView,
    clearFeedSelection,
    openFeedEditView,
    closeFeedEditView,
    clearFeedEditTarget,
  }), [navigationState, selectFeed, selectTag, selectSmartView, clearFeedSelection, openFeedEditView, closeFeedEditView, clearFeedEditTarget]);

  const collectionArticlesValue = useMemo((): CollectionArticlesState => ({
    articles: collectionState.articles,
    articlesTotalCount: collectionState.articlesTotalCount,
    newArticleCount: collectionState.newArticleCount,
    newArticleHashes: collectionState.newArticleHashes,
    articleListScrollRequest: collectionState.articleListScrollRequest,
  }), [
    collectionState.articles,
    collectionState.articlesTotalCount,
    collectionState.newArticleCount,
    collectionState.newArticleHashes,
    collectionState.articleListScrollRequest,
  ]);

  const collectionLoadingValue = useMemo((): CollectionLoadingState => ({
    isLoadingArticles: collectionState.isLoadingArticles,
    isLoadingMoreArticles: collectionState.isLoadingMoreArticles,
    isLoadMoreInFlight: collectionState.isLoadMoreInFlight,
    isSavedListLoading: collectionState.isSavedListLoading,
  }), [
    collectionState.isLoadingArticles,
    collectionState.isLoadingMoreArticles,
    collectionState.isLoadMoreInFlight,
    collectionState.isSavedListLoading,
  ]);

  const collectionActionsValue = useMemo((): CollectionActions => ({
    refreshFeed,
    reloadCurrentSourceFromStore,
    loadMoreArticles,
    updateArticleInList,
    syncArticleListViewport,
    searchCurrentSource,
    clearArticleListSearch,
  }), [
    refreshFeed,
    reloadCurrentSourceFromStore,
    loadMoreArticles,
    updateArticleInList,
    syncArticleListViewport,
    searchCurrentSource,
    clearArticleListSearch,
  ]);

  const overlayValue = useMemo(() => ({
    ...overlayState,
    selectArticle,
    setActiveArticle,
    requestCloseArticle,
    completeArticleClose,
    setArticleViewOverlayPhase,
  }), [overlayState, selectArticle, setActiveArticle, requestCloseArticle, completeArticleClose, setArticleViewOverlayPhase]);

  const uiValue = useMemo(() => ({
    ...uiState,
    clearError,
    refreshTotalFeeds,
    notifyFeedLibraryChanged,
  }), [uiState, clearError, refreshTotalFeeds, notifyFeedLibraryChanged]);

  const uiActionsValue = useMemo(() => ({
    clearError,
    refreshTotalFeeds,
    notifyFeedLibraryChanged,
  }), [clearError, refreshTotalFeeds, notifyFeedLibraryChanged]);

  return (
    <UIActionsContext.Provider value={uiActionsValue}>
      <FeedFaviconRefreshedContext.Provider value={uiState.feedFaviconRefreshed}>
        <UIContext.Provider value={uiValue}>
          <OverlayContext.Provider value={overlayValue}>
            <NavigationContext.Provider value={navigationValue}>
              <CollectionActionsContext.Provider value={collectionActionsValue}>
                <CollectionArticlesContext.Provider value={collectionArticlesValue}>
                  <CollectionLoadingContext.Provider value={collectionLoadingValue}>
                    {children}
                  </CollectionLoadingContext.Provider>
                </CollectionArticlesContext.Provider>
              </CollectionActionsContext.Provider>
            </NavigationContext.Provider>
          </OverlayContext.Provider>
        </UIContext.Provider>
      </FeedFaviconRefreshedContext.Provider>
    </UIActionsContext.Provider>
  );
};

// ─── Specialized Hooks ───

export const useFeedNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useFeedNavigation must be used within NavigationProvider');
  return context;
};

export const useFeedCollectionArticles = (): CollectionArticlesState => {
  const context = useContext(CollectionArticlesContext);
  if (!context) {
    const error = new Error('useFeedCollectionArticles must be used within CollectionArticlesProvider');
    logger.error('FeedContext', 'Collection articles context was missing during render', {
      search: typeof window !== 'undefined' ? window.location.search : null,
      stack: error.stack,
    });
    throw error;
  }
  return context;
};

export const useFeedCollectionLoading = (): CollectionLoadingState => {
  const context = useContext(CollectionLoadingContext);
  if (!context) {
    const error = new Error('useFeedCollectionLoading must be used within CollectionLoadingProvider');
    logger.error('FeedContext', 'Collection loading context was missing during render', {
      search: typeof window !== 'undefined' ? window.location.search : null,
      stack: error.stack,
    });
    throw error;
  }
  return context;
};

export const useFeedCollectionActions = (): CollectionActions => {
  const context = useContext(CollectionActionsContext);
  if (!context) {
    const error = new Error('useFeedCollectionActions must be used within CollectionActionsProvider');
    logger.error('FeedContext', 'Collection actions context was missing during render', {
      search: typeof window !== 'undefined' ? window.location.search : null,
      stack: error.stack,
    });
    throw error;
  }
  return context;
};

export const useFeedCollection = (): CollectionArticlesState & CollectionLoadingState & CollectionActions => {
  const articles = useFeedCollectionArticles();
  const loading = useFeedCollectionLoading();
  const actions = useFeedCollectionActions();

  return useMemo(() => ({
    ...articles,
    ...loading,
    ...actions,
  }), [actions, articles, loading]);
};

export const useFeedOverlay = () => {
  const context = useContext(OverlayContext);
  if (!context) throw new Error('useFeedOverlay must be used within OverlayProvider');
  return context;
};

export const useFeedUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error('useFeedUI must be used within UIProvider');
  return context;
};

export const useFeedUIActions = () => {
  const context = useContext(UIActionsContext);
  if (!context) throw new Error('useFeedUIActions must be used within UIProvider');
  return context;
};

export const useFeedFaviconRefreshed = () => {
  const context = useContext(FeedFaviconRefreshedContext);
  if (context === undefined) throw new Error('useFeedFaviconRefreshed must be used within UIProvider');
  return context;
};

// ─── Unified Hook (Backward Compatibility) ───

export const useFeed = (): FeedContextType => {
  const nav = useFeedNavigation();
  const articles = useFeedCollectionArticles();
  const loading = useFeedCollectionLoading();
  const actions = useFeedCollectionActions();
  const overlay = useFeedOverlay();
  const ui = useFeedUI();

  return useMemo(() => ({
    ...nav,
    ...articles,
    ...loading,
    ...actions,
    ...overlay,
    ...ui,
  }), [actions, articles, loading, nav, overlay, ui]);
};
