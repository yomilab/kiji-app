import React, { createContext, useContext, useCallback, ReactNode, useTransition, useRef, useReducer, useMemo } from 'react';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';
import type { Article } from '@/types/article';
import type { ArticleQuery } from '@/types/articleQuery';
import { FEED_FETCH_COOLDOWN_MS } from '@/constants';
import { maybeRefreshFavicon } from '@/services/favicons/faviconRefreshService';
import { getFeedRefreshBlock } from '@/services/feeds/feedRefreshPolicy';
import type { Feed } from '@/services/feeds/feedsManager';
import { logger } from '@/services/logger';
import { debugOnly } from '@/services/system/env';
import { storage } from '@/services/storage/storageFactory';
import { useDependencyEffect, useMountEffect } from '@/hooks/useLifecycleEffects';
import type { SmartViewId } from '@/constants';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { feedRefreshCoordinator } from '@/services/feeds/feedRefreshCoordinator';
import { feedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { interactionPerformance } from '@/services/performance/interactionPerformance';

const FEED_SWITCH_STORED_ANIMATION_WAIT_MS = 420;
const SMART_VIEW_ARTICLE_LIMIT = 100;
const ARTICLE_LIST_LOAD_MORE_LIMIT = 100;
const SOURCE_ARTICLE_SNAPSHOT_CACHE_MAX_ENTRIES = 8;
const SOURCE_ARTICLE_SNAPSHOT_MAX_ROWS = 500;
const STATION_REFRESH_WORKER_COUNT = 4;
const STATION_REFRESH_UI_BUDGET_POLL_MS = 50;
const SCHEDULER_UI_BATCH_DELAY_MS = 250;
const BACKGROUND_REFRESH_SCROLL_IDLE_DELAY_MS = 450;
const DEFAULT_ARTICLE_LIST_SORT: NonNullable<ArticleQuery['sort']> = { field: 'publishedDate', order: 'desc' };
const LAST_SIDEBAR_SELECTION_KEY = 'last-sidebar-selection';
const HAS_PERFORMANCE_API = typeof performance !== 'undefined' && typeof performance.mark === 'function';
export type ArticleViewOverlayPhase = 'closed' | 'opening' | 'open' | 'closing';
export type ArticleListUpdatePayload = Partial<Pick<Article, 'read' | 'saved' | 'savedArticleId' | 'starred' | 'lastReadAt'>>;
type LoadMoreArticlesOptions = {
  showLoadingIndicator?: boolean;
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

const createFeedIdArticleListQuery = (feedIds: string[], searchText?: string | null): ArticleQuery => {
  const normalizedSearchText = searchText?.trim();
  return {
    feedIds,
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
  selectTag: (tagName: string, options?: RefreshTriggerOptions) => Promise<void>;
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
  isSavedListLoading: boolean;
  isFetchingNew: boolean;
  newArticleCount: number;
  newArticleHashes: Set<string>;
  isGlobalLoadingIndicatorActive: boolean;
  articleListScrollRequest: ArticleListScrollRequest | null;
}

interface ArticleListViewportSnapshot {
  isSearchActive: boolean;
  isAtTop: boolean;
  anchorHash: string | null;
  isScrolling?: boolean;
}

interface ArticleListScrollRequest {
  revision: number;
  mode: 'top' | 'anchor';
  anchorHash: string | null;
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

export interface FeedContextType extends NavigationState, NavigationActions, CollectionState, CollectionActions, OverlayState, OverlayActions, UIState, UIActions {}

const NavigationContext = createContext<(NavigationState & NavigationActions) | undefined>(undefined);
const CollectionContext = createContext<(CollectionState & CollectionActions) | undefined>(undefined);
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
  | { type: 'RESET_ARTICLES' };

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

// Keep infinite-scroll append idempotent: stale/retried page fetches should not
// duplicate heavy article payloads in memory.
const mergeUniqueArticlesByHash = (existing: Article[], incoming: Article[]): Article[] => {
  if (incoming.length === 0) {
    return existing;
  }

  const incomingHashes = new Set<string>();
  const uniqueIncoming: Article[] = [];

  for (const article of incoming) {
    if (incomingHashes.has(article.hash)) {
      continue;
    }
    incomingHashes.add(article.hash);
    uniqueIncoming.push(article);
  }

  if (uniqueIncoming.length === 0) {
    return existing;
  }

  let overlapsExisting = false;
  for (const article of existing) {
    if (incomingHashes.has(article.hash)) {
      overlapsExisting = true;
      break;
    }
  }

  if (!overlapsExisting) {
    return [...existing, ...uniqueIncoming];
  }

  const seenHashes = new Set(existing.map((article) => article.hash));
  const dedupedIncoming = uniqueIncoming.filter((article) => {
    if (seenHashes.has(article.hash)) {
      return false;
    }
    seenHashes.add(article.hash);
    return true;
  });

  if (dedupedIncoming.length === 0) {
    return existing;
  }

  return [...existing, ...dedupedIncoming];
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
    isSavedListLoading: false,
    isFetchingNew: false,
    newArticleCount: 0,
    newArticleHashes: new Set<string>(),
    isGlobalLoadingIndicatorActive: false,
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
  const selectionAbortControllerRef = useRef<AbortController | null>(null);
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
    collectionDispatch({ type: 'SET_ARTICLES', payload: { list: snapshot.list, total: snapshot.total } });
    collectionDispatch({
      type: 'SET_LOADING',
      payload: {
        isLoadingArticles: false,
        isSavedListLoading: false,
        isFetchingNew: false,
        isLoadingMoreArticles: false,
      },
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

  const beginSelectionRequest = useCallback((): number => {
    selectionAbortControllerRef.current?.abort();
    pendingLoadMoreCommitMetricRef.current = null;
    pendingBackgroundRefreshSourceKeyRef.current = null;
    clearStationUiRefreshTimer();
    const controller = new AbortController();
    selectionAbortControllerRef.current = controller;
    selectionTokenRef.current += 1;
    return selectionTokenRef.current;
  }, [clearStationUiRefreshTimer]);

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
    anchorHash: string | null = null
  ): ArticleListScrollRequest => {
    backgroundScrollRequestRevisionRef.current += 1;
    return {
      revision: backgroundScrollRequestRevisionRef.current,
      mode,
      anchorHash,
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
          // Keep users anchored after passive inserts: jump to the top only
          // when they are already there, otherwise preserve a nearby row.
          const scrollRequest = articleListAtTopRef.current
            ? createBackgroundScrollRequest('top')
            : (articleListAnchorHashRef.current
              ? createBackgroundScrollRequest('anchor', articleListAnchorHashRef.current)
              : null);

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

  const refreshStationFeeds = useCallback(async (
    feedIds: string[],
    options: RefreshTriggerOptions,
    token: number,
    sourceKey: string,
  ): Promise<number> => {
    if (feedIds.length === 0) {
      return 0;
    }

    const releaseQueuedFeed = feedRefreshActivity.beginQueuedFeeds(feedIds);
    const activeSignal = selectionAbortControllerRef.current?.signal;
    const feedsNeedingCountSync = new Set<string>();
    let nextFeedIndex = 0;
    let insertedTotal = 0;

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
        if (!feed) {
          releaseQueuedStationFeed();
          return 0;
        }
        if (!isSelectionActive(token)) {
          releaseQueuedStationFeed();
          return 0;
        }

        const refreshBlock = options.forceNetwork
          ? null
          : getFeedRefreshBlock(feed, FEED_FETCH_COOLDOWN_MS, {
              includeBackoff: !options.bypassBackoff,
            });
        if (refreshBlock) {
          logFeedRefreshSkip(feed, refreshBlock);
          releaseQueuedStationFeed();
          return 0;
        }

        try {
          const result = await refreshFeedFromNetwork(
            feed,
            {
              onFetchSettled: releaseQueuedStationFeed,
              waitForUiBudget: () => waitForStationRefreshUiBudget(activeSignal),
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

    const runWorker = async (): Promise<void> => {
      while (isSelectionActive(token)) {
        const feedId = feedIds[nextFeedIndex];
        nextFeedIndex += 1;
        if (!feedId) {
          return;
        }
        insertedTotal += await refreshOneFeed(feedId);
      }
    };

    try {
      const workerCount = Math.min(STATION_REFRESH_WORKER_COUNT, feedIds.length);
      await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));

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

      return insertedTotal;
    } finally {
      releaseQueuedFeed();
    }
  }, [
    isSelectionActive,
    recordFeedRefreshFailure,
    refreshFeedFromNetwork,
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

  const syncArticleListViewport = useCallback((snapshot: ArticleListViewportSnapshot) => {
    const wasSearchActive = articleListSearchActiveRef.current;

    articleListSearchActiveRef.current = snapshot.isSearchActive;
    articleListAtTopRef.current = snapshot.isAtTop;
    articleListAnchorHashRef.current = snapshot.anchorHash;

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
        if (
          !activeSource
          || articleListSearchActiveRef.current
          || pendingBackgroundRefreshSourceKeyRef.current !== activeSource.key
        ) {
          return;
        }

        void applyBackgroundRefreshForSource(activeSource);
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
  }, [applyBackgroundRefreshForSource]);

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

  const handleFeedSelection = useCallback(async (
    feedId: string,
    shouldReset: boolean,
    token: number,
    options: RefreshTriggerOptions = {},
  ) => {
    // PERFORMANCE_DEBUG: Track selection-to-render latency
    const perfMark = `select-feed:${feedId}:${token}`;
    if (HAS_PERFORMANCE_API) {
      performance.mark(`${perfMark}:start`);
    }

    if (shouldReset) {
      collectionDispatch({ type: 'RESET_ARTICLES' });
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: true, isSavedListLoading: false, isFetchingNew: false },
      });
      setActiveArticle(null);
    }

    if (shouldReset && !await yieldToSelectionCoalescing(token)) return;

    try {
      const feedQuery = createArticleListQuery({ feedIds: [feedId] });
      const feedMetaPromise = feedStore.getById(feedId);
      const storedPromise = shouldReset ? articleStore.query(feedQuery) : null;

      if (shouldReset) {
        const storedResult = storedPromise ? await storedPromise : null;
        if (!storedResult) return;
        const { articles: stored, total } = storedResult;
        if (!isSelectionActive(token)) return;
        lastQueryRef.current = feedQuery;

        dispatchArticlesTransition(stored, total);
        collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
        interactionPerformance.markTimedInteractionStage('sidebar-switch', `feed:${feedId}`, 'cachedReady', {
          cachedArticleCount: stored.length,
          cachedArticleTotal: total,
        });
        
        // PERFORMANCE_DEBUG: Measure time to first paint (cached data)
        if (HAS_PERFORMANCE_API) {
          performance.mark(`${perfMark}:cached-ready`);
          performance.measure(`${perfMark}:to-cached`, `${perfMark}:start`, `${perfMark}:cached-ready`);
        }

        await new Promise((resolve) => setTimeout(resolve, FEED_SWITCH_STORED_ANIMATION_WAIT_MS));
        if (!isSelectionActive(token)) return;
      }

      const feedMeta = await feedMetaPromise;
      if (!feedMeta || !isSelectionActive(token)) return;

      collectionDispatch({ type: 'SET_LOADING', payload: { isFetchingNew: true } });
      const refreshBlock = options.forceNetwork
        ? null
        : getFeedRefreshBlock(feedMeta, FEED_FETCH_COOLDOWN_MS, { includeBackoff: true });
      if (refreshBlock) {
        logFeedRefreshSkip(feedMeta, refreshBlock);
        return;
      }

      const activeSignal = selectionAbortControllerRef.current?.signal;
      try {
        await refreshFeedFromNetwork(feedMeta, { updateCounts: true }, activeSignal);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        await recordFeedRefreshFailure(feedMeta, error);
        throw error;
      }
      if (!isSelectionActive(token)) return;

      const { articles: fresh, total: freshTotal } = await articleStore.query(feedQuery);
      if (!isSelectionActive(token)) return;
      dispatchArticlesTransition(fresh, freshTotal);
      interactionPerformance.markTimedInteractionStage('sidebar-switch', `feed:${feedId}`, 'freshReady', {
        freshArticleCount: fresh.length,
        freshArticleTotal: freshTotal,
      });

      // PERFORMANCE_DEBUG: Measure total time to fresh content
      if (HAS_PERFORMANCE_API) {
        performance.mark(`${perfMark}:fresh-ready`);
        performance.measure(`${perfMark}:total-selection`, `${perfMark}:start`, `${perfMark}:fresh-ready`);
      }

      void maybeRefreshFavicon(feedId, feedMeta.url, () => {
        notifyFeedLibraryChanged();
      });
    } catch {
      clearError();
    } finally {
      if (isSelectionActive(token)) {
        collectionDispatch({ type: 'SET_LOADING', payload: { isFetchingNew: false, isLoadingArticles: false } });
      }
    }
  }, [
    clearError,
    dispatchArticlesTransition,
    isSelectionActive,
    notifyFeedLibraryChanged,
    recordFeedRefreshFailure,
    refreshFeedFromNetwork,
    setActiveArticle,
    startTransition,
    yieldToSelectionCoalescing,
  ]);

  const handleTagSelection = useCallback(async (
    tagName: string,
    shouldReset: boolean,
    token: number,
    options: RefreshTriggerOptions = {},
  ) => {
    // PERFORMANCE_DEBUG: Track tag selection latency
    const perfMark = `select-tag:${tagName}:${token}`;
    if (HAS_PERFORMANCE_API) {
      performance.mark(`${perfMark}:start`);
    }

    const sourceKey = `tag:${tagName}`;
    let restoredSnapshot: SourceArticleListSnapshot | null = null;

    if (shouldReset) {
      restoredSnapshot = restoreSourceArticleSnapshot(sourceKey);
      if (!restoredSnapshot) {
        collectionDispatch({ type: 'RESET_ARTICLES' });
        collectionDispatch({
          type: 'SET_LOADING',
          payload: { isLoadingArticles: true, isSavedListLoading: false, isFetchingNew: false },
        });
      }
      closeActiveArticleForSourceSwitch();
    }

    if (shouldReset && !await yieldToSelectionCoalescing(token)) return;

    try {
      feedScheduler.pauseForStationSelection();

      const feedIds = await tagsManager.getFeedsByTag(tagName);
      if (!isSelectionActive(token)) return;
      feedScheduler.setActiveStationFocus(sourceKey, feedIds);

      const tagQuery = createFeedIdArticleListQuery(feedIds);

      lastQueryRef.current = tagQuery;

      if (shouldReset) {
        if (restoredSnapshot) {
          interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'snapshotReady', {
            cachedArticleCount: restoredSnapshot.list.length,
            cachedArticleTotal: restoredSnapshot.total,
            taggedFeedCount: feedIds.length,
          });
        }

        const cachedVisibleCount = restoredSnapshot
          ? Math.max(restoredSnapshot.list.length, SMART_VIEW_ARTICLE_LIMIT)
          : SMART_VIEW_ARTICLE_LIMIT;
        const { articles: stored, total } = await articleStore.query({ ...tagQuery, limit: cachedVisibleCount });
        if (!isSelectionActive(token)) return;

        dispatchArticlesTransition(stored, total);
        collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
        interactionPerformance.markTimedInteractionStage('sidebar-switch', `tag:${tagName}`, 'cachedReady', {
          cachedArticleCount: stored.length,
          cachedArticleTotal: total,
          taggedFeedCount: feedIds.length,
        });

        // PERFORMANCE_DEBUG: Measure time to first paint (cached tag data)
        if (HAS_PERFORMANCE_API) {
          performance.mark(`${perfMark}:cached-ready`);
          performance.measure(`${perfMark}:to-cached`, `${perfMark}:start`, `${perfMark}:cached-ready`);
        }

        await yieldToArticleListPrefetchFrame();
        if (!isSelectionActive(token)) return;
      }

      collectionDispatch({ type: 'SET_LOADING', payload: { isFetchingNew: true } });
      const insertedCount = await refreshStationFeeds(
        feedIds,
        { ...options, bypassBackoff: shouldReset || options.bypassBackoff },
        token,
        sourceKey,
      );
      feedScheduler.suppressFeedsForNextCycle(feedIds);

      if (!isSelectionActive(token)) return;
      const visibleCount = Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT);
      let freshArticleCount = currentArticlesRef.current.length;
      let freshArticleTotal = collectionState.articlesTotalCount;
      if (insertedCount === 0) {
        // Cached content is already current, so avoid a second full DB query and
        // virtualized list publish on the station-switch path.
      } else if (isArticleViewTransitioning()) {
        pendingBackgroundRefreshSourceKeyRef.current = sourceKey;
      } else {
        const { articles: fresh, total: freshTotal } = await articleStore.query({ ...tagQuery, limit: visibleCount });
        if (!isSelectionActive(token)) return;
        freshArticleCount = fresh.length;
        freshArticleTotal = freshTotal;
        dispatchArticlesTransition(fresh, freshTotal);
      }
      interactionPerformance.markTimedInteractionStage('sidebar-switch', `tag:${tagName}`, 'freshReady', {
        freshArticleCount,
        freshArticleTotal,
        taggedFeedCount: feedIds.length,
      });

      // PERFORMANCE_DEBUG: Measure total time to fresh tag content
      if (HAS_PERFORMANCE_API) {
        performance.mark(`${perfMark}:fresh-ready`);
        performance.measure(`${perfMark}:total-selection`, `${perfMark}:start`, `${perfMark}:fresh-ready`);
      }

      if (!isSelectionActive(token)) return;

      // Schedule favicon backfill only after station feed refreshes and article list are ready.
      opmlWorkflowService.scheduleMissingFaviconsAfterStationSelection(feedIds);
    } finally {
      feedScheduler.resumeAfterStationSelection();

      if (isSelectionActive(token)) {
        collectionDispatch({ type: 'SET_LOADING', payload: { isFetchingNew: false, isLoadingArticles: false } });
      }
    }
  }, [
    dispatchArticlesTransition,
    collectionState.articlesTotalCount,
    isArticleViewTransitioning,
    isSelectionActive,
    refreshStationFeeds,
    restoreSourceArticleSnapshot,
    closeActiveArticleForSourceSwitch,
    startTransition,
    yieldToSelectionCoalescing,
  ]);

  const handleSmartViewSelection = useCallback(async (type: SmartViewType, shouldReset: boolean, token: number) => {
    if (shouldReset) {
      collectionDispatch({ type: 'RESET_ARTICLES' });
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: false, isSavedListLoading: false, isFetchingNew: false },
      });
      setActiveArticle(null);
      lastQueryRef.current = null;
    }

    if (shouldReset && !await yieldToSelectionCoalescing(token)) return;

    if (type === 'saved') {
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: false, isSavedListLoading: true, isFetchingNew: false },
      });

      try {
        const { articles: saved, total } = await savedArticlesService.querySavedViewArticles(SMART_VIEW_ARTICLE_LIMIT);
        if (!isSelectionActive(token)) return;

        dispatchArticlesTransition(saved, total);
        interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'cachedReady', {
          cachedArticleCount: saved.length,
          cachedArticleTotal: total,
        });

        const enriched = await savedArticlesService.enrichSavedViewArticlesMeta(saved);
        if (isSelectionActive(token)) {
          dispatchArticlesTransition(enriched, total);
          interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'enrichedReady', {
            enrichedArticleCount: enriched.length,
            enrichedArticleTotal: total,
          });
        }
      } finally {
        if (isSelectionActive(token)) {
          collectionDispatch({ type: 'SET_LOADING', payload: { isSavedListLoading: false, isFetchingNew: false } });
        }
      }
      return;
    }

    collectionDispatch({
      type: 'SET_LOADING',
      payload: { isLoadingArticles: true, isSavedListLoading: false, isFetchingNew: false },
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
      dispatchArticlesTransition(list, total);
      interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'cachedReady', {
        cachedArticleCount: list.length,
        cachedArticleTotal: total,
      });
    } finally {
      if (isSelectionActive(token)) {
        collectionDispatch({
          type: 'SET_LOADING',
          payload: { isLoadingArticles: false, isSavedListLoading: false, isFetchingNew: false },
        });
      }
    }
  }, [dispatchArticlesTransition, isSelectionActive, setActiveArticle, startTransition, yieldToSelectionCoalescing]);

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
    void handleFeedSelection(feedId, !isSameFeed, token, options);
  }, [beginSelectionRequest, clearArticleListScrollIdleState, handleFeedSelection]);

  const selectTag = useCallback(async (tagName: string, options: RefreshTriggerOptions = {}) => {
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
    void handleTagSelection(tagName, !isSameTag, token, options);
  }, [beginSelectionRequest, clearArticleListScrollIdleState, handleTagSelection]);

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
    clearArticleListScrollIdleState();
    selectionAbortControllerRef.current?.abort();
    selectionAbortControllerRef.current = null;
    prevNavRef.current = { id: null, tag: null, smart: null };
    selectionTokenRef.current += 1;
    navigationDispatch({ type: 'CLEAR_SELECTION' });
    collectionDispatch({ type: 'RESET_ARTICLES' });
    collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false, isSavedListLoading: false, isFetchingNew: false } });
  }, [clearArticleListScrollIdleState]);

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
    collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false, isSavedListLoading: false, isFetchingNew: false } });
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
          isFetchingNew: false,
          isLoadingMoreArticles: false,
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
        isFetchingNew: false,
        isLoadingMoreArticles: false,
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

    dispatchArticlesTransition(result.articles, result.total);
  }, [dispatchArticlesTransition, navigationState, queryArticleListSource]);

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

    currentArticlesRef.current = list;
    nonSearchArticlesRef.current = list;
    nonSearchArticlesTotalCountRef.current = total;
    lastQueryRef.current = query;
    dispatchArticlesTransition(list, total);
  }, [dispatchArticlesTransition, navigationState, queryArticleListSource]);

  const loadMoreArticles = useCallback(async (options: LoadMoreArticlesOptions = {}) => {
    const showLoadingIndicator = options.showLoadingIndicator ?? true;
    if (collectionState.isLoadingMoreArticles || loadMoreInFlightRef.current) return;
    if (collectionState.articles.length >= collectionState.articlesTotalCount) return;

    loadMoreInFlightRef.current = true;
    const token = selectionTokenRef.current;
    const activeSearchText = articleListSearchQueryRef.current;
    const offset = collectionState.articles.length;
    const requestedLimit = ARTICLE_LIST_LOAD_MORE_LIMIT;
    const sourceKey = activeSourceRef.current?.key ?? null;
    if (showLoadingIndicator) {
      collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingMoreArticles: true } });
    }
    try {
      if (!showLoadingIndicator) {
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
      if (showLoadingIndicator) {
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
      if (showLoadingIndicator && token === selectionTokenRef.current) {
        collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingMoreArticles: false } });
      }
    }
  }, [
    collectionState.articles.length,
    collectionState.articlesTotalCount,
    collectionState.isLoadingMoreArticles,
    createArticleQueryForSource,
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

  const isGlobalLoadingIndicatorActive = collectionState.isFetchingNew
    || collectionState.isSavedListLoading
    || (collectionState.isLoadingArticles && navigationState.selectedSmartView !== 'saved');

  const collectionValue = useMemo(() => ({
    ...collectionState,
    isGlobalLoadingIndicatorActive,
    refreshFeed,
    reloadCurrentSourceFromStore,
    loadMoreArticles,
    updateArticleInList,
    syncArticleListViewport,
    searchCurrentSource,
    clearArticleListSearch,
  }), [
    collectionState,
    isGlobalLoadingIndicatorActive,
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
              <CollectionContext.Provider value={collectionValue}>
                {children}
              </CollectionContext.Provider>
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

export const useFeedCollection = () => {
  const context = useContext(CollectionContext);
  if (!context) {
    const error = new Error('useFeedCollection must be used within CollectionProvider');
    logger.error('FeedContext', 'Collection context was missing during render', {
      search: typeof window !== 'undefined' ? window.location.search : null,
      stack: error.stack,
    });
    throw error;
  }
  return context;
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
  const coll = useFeedCollection();
  const overlay = useFeedOverlay();
  const ui = useFeedUI();

  return useMemo(() => ({
    ...nav,
    ...coll,
    ...overlay,
    ...ui,
  }), [nav, coll, overlay, ui]);
};
