import {
  backgroundRefreshQueryCount,
  capBackgroundRefreshList,
  isDocumentHidden,
} from '@/services/articles/backgroundRefreshListCap';
import React, { createContext, useContext, useCallback, ReactNode, useTransition, useRef, useReducer, useMemo } from 'react';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import * as articleStore from '@/stores/articleStore';
import { mergeUniqueArticlesByHash } from '@/services/articles/mergeUniqueArticlesByHash';
import { getInternedFeedMetadataCount } from '@/services/articles/articleListMemory';
import {
  articleListHasMore,
  resolveDeferredPageTotal,
} from '@/services/articles/articleListTotal';
import * as feedStore from '@/stores/feedStore';
import { getAllFeedMetadataCached } from '@/services/feeds/feedMetadataCache';
import {
  abortPendingSidebarRestore,
  beginSidebarRestoreAttempt,
  isCurrentSidebarRestoreAttempt,
} from '@/services/feeds/sidebarRestoreGeneration';
import {
  getCachedFeedIdsForTag,
  seedTagFeedIdsCache,
} from '@/services/tags/tagFeedIdsCache';
import type { Article } from '@/types/article';
import type { ArticleQuery } from '@/types/articleQuery';
import { FEED_FETCH_COOLDOWN_MS, isLibrarySmartViewId } from '@/constants';
import { notifyArticleReadChanged } from '@/services/articles/articleReadSignal';
import { maybeRefreshFavicon } from '@/services/favicons/faviconRefreshService';
import { getFeedRefreshBlock } from '@/services/feeds/feedRefreshPolicy';
import type { Feed } from '@/services/feeds/feedsManager';
import { logger } from '@/services/logger';
import { debugOnly } from '@/services/system/env';
import { getE2eConfig, writeE2eEvent } from '@/services/e2e/e2eHarness';
import { storage } from '@/services/storage/storageFactory';
import { useDependencyEffect, useMountEffect } from '@/hooks/useLifecycleEffects';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { isNativeFeedIngestionEnabled } from '@/services/scheduler/nativeSchedulerCycle';
import { runNativeFeedRefresh } from '@/services/scheduler/nativeFeedRefresh';
import {
  estimateSerializedArticleListKb,
  startRendererSessionMemoryDiagnostics,
} from '@/services/diagnostics/rendererSessionMemoryDiagnostics';
import { logListRefreshAttribution } from '@/services/diagnostics/webKitAttribution';
import { recordRobustnessEvent } from '@/services/diagnostics/robustnessMetrics';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { appToastService } from '@/services/ui/appToastService';
import {
  applyRowReadPatch,
  MARK_READ_UNDO_WINDOW_MS,
  markReadCutoff,
  markReadToastText,
  toMarkReadScope,
  type MarkReadOlderThanDays,
  type RowReadPatch,
} from '@/services/articles/markReadScope';
import { subscribeAssistantLibraryChanges, toArticleListUpdate } from '@/services/assistant/assistantLibraryChanges';
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
  sortStationSwitchRefreshIds,
} from '@/services/feeds/stationSwitchLimits';
import { SourceSwitchLifecycle } from '@/services/feeds/sourceSwitchLifecycle';
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
/** Post-clear list reload follows the live source; hop during the query retries this many times. */
const POST_CLEAR_SOURCE_RELOAD_MAX_ATTEMPTS = 4;
const DEFAULT_ARTICLE_LIST_SORT: NonNullable<ArticleQuery['sort']> = { field: 'publishedDate', order: 'desc' };
const READ_ARTICLE_LIST_SORT: NonNullable<ArticleQuery['sort']> = { field: 'lastReadAt', order: 'desc' };
const LAST_SIDEBAR_SELECTION_KEY = 'last-sidebar-selection';
const HAS_PERFORMANCE_API = typeof performance !== 'undefined' && typeof performance.mark === 'function';

/** Diagnostics only: a missing start mark (cleared timeline, path entered without a start) must not throw. */
function measureSelection(name: string, startMark: string, endMark: string): void {
  try {
    performance.measure(name, startMark, endMark);
  } catch {
    // Mark not set; skip this measurement.
  }
}
export type ArticleViewOverlayPhase = 'closed' | 'opening' | 'open' | 'closing';
export type ArticleListSearchStatus = 'idle' | 'pending' | 'ready' | 'error';
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
  totalKnown: boolean;
  pageWasFull: boolean;
  query: ArticleQuery | null;
};

type ActiveNonSearchSnapshot = SourceArticleListSnapshot & {
  sourceKey: string | null;
};

type LoadMorePagingSnapshot = {
  length: number;
  lastArticle: Article | undefined;
  articlesTotalCount: number;
  articlesTotalKnown: boolean;
  pageWasFull: boolean;
  isLoadingMoreArticles: boolean;
};

const getArticlePaginationCursor = (
  article: Article | undefined,
  sort?: ArticleQuery['sort'],
): ArticleQuery['cursor'] | undefined => {
  if (!article) {
    return undefined;
  }

  if (sort?.field === 'lastReadAt') {
    return {
      effectiveDate: article.lastReadAt ?? null,
      hash: article.hash,
    };
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

/** Cap on a frame yield: WebKit suspends rAF for an occluded window. */
const ARTICLE_LIST_FRAME_YIELD_MAX_WAIT_MS = 100;

const yieldToArticleListPrefetchFrame = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    // A hidden window never paints: waiting for a frame only adds 100 ms and
    // a misleading frameYield.timeout event (KiJi kept running in background).
    if (typeof window.requestAnimationFrame !== 'function' || isDocumentHidden()) {
      window.setTimeout(resolve, 0);
      return;
    }

    // An occluded window that still reports visible never paints, so a bare
    // rAF wait stalled station refresh (and held the scheduler pause) forever.
    let settled = false;
    let rafId: number | null = null;
    const finish = (viaTimeout: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timerId);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (viaTimeout) {
        recordRobustnessEvent('frameYield.timeout');
      }
      resolve();
    };
    const timerId = window.setTimeout(() => finish(true), ARTICLE_LIST_FRAME_YIELD_MAX_WAIT_MS);
    const scheduledRafId = window.requestAnimationFrame(() => finish(false));
    if (!settled) {
      rafId = scheduledRafId;
    }
  });
};
type SmartViewType = 'saved' | 'pinned' | 'unread' | 'today' | 'all' | 'read';

const smartViewSourceLabel = (viewType: SmartViewType): string => {
  switch (viewType) {
    case 'saved':
      return 'Saved';
    case 'pinned':
      return 'Pinned';
    case 'unread':
      return 'Unread';
    case 'today':
      return 'Today';
    case 'read':
      return 'Read';
    default:
      return 'All Items';
  }
};

type SidebarSelectionSnapshot =
  | { type: 'feed'; feedId: string }
  | { type: 'tag'; tagName: string }
  | { type: 'smart'; viewType: SmartViewType };

type RefreshTriggerOptions = {
  forceNetwork?: boolean;
  /** Station switch bypasses failure backoff but still respects the 60s fetch cooldown. */
  bypassBackoff?: boolean;
  awaitInitialFetch?: boolean;
  restore?: boolean;
  acknowledgeSidebar?: boolean;
};

type RefreshFeedFromNetworkOptions = {
  updateCounts?: boolean;
  waitForUiBudget?: () => Promise<void>;
  onFetchSettled?: () => void;
  skipNativeActivityQueue?: boolean;
};

type ListSourceSwitchPayloadResolution = {
  payload: FeedSourceRefreshPayload | TagSourceRefreshPayload;
  taggedFeedCount: number;
};

/** Source-specific inputs for the unified feed/tag switch pipeline. */
type ListSourceSwitchSpec = {
  token: number;
  shouldReset: boolean;
  sourceKey: string;
  perfMark: string;
  query: ArticleQuery;
  deferredTaggedFeedCount: number;
  deferredSqliteLimit?: number;
  deferredInteractionExtra?: Record<string, unknown>;
  awaitInitialFetch?: boolean;
  closeArticleForSwitch: () => void;
  closeTraceMark: 'source-reset' | 'article-close-requested';
  /**
   * Build the Phase B payload; may await IPC (station feed ids). Return null
   * when the selection was superseded during resolution.
   */
  resolveRefreshPayload: (context: {
    intent: SourceRefreshIntent;
    isColdSwitch: boolean;
  }) => Promise<ListSourceSwitchPayloadResolution | null>;
};

type FeedNetworkRefreshResult = {
  inserted: number;
};

/**
 * A native-ingestion feed failure. Rust `record_feed_failure` has already
 * persisted `consecutive_failures + 1`, so the renderer must not record it
 * again (a second write re-reads the bumped row and doubles the backoff).
 */
class NativeFeedRefreshFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeFeedRefreshFailure';
  }
}

const logNativeFeedRefreshFailure = (feedId: string, error: string): void => {
  recordRobustnessEvent('feedContext.nativeFailureNotReRecorded');
  logger.warn('FeedContext', 'Feed fetch failed from UI refresh (native recorded)', {
    feedId,
    error,
  });
};

// ─── Specialized Context Types ───

interface NavigationState {
  selectedFeedId: string | null;
  selectedFeedTitle: string | null;
  selectedTag: string | null;
  selectedSmartView: SmartViewType | null;
  navigationNonce: number;
}

interface NavigationActions {
  selectFeed: (feedId: string, feedUrl: string, feedTitle: string, options?: RefreshTriggerOptions) => Promise<void>;
  selectTag: (tagName: string, options?: RefreshTriggerOptions, feedIdsHint?: string[]) => Promise<void>;
  selectSmartView: (viewType: SmartViewType, options?: RefreshTriggerOptions) => Promise<void>;
  clearFeedSelection: () => void;
}

interface CollectionState {
  articles: Article[];
  articlesTotalCount: number;
  articlesTotalKnown: boolean;
  pageWasFull: boolean;
  visibleListIntentGeneration: number;
  searchStatus: ArticleListSearchStatus;
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
  | 'articles'
  | 'articlesTotalCount'
  | 'articlesTotalKnown'
  | 'pageWasFull'
  | 'newArticleCount'
  | 'newArticleHashes'
  | 'articleListScrollRequest'
>;

export type CollectionLoadingState = Pick<
  CollectionState,
  | 'isLoadingArticles'
  | 'isLoadingMoreArticles'
  | 'isLoadMoreInFlight'
  | 'isSavedListLoading'
  | 'searchStatus'
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
  updateArticleInList: (
    hash: string,
    updates?: ArticleListUpdatePayload,
    article?: Article | null,
    options?: { insertIntoSavedView?: boolean },
  ) => void;
  syncArticleListViewport: (snapshot: ArticleListViewportSnapshot) => void;
  searchCurrentSource: (query: string) => Promise<void>;
  clearArticleListSearch: () => Promise<void>;
  /** Mark All as Read (optionally only older than a day/week) for the list on screen. */
  markCurrentSourceRead: (options?: { olderThanDays?: MarkReadOlderThanDays }) => Promise<void>;
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
  | { type: 'CLEAR_SELECTION' };

function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'NAVIGATE_FEED':
      return {
        ...state,
        selectedFeedId: action.payload.id,
        selectedFeedTitle: action.payload.title,
        selectedTag: null,
        selectedSmartView: null,
        navigationNonce: state.navigationNonce + 1,
      };
    case 'NAVIGATE_TAG':
      return {
        ...state,
        selectedFeedId: null,
        selectedFeedTitle: action.payload,
        selectedTag: action.payload,
        selectedSmartView: null,
        navigationNonce: state.navigationNonce + 1,
      };
    case 'NAVIGATE_SMART':
      return {
        ...state,
        selectedFeedId: null,
        selectedFeedTitle: smartViewSourceLabel(action.payload),
        selectedTag: null,
        selectedSmartView: action.payload,
        navigationNonce: state.navigationNonce + 1,
      };
    case 'CLEAR_SELECTION':
      return { ...state, selectedFeedId: null, selectedFeedTitle: null, selectedTag: null, selectedSmartView: null, navigationNonce: state.navigationNonce + 1 };
    default:
      return state;
  }
}

type CollectionAction =
  | {
    type: 'PUBLISH_SEARCH_RESULT';
    payload: {
      list: Article[];
      total: number;
      totalKnown: boolean;
      pageWasFull: boolean;
      intentGeneration: number;
    };
  }
  | {
    type: 'SET_ARTICLES';
    payload: {
      list: Article[];
      total: number;
      totalKnown?: boolean;
      pageWasFull?: boolean;
      intentGeneration?: number;
    };
  }
  | {
    type: 'SET_ARTICLES_TOTAL';
    payload: { total: number; intentGeneration?: number };
  }
  | {
    type: 'APPLY_BACKGROUND_REFRESH';
    payload: {
      list: Article[];
      total: number;
      totalKnown?: boolean;
      pageWasFull?: boolean;
      newArticleHashes: Set<string>;
      scrollRequest: ArticleListScrollRequest | null;
      intentGeneration?: number;
    };
  }
  | { type: 'APPEND_ARTICLES'; payload: { articles: Article[]; intentGeneration: number } }
  | { type: 'PATCH_ROWS_READ'; payload: RowReadPatch }
  | { type: 'UPDATE_ARTICLE'; payload: { hash: string; updates: ArticleListUpdatePayload; removeFromUnread?: boolean; removeFromSaved?: boolean; removeFromRead?: boolean; insertOrMoveToTop?: boolean; article?: Article; intentGeneration?: number } }
  | { type: 'SET_LOADING'; payload: Partial<CollectionState> }
  | { type: 'SET_LIST_INTENT'; payload: { generation: number; searchStatus?: ArticleListSearchStatus } }
  | { type: 'SET_SEARCH_STATUS'; payload: { generation: number; status: ArticleListSearchStatus } }
  | { type: 'RESET_ARTICLES' }
  | {
    type: 'RESTORE_SOURCE_SNAPSHOT';
    payload: {
      list: Article[];
      total: number;
      totalKnown: boolean;
      pageWasFull: boolean;
      intentGeneration?: number;
    };
  }
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
      || (a.lastReadAt ?? '') !== (b.lastReadAt ?? '')
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

type ArticleListMutationPayload = Extract<CollectionAction, { type: 'UPDATE_ARTICLE' }>['payload'];

const applyArticleListMutation = (
  articles: Article[],
  total: number,
  totalKnown: boolean,
  payload: ArticleListMutationPayload,
): { articles: Article[]; total: number } => {
  const {
    hash,
    updates,
    removeFromUnread,
    removeFromSaved,
    removeFromRead,
    insertOrMoveToTop,
    article,
  } = payload;
  let nextArticles = articles;
  let nextTotal = total;

  if (removeFromUnread || removeFromSaved || removeFromRead) {
    const index = nextArticles.findIndex((entry) => entry.hash === hash);
    if (index !== -1) {
      nextArticles = nextArticles.filter((entry) => entry.hash !== hash);
      if (totalKnown) {
        nextTotal = Math.max(0, nextTotal - 1);
      }
    }
  } else if (insertOrMoveToTop) {
    const index = nextArticles.findIndex((entry) => entry.hash === hash);
    if (index !== -1) {
      const nextArticle = { ...nextArticles[index], ...updates };
      nextArticles = index === 0
        ? [nextArticle, ...nextArticles.slice(1)]
        : [
          nextArticle,
          ...nextArticles.slice(0, index),
          ...nextArticles.slice(index + 1),
        ];
    } else if (article) {
      nextArticles = [{ ...article, ...updates }, ...nextArticles];
      if (totalKnown) {
        nextTotal += 1;
      }
    }
  } else {
    nextArticles = nextArticles.map((entry) => (
      entry.hash === hash ? { ...entry, ...updates } : entry
    ));
  }

  return { articles: nextArticles, total: nextTotal };
};

function collectionReducer(state: CollectionState, action: CollectionAction): CollectionState {
  switch (action.type) {
    case 'SET_LIST_INTENT':
      if (action.payload.generation <= state.visibleListIntentGeneration) {
        return state;
      }
      return {
        ...state,
        visibleListIntentGeneration: action.payload.generation,
        ...(action.payload.searchStatus ? { searchStatus: action.payload.searchStatus } : {}),
        ...(action.payload.searchStatus === 'pending'
          ? { articlesTotalKnown: false, pageWasFull: false }
          : {}),
      };
    case 'SET_SEARCH_STATUS':
      if (
        action.payload.generation !== state.visibleListIntentGeneration
        || state.searchStatus === action.payload.status
      ) {
        return state;
      }
      return { ...state, searchStatus: action.payload.status };
    case 'PUBLISH_SEARCH_RESULT':
      if (action.payload.intentGeneration !== state.visibleListIntentGeneration) {
        return state;
      }
      return {
        ...state,
        articles: action.payload.list,
        articlesTotalCount: action.payload.total,
        articlesTotalKnown: action.payload.totalKnown,
        pageWasFull: action.payload.pageWasFull,
        searchStatus: 'ready',
      };
    case 'SET_ARTICLES': {
      if (
        action.payload.intentGeneration !== undefined
        && action.payload.intentGeneration !== state.visibleListIntentGeneration
      ) {
        return state;
      }
      const incomingKnown = action.payload.totalKnown ?? true;
      const pageWasFull = action.payload.pageWasFull ?? false;
      const keepExactTotal = state.articlesTotalKnown && incomingKnown === false;
      const totalKnown = keepExactTotal ? true : incomingKnown;
      const total = keepExactTotal ? state.articlesTotalCount : action.payload.total;
      if (
        state.articlesTotalCount === total
        && state.articlesTotalKnown === totalKnown
        && state.pageWasFull === pageWasFull
        && areArticleListsEquivalent(state.articles, action.payload.list)
      ) {
        return state;
      }
      return {
        ...state,
        articles: action.payload.list,
        articlesTotalCount: total,
        articlesTotalKnown: totalKnown,
        pageWasFull,
      };
    }
    case 'SET_ARTICLES_TOTAL':
      if (
        action.payload.intentGeneration !== undefined
        && action.payload.intentGeneration !== state.visibleListIntentGeneration
      ) {
        return state;
      }
      if (state.articlesTotalKnown && state.articlesTotalCount === action.payload.total) {
        return state;
      }
      return {
        ...state,
        articlesTotalCount: action.payload.total,
        articlesTotalKnown: true,
      };
    case 'APPLY_BACKGROUND_REFRESH':
      if (
        action.payload.intentGeneration !== undefined
        && action.payload.intentGeneration !== state.visibleListIntentGeneration
      ) {
        return state;
      }
      return {
        ...state,
        articles: action.payload.list,
        articlesTotalCount: action.payload.total,
        articlesTotalKnown: action.payload.totalKnown ?? true,
        pageWasFull: action.payload.pageWasFull ?? state.pageWasFull,
        newArticleCount: action.payload.newArticleHashes.size,
        newArticleHashes: action.payload.newArticleHashes,
        articleListScrollRequest: action.payload.scrollRequest,
      };
    case 'APPEND_ARTICLES': {
      if (action.payload.intentGeneration !== state.visibleListIntentGeneration) {
        return state;
      }
      if (action.payload.articles.length === 0) {
        return {
          ...state,
          articlesTotalCount: state.articles.length,
          articlesTotalKnown: true,
          pageWasFull: false,
        };
      }

      const nextArticles = mergeUniqueArticlesByHash(state.articles, action.payload.articles);
      const appendedFullPage = action.payload.articles.length >= ARTICLE_LIST_LOAD_MORE_LIMIT;
      if (state.articlesTotalKnown) {
        return {
          ...state,
          articles: nextArticles,
          pageWasFull: appendedFullPage,
        };
      }

      if (!appendedFullPage) {
        return {
          ...state,
          articles: nextArticles,
          articlesTotalCount: nextArticles.length,
          articlesTotalKnown: true,
          pageWasFull: false,
        };
      }

      return {
        ...state,
        articles: nextArticles,
        pageWasFull: true,
      };
    }
    case 'PATCH_ROWS_READ': {
      const articles = applyRowReadPatch(state.articles, action.payload);
      return articles === state.articles ? state : { ...state, articles };
    }
    case 'UPDATE_ARTICLE': {
      if (
        action.payload.intentGeneration !== undefined
        && action.payload.intentGeneration !== state.visibleListIntentGeneration
      ) {
        return state;
      }
      const next = applyArticleListMutation(
        state.articles,
        state.articlesTotalCount,
        state.articlesTotalKnown,
        action.payload,
      );
      return { ...state, articles: next.articles, articlesTotalCount: next.total };
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
        articlesTotalKnown: false,
        pageWasFull: false,
        newArticleCount: 0,
        newArticleHashes: new Set<string>(),
        articleListScrollRequest: null,
      };
    case 'RESTORE_SOURCE_SNAPSHOT':
      if (
        action.payload.intentGeneration !== undefined
        && action.payload.intentGeneration !== state.visibleListIntentGeneration
      ) {
        return state;
      }
      if (
        state.articlesTotalCount === action.payload.total
        && state.articlesTotalKnown === action.payload.totalKnown
        && state.pageWasFull === action.payload.pageWasFull
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
        articlesTotalKnown: action.payload.totalKnown,
        pageWasFull: action.payload.pageWasFull,
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
        && !state.articlesTotalKnown
        && !state.pageWasFull
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
        articlesTotalKnown: false,
        pageWasFull: false,
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

function createArticleListQuery(
  query: Omit<ArticleQuery, 'limit' | 'sort'>,
  sort: NonNullable<ArticleQuery['sort']> = DEFAULT_ARTICLE_LIST_SORT,
): ArticleQuery {
  return {
    ...query,
    limit: SMART_VIEW_ARTICLE_LIMIT,
    sort,
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

const getRefreshSourceDescriptorFromPrevNav = (
  nav: { id: string | null; tag: string | null; smart: string | null },
): RefreshSourceDescriptor | null => {
  if (nav.id) {
    return {
      type: 'feed',
      key: `feed:${nav.id}`,
      feedId: nav.id,
    };
  }

  if (nav.tag) {
    return {
      type: 'tag',
      key: `tag:${nav.tag}`,
      tagName: nav.tag,
    };
  }

  if (nav.smart) {
    return {
      type: 'smart',
      key: `smart:${nav.smart}`,
      viewType: nav.smart as SmartViewType,
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
    navigationNonce: 0,
  });
  const [collectionState, collectionDispatch] = useReducer(collectionReducer, {
    articles: [],
    articlesTotalCount: 0,
    articlesTotalKnown: false,
    pageWasFull: false,
    visibleListIntentGeneration: 0,
    searchStatus: 'idle',
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

  const switchLifecycleRef = useRef<SourceSwitchLifecycle | null>(null);
  if (switchLifecycleRef.current === null) {
    switchLifecycleRef.current = new SourceSwitchLifecycle();
  }
  const switchLifecycle = switchLifecycleRef.current;
  const selectionSchedulerPauseTokenRef = useRef<number | null>(null);
  // Cold switches keep the skeleton until deferred SQLite publishes. Phase B
  // must not clear loading (or resume the scheduler writer) while this token
  // still owns an empty list — that race flashes "0 articles" and can stall
  // the Phase A read behind a resumed background cycle (H16 / 2026-07 logs).
  const pendingColdSwitchSqliteTokenRef = useRef<number | null>(null);
  const deferNetworkSchedulerResumeTokenRef = useRef<number | null>(null);
  // Import switches (awaitInitialFetch) record here when the deferred page
  // commits empty, so Phase B — which awaits the first fetch — owns clearing
  // the skeleton: rows publish first, or Phase B settles onto the honest
  // empty view. No timers; superseded by the next beginSelectionRequest.
  const importEmptyCommitTokenRef = useRef<number | null>(null);
  const interactiveRefreshScopeTokenRef = useRef(0);
  const lastQueryRef = useRef<ArticleQuery | null>(null);
  const lastQuerySourceKeyRef = useRef<string | null>(null);
  const listReloadEpochRef = useRef(0);
  const backgroundScrollRequestRevisionRef = useRef(0);
  const activeSourceRef = useRef<RefreshSourceDescriptor | null>(null);
  const currentArticlesRef = useRef<Article[]>([]);
  const loadMorePagingSnapshotRef = useRef<LoadMorePagingSnapshot>({
    length: 0,
    lastArticle: undefined,
    articlesTotalCount: 0,
    articlesTotalKnown: false,
    pageWasFull: false,
    isLoadingMoreArticles: false,
  });
  const nonSearchSnapshotRef = useRef<ActiveNonSearchSnapshot>({
    sourceKey: null,
    list: [],
    total: 0,
    totalKnown: false,
    pageWasFull: false,
    query: null,
  });
  const articleListSearchActiveRef = useRef(false);
  const articleListSearchQueryRef = useRef<string | null>(null);
  const articleListSearchRevisionRef = useRef(0);
  const articleListSearchStatusRef = useRef<ArticleListSearchStatus>('idle');
  const visibleListIntentGenerationRef = useRef(0);
  const searchRunnerActiveRef = useRef(false);
  const activeSearchEpochRef = useRef<string | null>(null);
  const searchOverlayWakeRef = useRef<(() => void) | null>(null);
  const pendingSearchRequestRef = useRef<{
    source: RefreshSourceDescriptor;
    searchText: string;
    visibleCount: number;
    searchRevision: number;
    intentGeneration: number;
    resolve: () => void;
  } | null>(null);
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
  const activeSchedulerCycleIdRef = useRef<number | null>(null);
  const schedulerUiBatchTimerRef = useRef<number | null>(null);
  const schedulerUiFlushInFlightRef = useRef(false);
  const schedulerUiFlushQueuedRef = useRef(false);
  const stationUiBatchTimerRef = useRef<number | null>(null);
  const pendingStationRefreshSourceKeyRef = useRef<string | null>(null);
  const pendingSwitchVisibleReconcileRef = useRef<{
    token: number;
    sourceKey: string;
    tagQuery: ArticleQuery;
    mode: 'total-only' | 'full';
  } | null>(null);
  // Warm snapshot paint is first-frame only. Native Phase B boostMany returns 0
  // and total-only reconcile no-ops when totalKnown, so overnight SQLite rows
  // never replace the cached list until a later insert on the active source.
  // One token-scoped full page replace (n ≤ snapshot cap) closes that hole
  // without a second cold deferred page (H17) or a sticky 0-insert interval hook.
  // Hold scheduler resume while that COUNT is in flight so a 0-insert native
  // cycle cannot race the live query. Cmd+R that cancels it re-arms via
  // warmFullSuccessorSourceKeyRef (same source only).
  const warmSnapshotReconcileTokenRef = useRef<number | null>(null);
  const warmSnapshotReconcileInFlightRef = useRef<number | null>(null);
  const warmFullSuccessorSourceKeyRef = useRef<string | null>(null);
  const articleViewOverlayPhaseRef = useRef<ArticleViewOverlayPhase>('closed');
  const activeArticleHashRef = useRef<string | null>(null);
  const updateArticleInListRef = useRef<CollectionActions['updateArticleInList']>(() => {});
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
            throw new NativeFeedRefreshFailure(feedResult.error);
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
    return switchLifecycle.isActive(token);
  }, [switchLifecycle]);

  const wakeSearchOverlayWaiter = useCallback((): void => {
    const wake = searchOverlayWakeRef.current;
    searchOverlayWakeRef.current = null;
    wake?.();
  }, []);

  const settlePendingSearchRequest = useCallback((): void => {
    const pending = pendingSearchRequestRef.current;
    pendingSearchRequestRef.current = null;
    pending?.resolve();
  }, []);

  const cancelActiveSearch = useCallback((): void => {
    const epoch = activeSearchEpochRef.current;
    if (epoch !== null) {
      void articleStore.cancelSearch?.(epoch);
    }
  }, []);

  const advanceVisibleListIntent = useCallback((
    searchStatus: ArticleListSearchStatus = articleListSearchQueryRef.current === null ? 'idle' : 'pending',
  ): number => {
    const generation = visibleListIntentGenerationRef.current + 1;
    visibleListIntentGenerationRef.current = generation;
    articleListSearchStatusRef.current = searchStatus;
    wakeSearchOverlayWaiter();
    collectionDispatch({
      type: 'SET_LIST_INTENT',
      payload: { generation, searchStatus },
    });
    return generation;
  }, [wakeSearchOverlayWaiter]);

  const setArticleListSearchStatus = useCallback((
    generation: number,
    status: ArticleListSearchStatus,
  ): void => {
    if (visibleListIntentGenerationRef.current !== generation) {
      return;
    }
    articleListSearchStatusRef.current = status;
    collectionDispatch({ type: 'SET_SEARCH_STATUS', payload: { generation, status } });
  }, []);

  const dispatchArticlesTransition = useCallback((
    list: Article[],
    total: number,
    options?: {
      clearSwitchLoading?: boolean;
      totalKnown?: boolean;
      pageWasFull?: boolean;
      intentGeneration?: number;
    },
  ) => {
    // Treat full-list swaps as non-urgent so rapid sidebar navigation can keep
    // updating selection affordances while the heavier article tree catches up.
    // When the publish ends a switch skeleton, the loading clear must land in
    // the same transition commit: an urgent SET_LOADING would render before the
    // deferred SET_ARTICLES and flash an empty "0 articles" list.
    startTransition(() => {
      collectionDispatch({
        type: 'SET_ARTICLES',
        payload: {
          list,
          total,
          totalKnown: options?.totalKnown,
          pageWasFull: options?.pageWasFull,
          intentGeneration: options?.intentGeneration,
        },
      });
      if (options?.clearSwitchLoading) {
        collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
      }
    });
  }, [startTransition]);

  const dispatchArticlesTransitionIfChanged = useCallback((
    list: Article[],
    total: number,
    options?: {
      clearSwitchLoading?: boolean;
      totalKnown?: boolean;
      pageWasFull?: boolean;
      sourceKey?: string;
      filterKind?: 'filtered' | 'unfiltered';
      searchRevision?: number;
      intentGeneration?: number;
      query?: ArticleQuery | null;
    },
  ): boolean => {
    const intentGeneration = options?.intentGeneration ?? visibleListIntentGenerationRef.current;
    if (intentGeneration !== visibleListIntentGenerationRef.current) {
      return false;
    }

    const activeSourceKey = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)?.key
      ?? activeSourceRef.current?.key
      ?? null;
    const sourceKey = options?.sourceKey ?? activeSourceKey;
    if (sourceKey !== null && sourceKey !== activeSourceKey) {
      return false;
    }

    const hasAppliedSearchQuery = articleListSearchQueryRef.current !== null;
    const isSearchActive = hasAppliedSearchQuery || articleListSearchActiveRef.current;
    const totalKnown = options?.totalKnown ?? true;
    const pageWasFull = options?.pageWasFull ?? false;
    const filterKind = options?.filterKind ?? 'unfiltered';

    if (filterKind === 'filtered') {
      if (
        !hasAppliedSearchQuery
        || options?.searchRevision !== articleListSearchRevisionRef.current
      ) {
        return false;
      }
      currentArticlesRef.current = list;
      loadMorePagingSnapshotRef.current = {
        length: list.length,
        lastArticle: list[list.length - 1],
        articlesTotalCount: total,
        articlesTotalKnown: totalKnown,
        pageWasFull,
        isLoadingMoreArticles: false,
      };
      articleListSearchStatusRef.current = 'ready';
      collectionDispatch({
        type: 'PUBLISH_SEARCH_RESULT',
        payload: {
          list,
          total,
          totalKnown,
          pageWasFull,
          intentGeneration,
        },
      });
      return true;
    }

    if (isSearchActive) {
      nonSearchSnapshotRef.current = {
        sourceKey,
        list,
        total,
        totalKnown,
        pageWasFull,
        query: options?.query ?? nonSearchSnapshotRef.current.query,
      };
      return false;
    }

    const nonSearchSnapshot = nonSearchSnapshotRef.current;
    if (
      nonSearchSnapshot.sourceKey === sourceKey
      && nonSearchSnapshot.total === total
      && nonSearchSnapshot.totalKnown === totalKnown
      && nonSearchSnapshot.pageWasFull === pageWasFull
      && areArticleListsEquivalent(currentArticlesRef.current, list)
    ) {
      return false;
    }

    currentArticlesRef.current = list;
    loadMorePagingSnapshotRef.current = {
      length: list.length,
      lastArticle: list[list.length - 1],
      articlesTotalCount: total,
      articlesTotalKnown: totalKnown,
      pageWasFull,
      isLoadingMoreArticles: false,
    };
    nonSearchSnapshotRef.current = {
      sourceKey,
      list,
      total,
      totalKnown,
      pageWasFull,
      query: options?.query ?? nonSearchSnapshot.query,
    };
    dispatchArticlesTransition(list, total, { ...options, intentGeneration });
    return true;
  }, [dispatchArticlesTransition, setArticleListSearchStatus]);

  const clearSwitchLoadingInTransition = useCallback(() => {
    // Sequence the skeleton clear behind any pending article-list transition so
    // the empty pre-switch list is never rendered with loading already false.
    startTransition(() => {
      collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false } });
    });
  }, [startTransition]);

  const rememberSourceArticleSnapshot = useCallback((
    sourceKey: string,
    list: Article[],
    total: number,
    query: ArticleQuery | null,
    totalKnown: boolean,
    pageWasFull: boolean,
  ) => {
    if (list.length === 0) {
      return;
    }

    const cache = sourceArticleSnapshotCacheRef.current;
    const boundedList = list.length > SOURCE_ARTICLE_SNAPSHOT_MAX_ROWS
      ? list.slice(0, SOURCE_ARTICLE_SNAPSHOT_MAX_ROWS)
      : list;

    cache.delete(sourceKey);
    cache.set(sourceKey, { list: boundedList, total, totalKnown, pageWasFull, query });

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

    rememberSourceArticleSnapshot(
      sourceKey,
      snapshot.list,
      snapshot.total,
      snapshot.query,
      snapshot.totalKnown,
      snapshot.pageWasFull,
    );
    currentArticlesRef.current = snapshot.list;
    loadMorePagingSnapshotRef.current = {
      length: snapshot.list.length,
      lastArticle: snapshot.list[snapshot.list.length - 1],
      articlesTotalCount: snapshot.total,
      articlesTotalKnown: snapshot.totalKnown,
      pageWasFull: snapshot.pageWasFull,
      isLoadingMoreArticles: false,
    };
    nonSearchSnapshotRef.current = { sourceKey, ...snapshot };
    lastQueryRef.current = snapshot.query;
    lastQuerySourceKeyRef.current = sourceKey;
    collectionDispatch({
      type: 'RESTORE_SOURCE_SNAPSHOT',
      payload: {
        list: snapshot.list,
        total: snapshot.total,
        totalKnown: snapshot.totalKnown,
        pageWasFull: snapshot.pageWasFull,
        intentGeneration: visibleListIntentGenerationRef.current,
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

  const releaseHeldWarmFullSchedulerResume = useCallback((token: number) => {
    if (deferNetworkSchedulerResumeTokenRef.current === token) {
      deferNetworkSchedulerResumeTokenRef.current = null;
      completeSelectionSwitchNetworkPriority(token);
    }
  }, [completeSelectionSwitchNetworkPriority]);

  const shouldHoldSchedulerResumeForWarmFull = (token: number): boolean => {
    if (warmSnapshotReconcileInFlightRef.current === token) {
      return true;
    }
    if (warmSnapshotReconcileTokenRef.current !== token) {
      return false;
    }
    const pending = pendingSwitchVisibleReconcileRef.current;
    // Freeze re-stash: pending full is the surviving channel — resume may proceed.
    if (pending?.token === token && pending.mode === 'full') {
      return false;
    }
    return true;
  };

  const clearPendingColdSwitchSqlite = useCallback((token: number) => {
    if (pendingColdSwitchSqliteTokenRef.current === token) {
      pendingColdSwitchSqliteTokenRef.current = null;
    }
  }, []);

  const finishColdSwitchSqliteAndResumeIfNeeded = useCallback((token: number) => {
    clearPendingColdSwitchSqlite(token);
    if (deferNetworkSchedulerResumeTokenRef.current === token) {
      deferNetworkSchedulerResumeTokenRef.current = null;
      completeSelectionSwitchNetworkPriority(token);
    }
  }, [clearPendingColdSwitchSqlite, completeSelectionSwitchNetworkPriority]);

  /**
   * Phase B `finally` helper: keep the cold-switch skeleton (and scheduler
   * pause) while deferred SQLite still owns an empty list. Otherwise clear
   * loading and resume as before.
   */
  const completeNetworkPhaseSwitchLoading = useCallback((token: number) => {
    if (!isSelectionActive(token)) {
      return;
    }

    if (
      pendingColdSwitchSqliteTokenRef.current === token
      && currentArticlesRef.current.length > 0
    ) {
      // Phase B reconcile (or a racing deferred commit) already published rows.
      clearPendingColdSwitchSqlite(token);
      importEmptyCommitTokenRef.current = null;
    }

    const coldSqliteOwnsSkeleton =
      pendingColdSwitchSqliteTokenRef.current === token
      && currentArticlesRef.current.length === 0;

    if (coldSqliteOwnsSkeleton) {
      if (importEmptyCommitTokenRef.current === token) {
        // Import switch: the deferred page already committed empty and Phase B
        // has now settled after awaiting the first fetch — nothing more will
        // publish for this attempt, so show the honest empty view.
        importEmptyCommitTokenRef.current = null;
        clearPendingColdSwitchSqlite(token);
        clearSwitchLoadingInTransition();
        completeSelectionSwitchNetworkPriority(token);
        return;
      }

      deferNetworkSchedulerResumeTokenRef.current = token;
      return;
    }

    clearSwitchLoadingInTransition();
    if (shouldHoldSchedulerResumeForWarmFull(token)) {
      deferNetworkSchedulerResumeTokenRef.current = token;
      return;
    }
    completeSelectionSwitchNetworkPriority(token);
  }, [
    clearPendingColdSwitchSqlite,
    clearSwitchLoadingInTransition,
    completeSelectionSwitchNetworkPriority,
    isSelectionActive,
  ]);

  const beginSelectionSwitchNetworkPriority = useCallback((token: number) => {
    feedScheduler.pauseForStationSelection();
    selectionSchedulerPauseTokenRef.current = token;
  }, []);

  const beginSelectionRequest = useCallback((options?: { acknowledge?: boolean }): number => {
    const previousToken = switchLifecycle.currentToken;
    const previousSourceKey = activeSourceRef.current?.key ?? null;
    const hadWarmFull =
      warmSnapshotReconcileTokenRef.current !== null
      || warmSnapshotReconcileInFlightRef.current !== null
      || pendingSwitchVisibleReconcileRef.current?.mode === 'full';
    abortSelectionSwitchPriority();
    // Supersedes the previous attempt: aborts its signal, clears its timers
    // (deferred SQLite recovery), and cancels its paint-gate waits.
    const token = switchLifecycle.begin();
    pendingLoadMoreCommitMetricRef.current = null;
    pendingBackgroundRefreshSourceKeyRef.current = null;
    pendingSwitchVisibleReconcileRef.current = null;
    pendingColdSwitchSqliteTokenRef.current = null;
    deferNetworkSchedulerResumeTokenRef.current = null;
    importEmptyCommitTokenRef.current = null;
    warmSnapshotReconcileTokenRef.current = null;
    warmSnapshotReconcileInFlightRef.current = null;
    warmFullSuccessorSourceKeyRef.current = hadWarmFull && previousSourceKey
      ? previousSourceKey
      : null;
    clearStationUiRefreshTimer();
    cancelSourceSelectionRefreshSchedule();
    if (previousToken > 0) {
      sidebarSwitchTrace.cancel(previousToken, 'superseded');
    }
    if (options?.acknowledge !== false) {
      feedScheduler.acknowledgeSidebarInteraction();
    }
    beginSelectionSwitchNetworkPriority(token);
    return token;
  }, [abortSelectionSwitchPriority, beginSelectionSwitchNetworkPriority, clearStationUiRefreshTimer, switchLifecycle]);

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

    if (source.viewType === 'today') {
      return withSearchText({
        today: true,
        limit,
        sort: DEFAULT_ARTICLE_LIST_SORT,
      });
    }

    if (source.viewType === 'read') {
      return withSearchText({
        filter: { read: true },
        limit,
        sort: READ_ARTICLE_LIST_SORT,
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
    searchText?: string | null,
    options?: { searchRequest?: boolean; searchEpoch?: string },
  ): Promise<{
    articles: Article[];
    total: number;
    totalKnown: boolean;
    pageWasFull: boolean;
    query: ArticleQuery | null;
    cancelled: boolean;
  }> => {
    const normalizedSearchText = searchText?.trim() || undefined;
    const isSearchRequest = options?.searchRequest === true && normalizedSearchText !== undefined;
    const limit = Math.max(SMART_VIEW_ARTICLE_LIMIT, visibleCount);

    if (source.type === 'smart' && source.viewType === 'saved') {
      const result = await savedArticlesService.querySavedViewArticles(
        limit,
        undefined,
        normalizedSearchText,
        isSearchRequest ? false : undefined,
        options?.searchEpoch,
      );
      if (result.cancelled) {
        return {
          articles: [],
          total: 0,
          totalKnown: false,
          pageWasFull: false,
          query: null,
          cancelled: true,
        };
      }
      // Saved search rows already carry persisted feed metadata. Avoid the
      // normal view's per-row enrichment here: it is uncancellable and would
      // serialize up to 100 indexed IPC reads ahead of the latest query.
      const enriched = isSearchRequest
        ? result.articles
        : await savedArticlesService.enrichSavedViewArticlesMeta(result.articles);
      const totalKnown = !isSearchRequest || enriched.length < limit;
      return {
        articles: enriched,
        total: totalKnown ? (isSearchRequest ? enriched.length : result.total) : enriched.length,
        totalKnown,
        pageWasFull: enriched.length >= limit,
        query: null,
        cancelled: false,
      };
    }

    const query = {
      ...createArticleQueryForSource(source, visibleCount, normalizedSearchText),
      ...(isSearchRequest ? { includeTotal: false } : {}),
      ...(options?.searchEpoch ? { searchEpoch: options.searchEpoch } : {}),
    };
    const result = await articleStore.query(query);
    const totalKnown = !isSearchRequest || result.articles.length < limit;
    return {
      articles: result.articles,
      total: totalKnown ? (isSearchRequest ? result.articles.length : result.total) : result.articles.length,
      totalKnown,
      pageWasFull: result.articles.length >= limit,
      query,
      cancelled: result.cancelled === true,
    };
  }, [createArticleQueryForSource]);

  const enqueueSearchRequest = useCallback(async (
    source: RefreshSourceDescriptor,
    rawQuery: string,
    visibleCount = SMART_VIEW_ARTICLE_LIMIT,
  ): Promise<void> => {
    const searchText = rawQuery.trim();
    if (!searchText) {
      return;
    }

    const requestRevision = articleListSearchRevisionRef.current + 1;
    articleListSearchRevisionRef.current = requestRevision;
    articleListSearchQueryRef.current = searchText;
    const intentGeneration = advanceVisibleListIntent('pending');

    let resolveRequest!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const replacedPending = pendingSearchRequestRef.current;
    replacedPending?.resolve();
    pendingSearchRequestRef.current = {
      source,
      searchText,
      visibleCount: Math.max(SMART_VIEW_ARTICLE_LIMIT, visibleCount),
      searchRevision: requestRevision,
      intentGeneration,
      resolve: resolveRequest,
    };

    if (searchRunnerActiveRef.current) {
      cancelActiveSearch();
      await completion;
      return;
    }

    searchRunnerActiveRef.current = true;
    try {
      while (pendingSearchRequestRef.current) {
        const request = pendingSearchRequestRef.current;
        pendingSearchRequestRef.current = null;
        let searchEpoch: string | null = null;

        try {
          searchEpoch = await articleStore.beginSearch();
          activeSearchEpochRef.current = searchEpoch;
          if (
            !isFeedProviderMountedRef.current
            || request.intentGeneration !== visibleListIntentGenerationRef.current
            || request.searchRevision !== articleListSearchRevisionRef.current
            || request.searchText !== articleListSearchQueryRef.current
          ) {
            await articleStore.cancelSearch(searchEpoch);
            continue;
          }

          const result = await queryArticleListSource(
            request.source,
            request.visibleCount,
            request.searchText,
            { searchRequest: true, searchEpoch },
          );
          if (result.cancelled) {
            continue;
          }

          if (
            articleViewOverlayPhaseRef.current === 'opening'
            || articleViewOverlayPhaseRef.current === 'closing'
          ) {
            await new Promise<void>((resolve) => {
              searchOverlayWakeRef.current = resolve;
              if (
                articleViewOverlayPhaseRef.current !== 'opening'
                && articleViewOverlayPhaseRef.current !== 'closing'
              ) {
                wakeSearchOverlayWaiter();
              }
            });
          }

          const activeSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
            ?? activeSourceRef.current;
          if (
            !isFeedProviderMountedRef.current
            || request.intentGeneration !== visibleListIntentGenerationRef.current
            || request.searchRevision !== articleListSearchRevisionRef.current
            || request.searchText !== articleListSearchQueryRef.current
            || activeSource?.key !== request.source.key
          ) {
            continue;
          }

          dispatchArticlesTransitionIfChanged(result.articles, result.total, {
            sourceKey: request.source.key,
            filterKind: 'filtered',
            searchRevision: request.searchRevision,
            intentGeneration: request.intentGeneration,
            totalKnown: result.totalKnown,
            pageWasFull: result.pageWasFull,
            query: result.query,
          });
        } catch (error) {
          if (
            isFeedProviderMountedRef.current
            && request.intentGeneration === visibleListIntentGenerationRef.current
            && request.searchRevision === articleListSearchRevisionRef.current
            && request.searchText === articleListSearchQueryRef.current
          ) {
            setArticleListSearchStatus(request.intentGeneration, 'error');
            logger.warn('FeedContext', 'Article-list search failed', {
              sourceKey: request.source.key,
              tokenCount: request.searchText.split(/\s+/u).filter(Boolean).length,
              error,
            });
          }
        } finally {
          if (searchEpoch !== null && activeSearchEpochRef.current === searchEpoch) {
            activeSearchEpochRef.current = null;
          }
          request.resolve();
        }
      }
    } finally {
      searchRunnerActiveRef.current = false;
    }

    await completion;
  }, [
    advanceVisibleListIntent,
    cancelActiveSearch,
    dispatchArticlesTransitionIfChanged,
    queryArticleListSource,
    setArticleListSearchStatus,
    wakeSearchOverlayWaiter,
  ]);

  const requeueActiveSearchForSource = useCallback((
    source: RefreshSourceDescriptor,
  ): void => {
    const searchText = articleListSearchQueryRef.current;
    const activeSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
      ?? activeSourceRef.current;
    if (!searchText || activeSource?.key !== source.key) {
      return;
    }
    void enqueueSearchRequest(
      source,
      searchText,
      Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT),
    );
  }, [enqueueSearchRequest]);

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

    if (source.viewType === 'unread' || source.viewType === 'today') {
      return hasAnyNewArticles();
    }

    if (source.viewType === 'read') {
      return false;
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
    mode?: 'total-only' | 'full';
  }): Promise<void> => {
    const { token, sourceKey, tagQuery } = args;
    const mode = args.mode ?? (currentArticlesRef.current.length > 0 ? 'total-only' : 'full');
    if (!isSelectionActive(token)) {
      return;
    }

    if (
      articleListScrollActiveRef.current
      || loadMoreInFlightRef.current
      || articleListSearchActiveRef.current
      || isArticleViewTransitioning()
    ) {
      pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery, mode };
      return;
    }

    if (
      mode === 'total-only'
      && pendingColdSwitchSqliteTokenRef.current === token
      && currentArticlesRef.current.length === 0
    ) {
      pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery, mode };
      return;
    }

    pendingSwitchVisibleReconcileRef.current = null;

    if (mode === 'total-only' && currentArticlesRef.current.length > 0) {
      if (nonSearchSnapshotRef.current.totalKnown && articleListSearchQueryRef.current === null) {
        return;
      }
      const reloadEpoch = listReloadEpochRef.current;
      let freshTotal: number;
      try {
        ({ total: freshTotal } = await articleStore.query({
          ...tagQuery,
          limit: 1,
          includeTotal: true,
        }));
      } catch (error) {
        // Re-stash like the full path so the next idle flush retries the COUNT
        // instead of leaving the header total unknown with nothing pending.
        recordRobustnessEvent('feedContext.asyncPhaseFailed');
        logger.warn('FeedContext', 'Switch header COUNT reconcile failed', { sourceKey, token, error });
        if (isSelectionActive(token) && pendingSwitchVisibleReconcileRef.current === null) {
          pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery, mode };
        }
        return;
      }
      if (!isSelectionActive(token) || reloadEpoch !== listReloadEpochRef.current) {
        return;
      }

      // Station COUNT always belongs to the non-search snapshot. If the user
      // entered search while this query was in flight, do not stamp the
      // station total onto the filtered rows.
      if (nonSearchSnapshotRef.current.sourceKey === sourceKey) {
        nonSearchSnapshotRef.current = {
          ...nonSearchSnapshotRef.current,
          total: freshTotal,
          totalKnown: true,
        };
      }
      if (articleListSearchQueryRef.current === null && !articleListSearchActiveRef.current) {
        loadMorePagingSnapshotRef.current = {
          ...loadMorePagingSnapshotRef.current,
          articlesTotalCount: freshTotal,
          articlesTotalKnown: true,
        };
        collectionDispatch({
          type: 'SET_ARTICLES_TOTAL',
          payload: {
            total: freshTotal,
            intentGeneration: visibleListIntentGenerationRef.current,
          },
        });
      }
      return;
    }

    if (mode === 'full' && warmSnapshotReconcileInFlightRef.current === token) {
      return;
    }

    const visibleCount = Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT);
    const reloadEpoch = listReloadEpochRef.current;
    if (mode === 'full' && warmSnapshotReconcileTokenRef.current === token) {
      warmSnapshotReconcileInFlightRef.current = token;
    }
    let fresh: Article[];
    let freshTotal: number;
    try {
      const queried = await articleStore.query({
        ...tagQuery,
        limit: visibleCount,
        includeTotal: true,
      });
      fresh = queried.articles;
      freshTotal = queried.total;
    } catch {
      if (warmSnapshotReconcileInFlightRef.current === token) {
        warmSnapshotReconcileInFlightRef.current = null;
      }
      if (isSelectionActive(token)) {
        pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery, mode: 'full' };
      }
      releaseHeldWarmFullSchedulerResume(token);
      return;
    }
    if (!isSelectionActive(token) || reloadEpoch !== listReloadEpochRef.current) {
      if (warmSnapshotReconcileInFlightRef.current === token) {
        warmSnapshotReconcileInFlightRef.current = null;
      }
      if (isSelectionActive(token)) {
        pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery, mode: 'full' };
      }
      releaseHeldWarmFullSchedulerResume(token);
      return;
    }

    // Search does not bump listReloadEpoch. Freeze can also arm after the
    // query started. Re-stash full and skip SET_ARTICLES so search hits /
    // load-more tails are not replaced. A load-more that started *and*
    // finished during this COUNT leaves loadMoreInFlight false but a longer
    // list; dispatching the old visibleCount would shrink it and consume
    // the one-shot token.
    const listGrewDuringQuery = currentArticlesRef.current.length > visibleCount;
    if (
      articleListScrollActiveRef.current
      || loadMoreInFlightRef.current
      || articleListSearchActiveRef.current
      || articleListSearchQueryRef.current !== null
      || isArticleViewTransitioning()
      || listGrewDuringQuery
    ) {
      pendingSwitchVisibleReconcileRef.current = { token, sourceKey, tagQuery, mode: 'full' };
      if (warmSnapshotReconcileInFlightRef.current === token) {
        warmSnapshotReconcileInFlightRef.current = null;
      }
      releaseHeldWarmFullSchedulerResume(token);
      if (
        listGrewDuringQuery
        && !articleListScrollActiveRef.current
        && !loadMoreInFlightRef.current
        && !articleListSearchActiveRef.current
        && articleListSearchQueryRef.current === null
        && !isArticleViewTransitioning()
      ) {
        void reconcileSwitchVisiblePage({ token, sourceKey, tagQuery, mode: 'full' });
      }
      return;
    }

    dispatchArticlesTransitionIfChanged(fresh, freshTotal, {
      totalKnown: true,
      pageWasFull: fresh.length >= visibleCount,
      sourceKey,
      query: tagQuery,
    });
    if (warmSnapshotReconcileTokenRef.current === token) {
      warmSnapshotReconcileTokenRef.current = null;
      warmSnapshotReconcileInFlightRef.current = null;
    }
    releaseHeldWarmFullSchedulerResume(token);
  }, [
    dispatchArticlesTransitionIfChanged,
    isArticleViewTransitioning,
    isSelectionActive,
    releaseHeldWarmFullSchedulerResume,
    startTransition,
  ]);

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
      || isArticleViewTransitioning()
    ) {
      return;
    }

    void reconcileSwitchVisiblePage(pendingReconcile);
  }, [isArticleViewTransitioning, reconcileSwitchVisiblePage]);

  const applyBackgroundRefreshForSource = useCallback(async (source: RefreshSourceDescriptor): Promise<void> => {
    if (source.type === 'smart' && source.viewType === 'saved') {
      return;
    }
    if (articleListSearchQueryRef.current !== null) {
      pendingBackgroundRefreshSourceKeyRef.current = source.key;
      requeueActiveSearchForSource(source);
      return;
    }

    // Search, scroll, and article-view deck transitions freeze visible list
    // publishes so inserted rows do not fight filtered rows, virtualized scroll,
    // or the article-view open/close animation.
    if (
      articleListSearchActiveRef.current
      || articleListScrollActiveRef.current
      || loadMoreInFlightRef.current
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
    let nextSource: RefreshSourceDescriptor | null = source;

    try {
      while (nextSource) {
        if (isArticleViewTransitioning() || loadMoreInFlightRef.current) {
          pendingBackgroundRefreshSourceKeyRef.current = nextSource.key;
          return;
        }

        pendingBackgroundRefreshSourceKeyRef.current = null;

        const intentGeneration = visibleListIntentGenerationRef.current;
        const previousArticles = currentArticlesRef.current;
        const previousHashes = new Set(previousArticles.map((article) => article.hash));
        // Hidden window (kept running in the background): don't let the list
        // grow for days; see backgroundRefreshListCap.
        const capInput = {
          hidden: isDocumentHidden(),
          atTop: articleListAtTopRef.current,
          previousLength: previousArticles.length,
          pageSize: SMART_VIEW_ARTICLE_LIMIT,
        };
        const query = createArticleQueryForSource(nextSource, backgroundRefreshQueryCount(capInput));
        const { articles: freshArticles, total } = await articleStore.query(query);
        const activeSource = activeSourceRef.current;

        if (!activeSource || activeSource.key !== nextSource.key) {
          nextSource = null;
          continue;
        }

        if (
          intentGeneration !== visibleListIntentGenerationRef.current
          || articleListSearchActiveRef.current
          || articleListSearchQueryRef.current !== null
          || isArticleViewTransitioning()
          || loadMoreInFlightRef.current
        ) {
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

          const loadedNow = currentArticlesRef.current;
          const { list: publishedList, pageWasFull } = capBackgroundRefreshList(
            freshArticles,
            loadedNow,
            capInput,
          );
          currentArticlesRef.current = publishedList;
          loadMorePagingSnapshotRef.current = {
            length: publishedList.length,
            lastArticle: publishedList[publishedList.length - 1],
            articlesTotalCount: total,
            articlesTotalKnown: true,
            pageWasFull,
            isLoadingMoreArticles: false,
          };
          if (articleListSearchQueryRef.current === null) {
            nonSearchSnapshotRef.current = {
              sourceKey: nextSource.key,
              list: publishedList,
              total,
              totalKnown: true,
              pageWasFull,
              query,
            };
          }

          startTransition(() => {
            collectionDispatch({
              type: 'APPLY_BACKGROUND_REFRESH',
              payload: {
                list: publishedList,
                total,
                totalKnown: true,
                pageWasFull,
                newArticleHashes: new Set(newHashes),
                scrollRequest,
                intentGeneration,
              },
            });
          });
        } else if (
          !nonSearchSnapshotRef.current.totalKnown
          || nonSearchSnapshotRef.current.total !== total
        ) {
          if (articleListSearchQueryRef.current === null) {
            nonSearchSnapshotRef.current = {
              ...nonSearchSnapshotRef.current,
              sourceKey: nextSource.key,
              total,
              totalKnown: true,
            };
          }
          loadMorePagingSnapshotRef.current = {
            ...loadMorePagingSnapshotRef.current,
            articlesTotalCount: total,
            articlesTotalKnown: true,
          };
          startTransition(() => {
            collectionDispatch({
              type: 'SET_ARTICLES_TOTAL',
              payload: { total, intentGeneration },
            });
          });
        }

        const pendingSourceKey = pendingBackgroundRefreshSourceKeyRef.current;
        const latestSource = activeSourceRef.current;
        nextSource = pendingSourceKey !== null && latestSource?.key === pendingSourceKey
          ? latestSource
          : null;
      }
    } catch (error) {
      // Callers fire-and-forget. Keep the source pending so the next idle
      // trigger (scroll idle, overlay close, load-more settle) retries once;
      // those triggers are event-driven, so a persistent failure cannot spin.
      recordRobustnessEvent('feedContext.asyncPhaseFailed');
      logger.warn('FeedContext', 'Background list refresh failed', {
        sourceKey: nextSource?.key ?? source.key,
        error,
      });
      if (nextSource && activeSourceRef.current?.key === nextSource.key) {
        pendingBackgroundRefreshSourceKeyRef.current = nextSource.key;
      }
    } finally {
      backgroundRefreshInFlightRef.current = false;
    }
  }, [
    createArticleQueryForSource,
    createBackgroundScrollRequest,
    isArticleViewTransitioning,
    requeueActiveSearchForSource,
    startTransition,
  ]);

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
    const refreshOrderIds = sortStationSwitchRefreshIds(feedIds);

    for (const id of refreshOrderIds) {
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

  /**
   * Native Phase B strategy for station switches: stamp sidebar
   * `Syncing {station}` scope, then hand every station feed to the scheduler via
   * boostMany. No foreground network await — activeStationFocus front-loads
   * this station's feeds while the list stays interactive.
   */
  const runNativeSwitchStationRefresh = useCallback((feedIds: string[], token: number, tagName: string): {
    inserted: number;
    scopeGeneration: number;
  } => {
    if (!isSelectionActive(token)) {
      return { inserted: 0, scopeGeneration: 0 };
    }

    sidebarSwitchTrace.mark(token, 'station-network-refresh-started', {
      feedCount: feedIds.length,
      scheduledBackground: true,
    });
    feedRefreshActivity.beginQueuedFeeds([], 'foreground', {
      scopeTotal: feedIds.length,
      scopeKind: 'station',
      scopeLabel: tagName,
    });
    const scopeGeneration = feedRefreshActivity.getInteractiveRefreshScopeGeneration();
    interactiveRefreshScopeTokenRef.current = scopeGeneration;
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
    return { inserted: 0, scopeGeneration };
  }, [isSelectionActive]);

  /**
   * Phase B dispatcher for station sources. Native switches route to the
   * boostMany strategy; legacy switches cap six foreground feeds and defer the
   * tail; manual refreshes run every eligible feed in the foreground.
   */
  const refreshStationFeeds = useCallback(async (
    feedIds: string[],
    options: RefreshTriggerOptions,
    token: number,
    sourceKey: string,
    intent: SourceRefreshIntent = 'manual',
    tagName: string,
  ): Promise<{ inserted: number; scopeGeneration: number }> => {
    if (feedIds.length === 0) {
      return { inserted: 0, scopeGeneration: 0 };
    }

    // Import switches (awaitInitialFetch) must await the first fetch so the
    // skeleton clears onto fetched rows instead of racing a background cycle;
    // the native switch path only boosts and returns, which is what stranded
    // the post-import skeleton onto an empty view.
    if (intent === 'switch' && isNativeFeedIngestionEnabled() && options.awaitInitialFetch !== true) {
      return runNativeSwitchStationRefresh(feedIds, token, tagName);
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
        feedRefreshActivity.beginQueuedFeeds([], 'foreground', {
          scopeTotal: feedIds.length,
          scopeKind: 'station',
          scopeLabel: tagName,
        });
        const scopeGeneration = feedRefreshActivity.getInteractiveRefreshScopeGeneration();
        interactiveRefreshScopeTokenRef.current = scopeGeneration;
        feedRefreshActivity.markInteractiveRefreshDeferredTail(true, deferredFeedIds.length);
        feedScheduler.boostMany(deferredFeedIds);
        sidebarSwitchTrace.mark(token, 'station-refresh-deferred', {
          deferredFeedCount: deferredFeedIds.length,
        });
        return { inserted: 0, scopeGeneration };
      }
      return { inserted: 0, scopeGeneration: 0 };
    }

    if (!isSelectionActive(token)) {
      return { inserted: 0, scopeGeneration: 0 };
    }

    // Atomic: record the true switch scope (station feed count, NOT the
    // foreground cap) in the same publish as the foreground queue so the first
    // snapshot already carries the scope — no transient `Refreshing 6 feeds`
    // frame. The generation token lets the `finally` clear only this switch's
    // scope, so a stale switch cannot clobber a newer one during rapid hopping.
    const releaseQueuedFeed = feedRefreshActivity.beginQueuedFeeds(
      foregroundFeedIds,
      'foreground',
      {
        scopeTotal: feedIds.length,
        scopeKind: 'station',
        scopeLabel: tagName,
      },
    );
    const interactiveRefreshScopeToken = feedRefreshActivity.getInteractiveRefreshScopeGeneration();
    interactiveRefreshScopeTokenRef.current = interactiveRefreshScopeToken;
    const activeSignal = switchLifecycle.currentSignal;
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
          if (error instanceof NativeFeedRefreshFailure) {
            logNativeFeedRefreshFailure(feed.id, error.message);
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
              // Rust already persisted the failure; re-recording here read the
              // bumped row back and doubled the station feed's backoff.
              logNativeFeedRefreshFailure(feedResult.feedId, feedResult.error);
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

      return { inserted: insertedTotal, scopeGeneration: interactiveRefreshScopeToken };
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
    runNativeSwitchStationRefresh,
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
    if (articleListSearchQueryRef.current !== null) {
      currentArticlesRef.current = [];
      loadMorePagingSnapshotRef.current = {
        length: 0,
        lastArticle: undefined,
        articlesTotalCount: 0,
        articlesTotalKnown: false,
        pageWasFull: false,
        isLoadingMoreArticles: false,
      };
      collectionDispatch({ type: 'RESET_FOR_SOURCE_SWITCH' });
      return;
    }
    const restored = restoreSourceArticleSnapshot(sourceKey);
    if (!restored) {
      currentArticlesRef.current = [];
      loadMorePagingSnapshotRef.current = {
        length: 0,
        lastArticle: undefined,
        articlesTotalCount: 0,
        articlesTotalKnown: false,
        pageWasFull: false,
        isLoadingMoreArticles: false,
      };
      collectionDispatch({ type: 'RESET_FOR_SOURCE_SWITCH' });
    } else {
      dispatchArticlesTransitionIfChanged(restored.list, restored.total, {
        totalKnown: restored.totalKnown,
        pageWasFull: restored.pageWasFull,
        sourceKey,
        query: restored.query,
      });
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
    awaitInitialFetch?: boolean;
  }): Promise<boolean> => {
    const {
      token,
      sourceKey,
      query,
      taggedFeedCount,
      limit,
      interactionExtra,
      awaitInitialFetch,
    } = args;

    return await traceSidebarSwitchAsync(
      token,
      'sqlite-query-deferred',
      async () => {
        if (!isSelectionActive(token)) {
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
          // regresses skeleton-load switch freeze — keep total unknown until
          // a later COUNT-only reconcile.
          includeTotal: false,
        });
        if (!isSelectionActive(token)) {
          return false;
        }

        const resolvedPage = resolveDeferredPageTotal(stored.length, queryLimit);
        const resolvedTotal = resolvedPage.total;

        const dispatchStartedAt = performance.now();
        if (stored.length === 0 && awaitInitialFetch) {
          // Import switch: keep the cold-switch skeleton. Phase B awaits the
          // first fetch and clears loading when it settles — either after its
          // reconcile publishes rows, or onto the honest empty view here.
          importEmptyCommitTokenRef.current = token;
          if (deferNetworkSchedulerResumeTokenRef.current === token) {
            // Phase B already settled (it beat this page commit) without
            // publishing rows — nothing more is coming for this attempt.
            importEmptyCommitTokenRef.current = null;
            clearPendingColdSwitchSqlite(token);
            deferNetworkSchedulerResumeTokenRef.current = null;
            clearSwitchLoadingInTransition();
            completeSelectionSwitchNetworkPriority(token);
          }
          return true;
        }
        // Rows and skeleton clear must commit in one transition — an urgent
        // loading clear renders before the transition-lane SET_ARTICLES and
        // flashes an empty "0 articles" list on cold switches under load.
        const dispatchedRows = dispatchArticlesTransitionIfChanged(stored, resolvedTotal, {
          clearSwitchLoading: true,
          totalKnown: resolvedPage.totalKnown,
          pageWasFull: resolvedPage.pageWasFull,
          sourceKey,
          query,
        });
        if (!resolvedPage.totalKnown && resolvedPage.pageWasFull) {
          pendingSwitchVisibleReconcileRef.current = {
            token,
            sourceKey,
            tagQuery: query,
            mode: 'total-only',
          };
        }
        if (!dispatchedRows) {
          clearSwitchLoadingInTransition();
        }
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
    clearPendingColdSwitchSqlite,
    clearSwitchLoadingInTransition,
    completeSelectionSwitchNetworkPriority,
    dispatchArticlesTransitionIfChanged,
    isSelectionActive,
  ]);

  const scheduleDeferredSwitchSqliteRecovery = useCallback((args: {
    token: number;
    sourceKey: string;
    query: ArticleQuery;
    taggedFeedCount: number;
    limit?: number;
    interactionExtra?: Record<string, unknown>;
    awaitInitialFetch?: boolean;
  }) => {
    // Attempt-scoped: automatically cleared when a newer switch supersedes
    // this token, so a stale recovery can never fire into a fresh selection.
    switchLifecycle.setAttemptTimer('deferred-sqlite-recovery', DEFERRED_SWITCH_SQLITE_RECOVERY_DELAY_MS, () => {
      void (async () => {
        const { token, sourceKey } = args;

        if (!isSelectionActive(token)) {
          clearPendingColdSwitchSqlite(token);
          return;
        }

        if (currentArticlesRef.current.length > 0) {
          // Refs update eagerly on dispatch; the rows may still be pending in
          // the transition lane, so clear loading in the same lane.
          clearSwitchLoadingInTransition();
          finishColdSwitchSqliteAndResumeIfNeeded(token);
          return;
        }

        try {
          const dispatched = await commitDeferredSwitchSqlitePage(args);
          if (!dispatched && isSelectionActive(token)) {
            clearSwitchLoadingInTransition();
          }
        } catch (error) {
          logger.warn('FeedContext', 'Deferred switch SQLite recovery failed', { error, sourceKey, token });
          if (isSelectionActive(token)) {
            clearSwitchLoadingInTransition();
          }
        } finally {
          if (importEmptyCommitTokenRef.current !== token) {
            finishColdSwitchSqliteAndResumeIfNeeded(token);
          }
          flushPendingSwitchVisibleReconcileIfIdle();
        }
      })();
    });
  }, [
    clearPendingColdSwitchSqlite,
    clearSwitchLoadingInTransition,
    commitDeferredSwitchSqlitePage,
    finishColdSwitchSqliteAndResumeIfNeeded,
    flushPendingSwitchVisibleReconcileIfIdle,
    isSelectionActive,
    switchLifecycle,
  ]);

  const scheduleDeferredSwitchSqlitePage = useCallback((args: {
    token: number;
    sourceKey: string;
    query: ArticleQuery;
    taggedFeedCount: number;
    limit?: number;
    interactionExtra?: Record<string, unknown>;
    awaitInitialFetch?: boolean;
  }) => {
    const { token, sourceKey } = args;
    pendingColdSwitchSqliteTokenRef.current = token;
    let paintGateCancelled = false;
    const unregisterPaintGateCancel = switchLifecycle.onSupersede(() => {
      paintGateCancelled = true;
    });

    void (async () => {
      let dispatched = false;
      let painted = false;

      try {
        painted = await waitForArticleListPaintGate(isSelectionActive, token, {
          isCancelled: () => paintGateCancelled,
        });
        if (!painted || !isSelectionActive(token)) {
          return;
        }

        dispatched = await commitDeferredSwitchSqlitePage(args);
      } catch (error) {
        logger.warn('FeedContext', 'Deferred switch SQLite page failed', { error, sourceKey, token });
      } finally {
        unregisterPaintGateCancel();

        if (!isSelectionActive(token)) {
          clearPendingColdSwitchSqlite(token);
          return;
        }

        if (
          !dispatched
          && currentArticlesRef.current.length === 0
        ) {
          // Only recover when the paint gate succeeded but the page commit
          // failed. A cancelled gate must not start recovery — that races a
          // newer selection and can clear the skeleton onto an empty list.
          if (painted) {
            scheduleDeferredSwitchSqliteRecovery(args);
            return;
          }
          clearPendingColdSwitchSqlite(token);
          return;
        }

        if (importEmptyCommitTokenRef.current !== token) {
          finishColdSwitchSqliteAndResumeIfNeeded(token);
        }
        flushPendingSwitchVisibleReconcileIfIdle();
      }
    })();
  }, [
    clearPendingColdSwitchSqlite,
    commitDeferredSwitchSqlitePage,
    finishColdSwitchSqliteAndResumeIfNeeded,
    flushPendingSwitchVisibleReconcileIfIdle,
    isSelectionActive,
    scheduleDeferredSwitchSqliteRecovery,
    switchLifecycle,
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
    if (!activeSource) {
      return;
    }

    if (articleListScrollActiveRef.current) {
      return;
    }

    flushPendingSwitchVisibleReconcileIfIdle();

    if (pendingBackgroundRefreshSourceKeyRef.current === activeSource.key) {
      void applyBackgroundRefreshForSource(activeSource);
    }
  }, [applyBackgroundRefreshForSource, flushPendingSwitchVisibleReconcileIfIdle, reconcileSwitchVisiblePage]);

  useDependencyEffect(() => {
    const pending = pendingLoadMoreCommitMetricRef.current;
    if (!pending) {
      return;
    }

    if (pending.token !== switchLifecycle.currentToken || pending.searchText !== articleListSearchQueryRef.current) {
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
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery: feedQuery,
          mode: warmSnapshotReconcileTokenRef.current === token ? 'full' : 'total-only',
        };
        flushPendingSwitchVisibleReconcileIfIdle();
        return;
      }

      const releaseQueuedFeed = feedRefreshActivity.beginQueuedFeeds([feedId], 'foreground', {
        scopeKind: 'feed',
        scopeLabel: feedMeta.title,
      });
      const activeSignal = switchLifecycle.currentSignal;
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
        if (error instanceof NativeFeedRefreshFailure) {
          logNativeFeedRefreshFailure(feedMeta.id, error.message);
        } else {
          await recordFeedRefreshFailure(feedMeta, error);
        }
        throw error;
      } finally {
        releaseQueuedFeed();
      }
      if (!isSelectionActive(token)) {
        return;
      }

      // Cold deferred Phase A owns the first DB page. Skip a competing query
      // when the network refresh inserted nothing (common on switch cooldown /
      // native boostMany handoff).
      const coldDeferredOwnsFirstPage =
        pendingColdSwitchSqliteTokenRef.current === token
        && currentArticlesRef.current.length === 0;
      if (coldDeferredOwnsFirstPage && insertedCount === 0) {
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery: feedQuery,
          mode: 'total-only',
        };
      } else if (currentArticlesRef.current.length > 0) {
        await reconcileSwitchVisiblePage({
          token,
          sourceKey,
          tagQuery: feedQuery,
          mode: warmSnapshotReconcileTokenRef.current === token ? 'full' : 'total-only',
        });
      } else {
        const { articles: fresh, total: freshTotal } = await articleStore.query(feedQuery);
        if (!isSelectionActive(token)) {
          return;
        }
        dispatchArticlesTransitionIfChanged(fresh, freshTotal, {
          totalKnown: true,
          pageWasFull: fresh.length >= SMART_VIEW_ARTICLE_LIMIT,
          sourceKey,
          query: feedQuery,
        });
        interactionPerformance.markTimedInteractionStage('sidebar-switch', `feed:${feedId}`, 'freshReady', {
          freshArticleCount: fresh.length,
          freshArticleTotal: freshTotal,
        });
      }

      if (perfMark && HAS_PERFORMANCE_API) {
        performance.mark(`${perfMark}:fresh-ready`);
        measureSelection(`${perfMark}:total-selection`, `${perfMark}:start`, `${perfMark}:fresh-ready`);
      }

      requeueActiveSearchForSource({ type: 'feed', key: sourceKey, feedId });
      sourceSelectionBus.publishRefreshSettled(token, sourceKey, insertedCount);

      void maybeRefreshFavicon(feedId, feedMeta.url, () => {
        notifyFeedLibraryChanged();
      });
    } catch {
      clearError();
    } finally {
      // Cold deferred SQLite may still own the skeleton; this helper either
      // clears+resumes or defers resume until Phase A finishes.
      completeNetworkPhaseSwitchLoading(token);
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
    completeNetworkPhaseSwitchLoading,
    dispatchArticlesTransitionIfChanged,
    flushPendingSwitchVisibleReconcileIfIdle,
    isSelectionActive,
    notifyFeedLibraryChanged,
    requeueActiveSearchForSource,
    reconcileSwitchVisiblePage,
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
    let scopeGeneration = 0;
    try {
      sidebarSwitchTrace.mark(token, 'phase-b-started', { kind: 'tag' });
      const stationRefresh = await refreshStationFeeds(
        feedIds,
        { ...refreshOptions, bypassBackoff: shouldReset || refreshOptions.bypassBackoff },
        token,
        sourceKey,
        intent,
        tagName,
      );
      insertedCount = stationRefresh.inserted;
      scopeGeneration = stationRefresh.scopeGeneration;
      // Suppress is scoped to the foreground feeds actually refreshed, inside
      // refreshStationFeeds, so deferred feeds stay eligible for the next
      // background cycle to surface new articles.

      if (!isSelectionActive(token)) {
        return;
      }

      let freshArticleCount = currentArticlesRef.current.length;
      let freshArticleTotal = nonSearchSnapshotRef.current.total;
      // Cold Phase A owns the first DB page. A concurrent reconcile here used
      // includeTotal:true (COUNT DISTINCT) and raced the deferred page query —
      // 2026-07-14 Tech switch: sqlite-query-deferred 6071ms while Phase B
      // waited on the same reader pool (H17). When this phase inserted rows
      // (awaited import fetch) the reconcile must run: it publishes the first
      // fetched rows and Phase B's finally clears the skeleton.
      const coldDeferredOwnsFirstPage =
        pendingColdSwitchSqliteTokenRef.current === token
        && insertedCount === 0;
      if (coldDeferredOwnsFirstPage && importEmptyCommitTokenRef.current === token) {
        // Import switch whose awaited first fetch inserted nothing: a
        // concurrent background cycle can win the insert dedup race (its
        // commits are already in SQLite while this phase reports 0), and the
        // deferred import tail keeps inserting after this phase settles.
        // Reconcile once so the honest empty view only shows when SQLite
        // truly has no rows for this source.
        if (isArticleViewTransitioning()) {
          pendingBackgroundRefreshSourceKeyRef.current = sourceKey;
        } else {
          await reconcileSwitchVisiblePage({
            token,
            sourceKey,
            tagQuery,
            mode: 'full',
          });
          freshArticleCount = currentArticlesRef.current.length;
          freshArticleTotal = nonSearchSnapshotRef.current.total;
        }
      } else if (coldDeferredOwnsFirstPage) {
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery,
          mode: 'total-only',
        };
      } else if (isArticleViewTransitioning()) {
        pendingBackgroundRefreshSourceKeyRef.current = sourceKey;
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery,
          mode: warmSnapshotReconcileTokenRef.current === token ? 'full' : 'total-only',
        };
      } else {
        await reconcileSwitchVisiblePage({
          token,
          sourceKey,
          tagQuery,
          mode: warmSnapshotReconcileTokenRef.current === token
            ? 'full'
            : (currentArticlesRef.current.length > 0 ? 'total-only' : 'full'),
        });
        freshArticleCount = currentArticlesRef.current.length;
        freshArticleTotal = nonSearchSnapshotRef.current.total;
      }

      interactionPerformance.markTimedInteractionStage('sidebar-switch', `tag:${tagName}`, 'freshReady', {
        freshArticleCount,
        freshArticleTotal,
        taggedFeedCount: feedIds.length,
      });

      if (perfMark && HAS_PERFORMANCE_API) {
        performance.mark(`${perfMark}:fresh-ready`);
        measureSelection(`${perfMark}:total-selection`, `${perfMark}:start`, `${perfMark}:fresh-ready`);
      }

      if (!isSelectionActive(token)) {
        return;
      }

      requeueActiveSearchForSource({ type: 'tag', key: sourceKey, tagName });
      sourceSelectionBus.publishRefreshSettled(token, sourceKey, insertedCount);
      opmlWorkflowService.scheduleMissingFaviconsAfterStationSelection(feedIds);
    } catch (error) {
      // Phase B is fire-and-forget; a count-sync / reconcile IPC failure must
      // not surface as an unhandled rejection. Loading cleanup stays in finally.
      if (!(error instanceof Error && error.name === 'AbortError')) {
        recordRobustnessEvent('feedContext.asyncPhaseFailed');
        logger.warn('FeedContext', 'Station network refresh phase failed', { sourceKey, token, error });
      }
    } finally {
      // Cold deferred SQLite may still own the skeleton; this helper either
      // clears+resumes or defers resume until Phase A finishes.
      completeNetworkPhaseSwitchLoading(token);
      if (scopeGeneration !== 0) {
        feedRefreshActivity.clearInteractiveRefreshScope(scopeGeneration);
      }
      sidebarSwitchTrace.completeNetwork(token, {
        kind: 'tag',
        insertedCount: insertedCount ?? 0,
      });
    }
  }, [
    completeNetworkPhaseSwitchLoading,
    dispatchArticlesTransitionIfChanged,
    isArticleViewTransitioning,
    isSelectionActive,
    requeueActiveSearchForSource,
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

  /**
   * Unified Phase A pipeline for feed and station (tag) switches:
   * immediate-paint bookkeeping, snapshot restore, coalesce yield, deferred
   * cold SQLite page, then Phase B scheduling through the paint gate. Source
   * differences (query shape, feed-id resolution, article close semantics)
   * come in through the spec.
   */
  const runListSourceSwitch = useCallback(async (spec: ListSourceSwitchSpec) => {
    const { token, shouldReset, sourceKey, perfMark, query } = spec;
    let restoredSnapshot: SourceArticleListSnapshot | null = null;

    if (HAS_PERFORMANCE_API) {
      performance.mark(`${perfMark}:start`);
    }

    if (shouldReset) {
      const immediatePaintApplied = switchLifecycle.isImmediatePaintApplied(token);
      restoredSnapshot = articleListSearchQueryRef.current === null
        ? restoreSourceArticleSnapshot(sourceKey)
        : null;
      if (restoredSnapshot) {
        warmSnapshotReconcileTokenRef.current = token;
        sidebarSwitchTrace.mark(token, 'snapshot-restored', {
          cachedArticleCount: restoredSnapshot.list.length,
          cachedArticleTotal: restoredSnapshot.total,
        });
      } else if (!immediatePaintApplied) {
        collectionDispatch({ type: 'RESET_FOR_SOURCE_SWITCH' });
      }
      spec.closeArticleForSwitch();
      sidebarSwitchTrace.mark(token, spec.closeTraceMark);

      if (!immediatePaintApplied) {
        // Yield one macrotask so a burst of sidebar clicks can supersede this
        // attempt before it queues IPC + article mapping work.
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
    }

    try {
      lastQueryRef.current = query;
      lastQuerySourceKeyRef.current = sourceKey;
      const isColdSwitch = shouldReset && restoredSnapshot === null;

      if (restoredSnapshot && warmSnapshotReconcileTokenRef.current === token) {
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery: restoredSnapshot.query ?? query,
          mode: 'full',
        };
        flushPendingSwitchVisibleReconcileIfIdle();
      }

      if (warmFullSuccessorSourceKeyRef.current !== null
        && warmFullSuccessorSourceKeyRef.current !== sourceKey) {
        warmFullSuccessorSourceKeyRef.current = null;
      }

      // Same-source Cmd+R that cancelled a pending/in-flight warm full must
      // re-arm full even when the header total is already known. Other
      // same-source refreshes stay total-only.
      if (!shouldReset && warmFullSuccessorSourceKeyRef.current === sourceKey) {
        warmSnapshotReconcileTokenRef.current = token;
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery: query,
          mode: 'full',
        };
        flushPendingSwitchVisibleReconcileIfIdle();
        warmFullSuccessorSourceKeyRef.current = null;
      } else if (!shouldReset && !nonSearchSnapshotRef.current.totalKnown) {
        // Same-source Cmd+R / manual refresh: beginSelectionRequest cleared any
        // in-flight COUNT. Re-queue before awaiting network so a failed Phase B
        // cannot leave the header unknown with no COUNT pending.
        pendingSwitchVisibleReconcileRef.current = {
          token,
          sourceKey,
          tagQuery: query,
          mode: 'total-only',
        };
        flushPendingSwitchVisibleReconcileIfIdle();
      }

      if (isColdSwitch) {
        // Phase A (local): publish the stored page only after the skeleton
        // paint gate so row mapping never competes with the switch frame.
        sidebarSwitchTrace.mark(token, 'cold-station-deferred-sqlite', spec.deferredInteractionExtra);
        sidebarSwitchTrace.mark(token, 'articles-published', {
          deferredSqlite: true,
          articleCount: 0,
        });
        scheduleDeferredSwitchSqlitePage({
          token,
          sourceKey,
          query,
          taggedFeedCount: spec.deferredTaggedFeedCount,
          limit: spec.deferredSqliteLimit,
          interactionExtra: spec.deferredInteractionExtra,
          awaitInitialFetch: spec.awaitInitialFetch,
        });
      }

      const resolution = await spec.resolveRefreshPayload({
        intent: shouldReset ? 'switch' : 'manual',
        isColdSwitch,
      });
      if (!resolution || !isSelectionActive(token)) {
        return;
      }

      if (!shouldReset) {
        // Manual refresh of the already-selected source: run Phase B directly
        // without the paint gate (nothing was repainted).
        if (resolution.payload.kind === 'feed') {
          void runFeedNetworkRefreshPhase(resolution.payload);
        } else {
          void runTagNetworkRefreshPhase(resolution.payload);
        }
        return;
      }

      if (restoredSnapshot) {
        interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'snapshotReady', {
          cachedArticleCount: restoredSnapshot.list.length,
          cachedArticleTotal: restoredSnapshot.total,
          taggedFeedCount: resolution.taggedFeedCount,
        });
        interactionPerformance.markTimedInteractionStage('sidebar-switch', sourceKey, 'cachedReady', {
          cachedArticleCount: restoredSnapshot.list.length,
          cachedArticleTotal: restoredSnapshot.total,
          taggedFeedCount: resolution.taggedFeedCount,
          fromSnapshot: true,
        });
        sidebarSwitchTrace.mark(token, 'articles-published', {
          fromSnapshot: true,
          articleCount: restoredSnapshot.list.length,
        });

        if (HAS_PERFORMANCE_API) {
          performance.mark(`${perfMark}:cached-ready`);
          measureSelection(`${perfMark}:to-cached`, `${perfMark}:start`, `${perfMark}:cached-ready`);
        }
      }

      requestSwitchNetworkRefresh(resolution.payload);
    } catch {
      clearError();
      abortSelectionSwitchPriority(token);
    }
  }, [
    abortSelectionSwitchPriority,
    clearError,
    isSelectionActive,
    requestSwitchNetworkRefresh,
    restoreSourceArticleSnapshot,
    runFeedNetworkRefreshPhase,
    runTagNetworkRefreshPhase,
    scheduleDeferredSwitchSqlitePage,
    flushPendingSwitchVisibleReconcileIfIdle,
    switchLifecycle,
  ]);

  const handleFeedSelection = useCallback(async (
    feedId: string,
    shouldReset: boolean,
    token: number,
    options: RefreshTriggerOptions = {},
  ) => {
    const sourceKey = `feed:${feedId}`;
    const perfMark = `select-feed:${feedId}:${token}`;
    const feedQuery = createArticleListQuery({ feedIds: [feedId] });

    await runListSourceSwitch({
      token,
      shouldReset,
      sourceKey,
      perfMark,
      query: feedQuery,
      deferredTaggedFeedCount: 1,
      deferredInteractionExtra: { feedId },
      awaitInitialFetch: options.awaitInitialFetch === true,
      closeArticleForSwitch: () => setActiveArticle(null),
      closeTraceMark: 'source-reset',
      resolveRefreshPayload: async ({ intent }) => ({
        payload: {
          kind: 'feed',
          token,
          sourceKey,
          intent,
          refreshOptions: options,
          feedId,
          feedQuery,
          perfMark,
        },
        taggedFeedCount: 1,
      }),
    });
  }, [runListSourceSwitch, setActiveArticle]);

  const handleTagSelection = useCallback(async (
    tagName: string,
    shouldReset: boolean,
    token: number,
    options: RefreshTriggerOptions = {},
  ) => {
    const sourceKey = `tag:${tagName}`;
    const perfMark = `select-tag:${tagName}:${token}`;
    const tagQuery = createTagArticleListQuery(tagName);

    await runListSourceSwitch({
      token,
      shouldReset,
      sourceKey,
      perfMark,
      query: tagQuery,
      deferredTaggedFeedCount: 0,
      deferredSqliteLimit: SMART_VIEW_ARTICLE_LIMIT,
      deferredInteractionExtra: { tagName },
      awaitInitialFetch: options.awaitInitialFetch === true,
      closeArticleForSwitch: closeActiveArticleForSourceSwitch,
      closeTraceMark: 'article-close-requested',
      resolveRefreshPayload: async ({ intent, isColdSwitch }) => {
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
        if (!isSelectionActive(token)) {
          return null;
        }
        feedScheduler.setActiveStationFocus(sourceKey, feedIds);

        if (isColdSwitch && feedIds.length >= LARGE_STATION_FEED_THRESHOLD) {
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

        return {
          payload: {
            kind: 'tag',
            token,
            sourceKey,
            intent,
            refreshOptions: options,
            tagName,
            feedIds,
            tagQuery,
            shouldReset,
            perfMark,
          },
          taggedFeedCount: feedIds.length,
        };
      },
    });
  }, [closeActiveArticleForSourceSwitch, isSelectionActive, runListSourceSwitch]);

  const handleSmartViewSelection = useCallback(async (type: SmartViewType, shouldReset: boolean, token: number) => {
    // Saved keeps its own reset (separate service + isSavedListLoading flag);
    // other smart views share the immediate switch paint from selectSmartView.
    const immediatePaintApplied = shouldReset && switchLifecycle.isImmediatePaintApplied(token);
    if (shouldReset) {
      if (!immediatePaintApplied) {
        currentArticlesRef.current = [];
        loadMorePagingSnapshotRef.current = {
          length: 0,
          lastArticle: undefined,
          articlesTotalCount: 0,
          articlesTotalKnown: false,
          pageWasFull: false,
          isLoadingMoreArticles: false,
        };
        collectionDispatch({ type: 'RESET_ARTICLES' });
        collectionDispatch({
          type: 'SET_LOADING',
          payload: { isLoadingArticles: false, isSavedListLoading: false, },
        });
        lastQueryRef.current = null;
        lastQuerySourceKeyRef.current = null;
      }
      setActiveArticle(null);
    }

    if (shouldReset && !immediatePaintApplied && !await yieldToSelectionCoalescing(token)) return;

    if (type === 'saved') {
      lastQueryRef.current = null;
      lastQuerySourceKeyRef.current = null;
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: false, isSavedListLoading: true, },
      });

      try {
        const { articles: saved, total } = await savedArticlesService.querySavedViewArticles(SMART_VIEW_ARTICLE_LIMIT);
        if (!isSelectionActive(token)) return;

        dispatchArticlesTransitionIfChanged(saved, total, {
          sourceKey: `smart:${type}`,
          query: null,
        });
        interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'cachedReady', {
          cachedArticleCount: saved.length,
          cachedArticleTotal: total,
        });

        const enriched = await savedArticlesService.enrichSavedViewArticlesMeta(saved);
        if (isSelectionActive(token)) {
          dispatchArticlesTransitionIfChanged(enriched, total, {
            sourceKey: `smart:${type}`,
            query: null,
          });
          interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'enrichedReady', {
            enrichedArticleCount: enriched.length,
            enrichedArticleTotal: total,
          });
        }
      } catch (error) {
        recordRobustnessEvent('feedContext.asyncPhaseFailed');
        logger.warn('FeedContext', 'Smart view query failed', { viewType: type, token, error });
      } finally {
        if (isSelectionActive(token)) {
          collectionDispatch({ type: 'SET_LOADING', payload: { isSavedListLoading: false, } });
        }
      }
      return;
    }

    if (!immediatePaintApplied) {
      // Immediate paint already chose skeleton vs snapshot; do not flip the
      // loading flag back on over a restored list.
      collectionDispatch({
        type: 'SET_LOADING',
        payload: { isLoadingArticles: true, isSavedListLoading: false, },
      });
    }

    try {
      const query = type === 'unread'
        ? createArticleListQuery({ filter: { read: false } })
        : type === 'read'
          ? createArticleListQuery({ filter: { read: true } }, READ_ARTICLE_LIST_SORT)
          : type === 'pinned'
            ? createArticleListQuery({ tagName: 'pinned' })
            : type === 'today'
              ? createArticleListQuery({ today: true })
              : createArticleListQuery({});
      lastQueryRef.current = query;
      lastQuerySourceKeyRef.current = `smart:${type}`;

      const { articles: list, total } = await articleStore.query(query);
      if (!isSelectionActive(token)) return;
      dispatchArticlesTransitionIfChanged(list, total, {
        sourceKey: `smart:${type}`,
        query,
      });
      interactionPerformance.markTimedInteractionStage('sidebar-switch', `smart:${type}`, 'cachedReady', {
        cachedArticleCount: list.length,
        cachedArticleTotal: total,
      });
    } catch (error) {
      recordRobustnessEvent('feedContext.asyncPhaseFailed');
      logger.warn('FeedContext', 'Smart view query failed', { viewType: type, token, error });
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
    if (!options.restore) {
      abortPendingSidebarRestore();
    }
    feedScheduler.clearActiveStationFocus();
    const isSameFeed = feedId === prevNavRef.current.id && feedId !== null;
    if (!isSameFeed) {
      advanceVisibleListIntent(articleListSearchQueryRef.current === null ? 'idle' : 'pending');
      settlePendingSearchRequest();
      cancelActiveSearch();
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

    const token = beginSelectionRequest({
      acknowledge: options.acknowledgeSidebar !== false && !options.restore,
    });
    if (!isSameFeed) {
      applyImmediateSelectionSwitchPaint(`feed:${feedId}`);
      switchLifecycle.markImmediatePaintApplied(token);
    }
    sidebarSwitchTrace.begin(token, `feed:${feedId}`, 'feed', {
      sourceId: feedId,
      sourceLabel: title,
      isSameSource: isSameFeed,
    });
    void handleFeedSelection(feedId, !isSameFeed, token, options);
  }, [advanceVisibleListIntent, applyImmediateSelectionSwitchPaint, beginSelectionRequest, cancelActiveSearch, clearArticleListScrollIdleState, handleFeedSelection, settlePendingSearchRequest]);

  const selectTag = useCallback(async (
    tagName: string,
    options: RefreshTriggerOptions = {},
    feedIdsHint?: string[],
  ) => {
    if (!options.restore) {
      abortPendingSidebarRestore();
    }
    if (feedIdsHint !== undefined) {
      seedTagFeedIdsCache([[tagName, feedIdsHint]]);
    }
    const isSameTag = tagName === prevNavRef.current.tag && tagName !== null;
    if (!isSameTag) {
      advanceVisibleListIntent(articleListSearchQueryRef.current === null ? 'idle' : 'pending');
      settlePendingSearchRequest();
      cancelActiveSearch();
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

    const token = beginSelectionRequest({
      acknowledge: options.acknowledgeSidebar !== false && !options.restore,
    });
    if (!isSameTag) {
      applyImmediateSelectionSwitchPaint(`tag:${tagName}`);
      switchLifecycle.markImmediatePaintApplied(token);
    }
    sidebarSwitchTrace.begin(token, `tag:${tagName}`, 'tag', {
      sourceId: tagName,
      sourceLabel: tagName,
      isSameSource: isSameTag,
    });
    void handleTagSelection(tagName, !isSameTag, token, options);
  }, [advanceVisibleListIntent, applyImmediateSelectionSwitchPaint, beginSelectionRequest, cancelActiveSearch, clearArticleListScrollIdleState, handleTagSelection, settlePendingSearchRequest]);

  const selectSmartView = useCallback(async (
    viewType: SmartViewType,
    options: RefreshTriggerOptions = {},
  ) => {
    if (!options.restore) {
      abortPendingSidebarRestore();
    }
    feedScheduler.clearActiveStationFocus();
    const isSameSmart = viewType === prevNavRef.current.smart && viewType !== null;
    if (!isSameSmart) {
      advanceVisibleListIntent(articleListSearchQueryRef.current === null ? 'idle' : 'pending');
      settlePendingSearchRequest();
      cancelActiveSearch();
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
        sourceLabel: smartViewSourceLabel(viewType),
      }, { exclusiveByKind: true });
    }

    const token = beginSelectionRequest({
      acknowledge: options.acknowledgeSidebar !== false && !options.restore,
    });
    if (!isSameSmart && viewType !== 'saved') {
      // Saved paints synchronously through its own reset in the handler; the
      // other smart views reuse the snapshot-or-skeleton immediate paint.
      applyImmediateSelectionSwitchPaint(`smart:${viewType}`);
      switchLifecycle.markImmediatePaintApplied(token);
    }
    void handleSmartViewSelection(viewType, !isSameSmart, token);
  }, [advanceVisibleListIntent, applyImmediateSelectionSwitchPaint, beginSelectionRequest, cancelActiveSearch, clearArticleListScrollIdleState, handleSmartViewSelection, settlePendingSearchRequest]);

  const clearFeedSelection = useCallback(() => {
    abortPendingSidebarRestore();
    feedScheduler.clearActiveStationFocus();
    abortSelectionSwitchPriority();
    clearArticleListScrollIdleState();
    switchLifecycle.invalidate();
    articleListSearchQueryRef.current = null;
    articleListSearchRevisionRef.current += 1;
    advanceVisibleListIntent('idle');
    settlePendingSearchRequest();
    cancelActiveSearch();
    prevNavRef.current = { id: null, tag: null, smart: null };
    currentArticlesRef.current = [];
    nonSearchSnapshotRef.current = {
      sourceKey: null,
      list: [],
      total: 0,
      totalKnown: false,
      pageWasFull: false,
      query: null,
    };
    loadMorePagingSnapshotRef.current = {
      length: 0,
      lastArticle: undefined,
      articlesTotalCount: 0,
      articlesTotalKnown: false,
      pageWasFull: false,
      isLoadingMoreArticles: false,
    };
    navigationDispatch({ type: 'CLEAR_SELECTION' });
    collectionDispatch({ type: 'RESET_ARTICLES' });
    collectionDispatch({ type: 'SET_LOADING', payload: { isLoadingArticles: false, isSavedListLoading: false, } });
  }, [abortSelectionSwitchPriority, advanceVisibleListIntent, cancelActiveSearch, clearArticleListScrollIdleState, settlePendingSearchRequest]);

  useMountEffect(() => {
    return sourceSelectionBus.subscribe((event) => {
      if (event.type === 'source-refresh-aborted') {
        abortSelectionSwitchPriority(event.payload.token);
      }
    });
  });

  useMountEffect(() => {
    const attempt = beginSidebarRestoreAttempt();

    void (async () => {
      try {
        const raw = await storage.get(LAST_SIDEBAR_SELECTION_KEY);
        if (!isCurrentSidebarRestoreAttempt(attempt) || !raw) {
          return;
        }

        const parsed = JSON.parse(raw) as SidebarSelectionSnapshot;
        const restoreOptions: RefreshTriggerOptions = {
          restore: true,
          acknowledgeSidebar: false,
        };

        if (parsed.type === 'smart') {
          if (parsed.viewType === 'pinned' || isLibrarySmartViewId(parsed.viewType)) {
            await selectSmartView(parsed.viewType, restoreOptions);
          }
          return;
        }

        if (parsed.type === 'feed') {
          const feeds = await getAllFeedMetadataCached();
          if (!isCurrentSidebarRestoreAttempt(attempt)) {
            return;
          }
          const feed = feeds.find((entry) => entry.id === parsed.feedId);
          if (!feed) {
            await storage.remove(LAST_SIDEBAR_SELECTION_KEY);
            return;
          }
          await selectFeed(feed.id, feed.url, feed.title, restoreOptions);
          return;
        }

        if (parsed.type === 'tag') {
          const tags = await tagsManager.getAllTags();
          if (!isCurrentSidebarRestoreAttempt(attempt)) {
            return;
          }
          const tag = tags.find((entry) => entry.name === parsed.tagName);
          if (!tag) {
            await storage.remove(LAST_SIDEBAR_SELECTION_KEY);
            return;
          }
          await selectTag(parsed.tagName, restoreOptions, tag.feedIds);
        }
      } catch (error) {
        logger.warn('FeedContext', 'Failed to restore last sidebar selection', { error });
      }
    })();
  });

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
          requeueActiveSearchForSource(nextSource);
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
  }, [
    beginSelectionRequest,
    handleFeedSelection,
    handleSmartViewSelection,
    handleTagSelection,
    navigationState,
    requeueActiveSearchForSource,
  ]);

  const reloadCurrentSourceFromStore = useCallback(async () => {
    // Article-clear completion: drop cached pages that still contain deleted rows,
    // and freeze render-time remember until a matched post-delete write.
    sourceArticleSnapshotCacheRef.current.clear();
    lastQuerySourceKeyRef.current = null;
    listReloadEpochRef.current += 1;

    const writeUnfilteredNonSearch = (
      source: RefreshSourceDescriptor,
      list: Article[],
      total: number,
      query: ArticleQuery | null,
      visibleCount: number,
    ): void => {
      nonSearchSnapshotRef.current = {
        sourceKey: source.key,
        list,
        total,
        totalKnown: true,
        pageWasFull: list.length >= visibleCount,
        query,
      };
      lastQueryRef.current = query;
      lastQuerySourceKeyRef.current = source.key;
      rememberSourceArticleSnapshot(
        source.key,
        list,
        total,
        query,
        true,
        list.length >= visibleCount,
      );
    };

    for (let attempt = 0; attempt < POST_CLEAR_SOURCE_RELOAD_MAX_ATTEMPTS; attempt += 1) {
      const source = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current);
      if (!source) {
        currentArticlesRef.current = [];
        loadMorePagingSnapshotRef.current = {
          length: 0,
          lastArticle: undefined,
          articlesTotalCount: 0,
          articlesTotalKnown: false,
          pageWasFull: false,
          isLoadingMoreArticles: false,
        };
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
        logger.info('FeedContext', 'Post-clear source reload skipped', {
          reason: 'no-source',
          attempt,
        });
        return;
      }

      const token = switchLifecycle.currentToken;
      const visibleCount = Math.max(
        nonSearchSnapshotRef.current.sourceKey === source.key
          ? nonSearchSnapshotRef.current.list.length
          : 0,
        currentArticlesRef.current.length,
        SMART_VIEW_ARTICLE_LIMIT,
      );
      const { articles: list, total, query } = await queryArticleListSource(
        source,
        visibleCount,
      );

      const liveSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current);
      const tokenChanged = token !== switchLifecycle.currentToken;
      const sourceChanged = liveSource?.key !== source.key;

      if (tokenChanged || sourceChanged) {
        logger.info('FeedContext', 'Post-clear source reload retry', {
          reason: tokenChanged ? 'token' : 'source',
          queriedKey: source.key,
          liveKey: liveSource?.key ?? null,
          token,
          currentToken: switchLifecycle.currentToken,
          attempt,
        });
        continue;
      }

      listReloadEpochRef.current += 1;
      loadMoreInFlightRef.current = false;
      writeUnfilteredNonSearch(source, list, total, query, visibleCount);
      collectionDispatch({
        type: 'SET_LOADING',
        payload: {
          isLoadingArticles: false,
          isSavedListLoading: false,
          isLoadingMoreArticles: false,
          isLoadMoreInFlight: false,
        },
      });
      logger.info('FeedContext', 'Post-clear source reload published', {
        sourceKey: source.key,
        token,
        total,
        loaded: list.length,
        attempt,
        searchActive: articleListSearchQueryRef.current !== null,
      });

      const activeSearchText = articleListSearchQueryRef.current;
      if (activeSearchText !== null) {
        void enqueueSearchRequest(
          source,
          activeSearchText,
          Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT),
        );
        return;
      }

      dispatchArticlesTransitionIfChanged(
        list,
        total,
        {
          totalKnown: true,
          pageWasFull: list.length >= visibleCount,
          sourceKey: source.key,
          intentGeneration: visibleListIntentGenerationRef.current,
          query,
        },
      );
      return;
    }

    logger.info('FeedContext', 'Post-clear source reload skipped', {
      reason: 'max-attempts',
    });
  }, [
    dispatchArticlesTransitionIfChanged,
    enqueueSearchRequest,
    queryArticleListSource,
    rememberSourceArticleSnapshot,
  ]);

  const searchCurrentSource = useCallback(async (rawQuery: string) => {
    const source = getRefreshSourceDescriptor(navigationState);
    if (!source) {
      return;
    }
    await enqueueSearchRequest(source, rawQuery);
  }, [enqueueSearchRequest, navigationState]);

  const clearArticleListSearch = useCallback(async () => {
    if (
      articleListSearchQueryRef.current === null
      && articleListSearchStatusRef.current === 'idle'
      && !articleListSearchActiveRef.current
    ) {
      return;
    }

    const source = getRefreshSourceDescriptor(navigationState);
    const snapshot = source && nonSearchSnapshotRef.current.sourceKey === source.key
      ? nonSearchSnapshotRef.current
      : {
        sourceKey: source?.key ?? null,
        list: [],
        total: 0,
        totalKnown: false,
        pageWasFull: false,
        query: null,
      };
    const activeSearchEpoch = activeSearchEpochRef.current;
    articleListSearchQueryRef.current = null;
    const requestRevision = articleListSearchRevisionRef.current + 1;
    articleListSearchRevisionRef.current = requestRevision;
    const intentGeneration = advanceVisibleListIntent('idle');
    settlePendingSearchRequest();
    currentArticlesRef.current = snapshot.list;
    loadMorePagingSnapshotRef.current = {
      length: snapshot.list.length,
      lastArticle: snapshot.list[snapshot.list.length - 1],
      articlesTotalCount: snapshot.total,
      articlesTotalKnown: snapshot.totalKnown,
      pageWasFull: snapshot.pageWasFull,
      isLoadingMoreArticles: false,
    };
    articleListSearchStatusRef.current = 'idle';
    collectionDispatch({
      type: 'SET_ARTICLES',
      payload: {
        list: snapshot.list,
        total: snapshot.total,
        totalKnown: snapshot.totalKnown,
        pageWasFull: snapshot.pageWasFull,
        intentGeneration,
      },
    });

    const visibleCount = Math.max(snapshot.list.length, SMART_VIEW_ARTICLE_LIMIT);
    let list: Article[];
    let total: number;
    let query: ArticleQuery | null;
    try {
      if (activeSearchEpoch !== null) {
        await articleStore.cancelSearch(activeSearchEpoch);
      }
      if (!source || !isFeedProviderMountedRef.current) {
        return;
      }

      ({ articles: list, total, query } = await queryArticleListSource(source, visibleCount));
    } catch (error) {
      // The non-search snapshot is already back on screen; the header bar
      // fires this without awaiting, so a failed re-query only logs.
      recordRobustnessEvent('feedContext.asyncPhaseFailed');
      logger.warn('FeedContext', 'Search-exit list re-query failed', { sourceKey: source?.key ?? null, error });
      return;
    }
    const activeSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
      ?? activeSourceRef.current;
    if (
      intentGeneration !== visibleListIntentGenerationRef.current
      || articleListSearchRevisionRef.current !== requestRevision
      || articleListSearchQueryRef.current !== null
      || activeSource?.key !== source.key
    ) {
      return;
    }

    lastQueryRef.current = query;
    lastQuerySourceKeyRef.current = source.key;
    dispatchArticlesTransitionIfChanged(list, total, {
      totalKnown: true,
      pageWasFull: list.length >= visibleCount,
      sourceKey: source.key,
      intentGeneration,
      query,
    });
    flushPendingSwitchVisibleReconcileIfIdle();
    if (pendingBackgroundRefreshSourceKeyRef.current === source.key) {
      void applyBackgroundRefreshForSource(source);
    }
  }, [
    advanceVisibleListIntent,
    applyBackgroundRefreshForSource,
    dispatchArticlesTransitionIfChanged,
    flushPendingSwitchVisibleReconcileIfIdle,
    navigationState,
    queryArticleListSource,
    settlePendingSearchRequest,
  ]);

  const loadMoreArticles = useCallback(async (options: LoadMoreArticlesOptions = {}) => {
    const showLoadingIndicator = options.showLoadingIndicator ?? true;
    const priority = options.priority ?? (showLoadingIndicator ? 'urgent' : 'prefetch');
    const isUrgentLoadMore = priority === 'urgent';
    const paging = loadMorePagingSnapshotRef.current;
    if (paging.isLoadingMoreArticles || loadMoreInFlightRef.current) return;
    if (
      articleListSearchQueryRef.current !== null
      && articleListSearchStatusRef.current !== 'ready'
    ) {
      return;
    }
    if (!articleListHasMore({
      loadedCount: paging.length,
      totalCount: paging.articlesTotalCount,
      totalKnown: paging.articlesTotalKnown,
      pageWasFull: paging.pageWasFull,
    })) {
      return;
    }

    loadMoreInFlightRef.current = true;
    const token = switchLifecycle.currentToken;
    const reloadEpoch = listReloadEpochRef.current;
    const intentGeneration = visibleListIntentGenerationRef.current;
    const searchRevision = articleListSearchRevisionRef.current;
    const activeSearchText = articleListSearchQueryRef.current;
    const source = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
      ?? activeSourceRef.current;
    const sourceKey = source?.key ?? null;
    const offset = paging.length;
    const requestedLimit = ARTICLE_LIST_LOAD_MORE_LIMIT;
    let loadMoreSearchEpoch: string | null = null;
    loadMorePagingSnapshotRef.current = {
      ...loadMorePagingSnapshotRef.current,
      isLoadingMoreArticles: showLoadingIndicator,
    };
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
        if (
          token !== switchLifecycle.currentToken
          || activeSearchText !== articleListSearchQueryRef.current
          || searchRevision !== articleListSearchRevisionRef.current
          || intentGeneration !== visibleListIntentGenerationRef.current
          || reloadEpoch !== listReloadEpochRef.current
        ) {
          return;
        }
      }

      let more: { articles: Article[]; cancelled?: boolean };
      const sortForCursor = activeSearchText && source
        ? createArticleQueryForSource(source, SMART_VIEW_ARTICLE_LIMIT, activeSearchText).sort
        : lastQueryRef.current?.sort;
      const cursor = getArticlePaginationCursor(paging.lastArticle, sortForCursor);
      const queryStartedAtMs = getPerformanceTimeMs();
      if (activeSearchText) {
        if (!source) {
          return;
        }
        loadMoreSearchEpoch = await articleStore.beginSearch();
        const liveSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
          ?? activeSourceRef.current;
        if (
          token !== switchLifecycle.currentToken
          || activeSearchText !== articleListSearchQueryRef.current
          || searchRevision !== articleListSearchRevisionRef.current
          || intentGeneration !== visibleListIntentGenerationRef.current
          || reloadEpoch !== listReloadEpochRef.current
          || liveSource?.key !== sourceKey
        ) {
          await articleStore.cancelSearch(loadMoreSearchEpoch);
          return;
        }
        activeSearchEpochRef.current = loadMoreSearchEpoch;

        if (source.type === 'smart' && source.viewType === 'saved') {
          more = await savedArticlesService.querySavedViewArticles(
            requestedLimit,
            offset,
            activeSearchText,
            false,
            loadMoreSearchEpoch,
          );
        } else {
          const searchQuery = createArticleQueryForSource(source, SMART_VIEW_ARTICLE_LIMIT, activeSearchText);
          more = await articleStore.query({
            ...searchQuery,
            limit: requestedLimit,
            cursor,
            includeTotal: false,
            searchEpoch: loadMoreSearchEpoch,
          });
        }
      } else if (source?.type === 'smart' && source.viewType === 'saved') {
        more = await savedArticlesService.querySavedViewArticles(requestedLimit, offset);
      } else if (lastQueryRef.current) {
        more = await articleStore.query({ ...lastQueryRef.current, limit: requestedLimit, cursor, includeTotal: false });
      } else {
        return;
      }
      const queryDurationMs = getPerformanceTimeMs() - queryStartedAtMs;
      const liveSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
        ?? activeSourceRef.current;

      if (
        token !== switchLifecycle.currentToken
        || activeSearchText !== articleListSearchQueryRef.current
        || searchRevision !== articleListSearchRevisionRef.current
        || intentGeneration !== visibleListIntentGenerationRef.current
        || reloadEpoch !== listReloadEpochRef.current
        || more.cancelled === true
        || liveSource?.key !== sourceKey
      ) {
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
      const nextList = mergeUniqueArticlesByHash(currentArticlesRef.current, more.articles);
      const appendedFullPage = more.articles.length >= requestedLimit;
      const nextTotalKnown = paging.articlesTotalKnown || !appendedFullPage;
      const nextTotal = nextTotalKnown && !paging.articlesTotalKnown
        ? nextList.length
        : paging.articlesTotalCount;
      currentArticlesRef.current = nextList;
      loadMorePagingSnapshotRef.current = {
        ...loadMorePagingSnapshotRef.current,
        length: nextList.length,
        lastArticle: nextList[nextList.length - 1],
        articlesTotalCount: nextTotal,
        articlesTotalKnown: nextTotalKnown,
        pageWasFull: appendedFullPage,
      };
      if (activeSearchText === null) {
        nonSearchSnapshotRef.current = {
          ...nonSearchSnapshotRef.current,
          sourceKey,
          list: nextList,
          pageWasFull: more.articles.length >= requestedLimit,
        };
      }
      if (isUrgentLoadMore || showLoadingIndicator) {
        queueLoadMoreCommitMetric(metric, 'urgent');
        collectionDispatch({
          type: 'APPEND_ARTICLES',
          payload: { articles: more.articles, intentGeneration },
        });
      } else {
        queueLoadMoreCommitMetric(metric, 'transition');
        startTransition(() => {
          collectionDispatch({
            type: 'APPEND_ARTICLES',
            payload: { articles: more.articles, intentGeneration },
          });
        });
      }
    } finally {
      // Always release the lock. Only mutate visible loading flags if this
      // request still belongs to the active navigation token.
      loadMoreInFlightRef.current = false;
      if (
        loadMoreSearchEpoch !== null
        && activeSearchEpochRef.current === loadMoreSearchEpoch
      ) {
        activeSearchEpochRef.current = null;
      }
      loadMorePagingSnapshotRef.current = {
        ...loadMorePagingSnapshotRef.current,
        isLoadingMoreArticles: false,
      };
      collectionDispatch({
        type: 'SET_LOADING',
        payload: {
          isLoadMoreInFlight: false,
          ...(showLoadingIndicator && token === switchLifecycle.currentToken
            ? { isLoadingMoreArticles: false }
            : {}),
        },
      });
      flushPendingSwitchVisibleReconcileIfIdle();
      const activeSource = getRefreshSourceDescriptorFromPrevNav(prevNavRef.current)
        ?? activeSourceRef.current;
      if (activeSource && pendingBackgroundRefreshSourceKeyRef.current === activeSource.key) {
        void applyBackgroundRefreshForSource(activeSource);
      }
    }
  }, [
    applyBackgroundRefreshForSource,
    createArticleQueryForSource,
    flushPendingSwitchVisibleReconcileIfIdle,
    queueLoadMoreCommitMetric,
  ]);

  const updateArticleInList = useCallback((
    hash: string,
    updates: ArticleListUpdatePayload = { read: true },
    article?: Article | null,
    options?: { insertIntoSavedView?: boolean },
  ) => {
    const selected = navigationState.selectedSmartView;
    if (updates.read !== undefined) {
      notifyArticleReadChanged();
    }
    const removeFromUnread = selected === 'unread' && updates.read === true;
    const removeFromSaved = selected === 'saved' && updates.saved === false;
    const removeFromRead = selected === 'read' && updates.read === false;
    // A snapshot saved elsewhere (assistant) is the newest Saved row.
    const insertIntoSaved = selected === 'saved'
      && options?.insertIntoSavedView === true
      && updates.saved === true
      && Boolean(article);
    const insertOrMoveToTop = insertIntoSaved || (selected === 'read'
      && !removeFromRead
      && (updates.read === true || Boolean(updates.lastReadAt)));
    const source = getRefreshSourceDescriptor(navigationState);
    const searchText = articleListSearchQueryRef.current;
    if (searchText && source) {
      void enqueueSearchRequest(
        source,
        searchText,
        Math.max(currentArticlesRef.current.length, SMART_VIEW_ARTICLE_LIMIT),
      );
    } else {
      advanceVisibleListIntent('idle');
    }

    const intentGeneration = visibleListIntentGenerationRef.current;
    const currentContainsArticle = currentArticlesRef.current.some((entry) => entry.hash === hash);
    const visiblePayload: ArticleListMutationPayload = {
      hash,
      updates,
      removeFromUnread,
      removeFromSaved,
      removeFromRead,
      insertOrMoveToTop: searchText ? insertOrMoveToTop && currentContainsArticle : insertOrMoveToTop,
      article: searchText && !currentContainsArticle ? undefined : article ?? undefined,
      intentGeneration,
    };
    const nextVisible = applyArticleListMutation(
      currentArticlesRef.current,
      loadMorePagingSnapshotRef.current.articlesTotalCount,
      loadMorePagingSnapshotRef.current.articlesTotalKnown,
      visiblePayload,
    );
    currentArticlesRef.current = nextVisible.articles;
    loadMorePagingSnapshotRef.current = {
      ...loadMorePagingSnapshotRef.current,
      length: nextVisible.articles.length,
      lastArticle: nextVisible.articles[nextVisible.articles.length - 1],
      articlesTotalCount: nextVisible.total,
    };

    if (source && nonSearchSnapshotRef.current.sourceKey === source.key) {
      const nextSnapshot = applyArticleListMutation(
        nonSearchSnapshotRef.current.list,
        nonSearchSnapshotRef.current.total,
        nonSearchSnapshotRef.current.totalKnown,
        {
          hash,
          updates,
          removeFromUnread,
          removeFromSaved,
          removeFromRead,
          insertOrMoveToTop,
          article: article ?? undefined,
        },
      );
      nonSearchSnapshotRef.current = {
        ...nonSearchSnapshotRef.current,
        list: nextSnapshot.articles,
        total: nextSnapshot.total,
      };
    }

    collectionDispatch({
      type: 'UPDATE_ARTICLE',
      payload: visiblePayload,
    });
  }, [advanceVisibleListIntent, enqueueSearchRequest, navigationState]);

  // Scoped read changes patch the rows on screen (and the non-search snapshot)
  // in one pass instead of per-row updates or a reload, so the list never
  // flashes. A patch without exact hashes only applies to its own source.
  const patchVisibleRowsRead = useCallback((patch: RowReadPatch, sourceKey: string) => {
    if (!patch.hashes && activeSourceRef.current?.key !== sourceKey) {
      return;
    }
    currentArticlesRef.current = applyRowReadPatch(currentArticlesRef.current, patch);
    const snapshot = nonSearchSnapshotRef.current;
    if (patch.hashes || snapshot.sourceKey === sourceKey) {
      nonSearchSnapshotRef.current = { ...snapshot, list: applyRowReadPatch(snapshot.list, patch) };
    }
    collectionDispatch({ type: 'PATCH_ROWS_READ', payload: patch });
  }, []);

  const markReadInFlightRef = useRef(false);
  const markCurrentSourceRead = useCallback(async (
    options: { olderThanDays?: MarkReadOlderThanDays } = {},
  ): Promise<void> => {
    const source = activeSourceRef.current;
    const scope = toMarkReadScope(source);
    // The menu accelerator and the in-window shortcut can both fire; one run.
    if (!source || !scope || markReadInFlightRef.current) {
      return;
    }
    markReadInFlightRef.current = true;
    const { olderThanDays } = options;
    const olderThan = olderThanDays ? markReadCutoff(olderThanDays) : undefined;
    const searchText = articleListSearchQueryRef.current?.trim() || undefined;
    try {
      const result = await articleStore.markReadScope({ ...scope, olderThan, searchText });
      if (result.feedCounts.length > 0) {
        feedLibraryMutationBus.publishFeedsCountsUpdated(result.feedCounts);
      }
      if (result.changed === 0) {
        appToastService.show(markReadToastText(0, olderThanDays));
        return;
      }
      const hashes = result.undoable ? new Set(result.hashes) : null;
      patchVisibleRowsRead({ read: true, hashes, olderThan }, source.key);
      const text = markReadToastText(result.changed, olderThanDays);
      if (!hashes) {
        appToastService.show(text);
        return;
      }
      // The hashes live only in this closure, which the toast drops when it
      // expires or is replaced: bounded by the native undo limit and window.
      const undoHashes = result.hashes;
      appToastService.showWithAction(text, {
        label: 'Undo',
        run: () => {
          void (async () => {
            try {
              const counts = await articleStore.restoreUnread(undoHashes);
              if (counts.length > 0) {
                feedLibraryMutationBus.publishFeedsCountsUpdated(counts);
              }
              patchVisibleRowsRead({ read: false, hashes: new Set(undoHashes) }, source.key);
            } catch (error) {
              recordRobustnessEvent('feedContext.asyncPhaseFailed');
              logger.warn('FeedContext', 'Undo mark as read failed', { error });
              appToastService.show("Couldn't undo. Try again.");
            }
          })();
        },
      }, MARK_READ_UNDO_WINDOW_MS);
    } catch (error) {
      recordRobustnessEvent('feedContext.asyncPhaseFailed');
      logger.warn('FeedContext', 'Mark as read failed', { sourceKey: source.key, error });
      appToastService.show("Couldn't mark articles as read. Try again.");
    } finally {
      markReadInFlightRef.current = false;
    }
  }, [patchVisibleRowsRead]);

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
          try {
            const isRelevant = await isSchedulerUpdateRelevantToSource(activeSource, feedUpdates);
            if (isRelevant) {
              await applyBackgroundRefreshForSource(activeSource);
            }
          } catch (error) {
            // One failed station feed-id lookup must not abort the batch loop
            // (updates queued mid-flush would wait for the next scheduler event).
            recordRobustnessEvent('feedContext.asyncPhaseFailed');
            logger.warn('FeedContext', 'Scheduler UI flush failed', {
              sourceKey: activeSource.key,
              error,
            });
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
  activeSourceRef.current = activeSourceSnapshot;
  articleViewOverlayPhaseRef.current = overlayState.articleViewOverlayPhase;
  activeArticleHashRef.current = overlayState.activeArticleHash;
  updateArticleInListRef.current = updateArticleInList;

  // Assistant write tools: native already persisted read/star/save and the
  // feed counts (one writer per field), so this only publishes them to the
  // sidebar and the visible list. The bus catches and logs listener failures.
  useMountEffect(() => subscribeAssistantLibraryChanges(async (change) => {
    if (change.feedCounts.length > 0) {
      feedLibraryMutationBus.publishFeedsCountsUpdated(change.feedCounts);
    }
    const isSavedViewActive = () => {
      const source = activeSourceRef.current;
      return source?.type === 'smart' && source.viewType === 'saved';
    };
    for (const entry of change.articles) {
      // The open article's row stays put while the deck is open; ArticleView
      // merges the change and applies it on close, like its own read/save.
      if (entry.hash === activeArticleHashRef.current && articleViewOverlayPhaseRef.current !== 'closed') {
        continue;
      }
      const updates = toArticleListUpdate(entry);
      let savedRow: Article | null = null;
      if (
        entry.saved === true
        && entry.savedArticleId
        && change.savedArticleIds.includes(entry.savedArticleId)
        && isSavedViewActive()
      ) {
        savedRow = await savedArticlesService.getSavedViewArticle(entry.savedArticleId);
        if (!isSavedViewActive()) savedRow = null;
      }
      updateArticleInListRef.current(entry.hash, updates, savedRow, { insertIntoSavedView: savedRow !== null });
    }
  }));

  useDependencyEffect(() => {
    const snapshot = nonSearchSnapshotRef.current;
    if (
      !activeSourceSnapshot
      || snapshot.sourceKey !== activeSourceSnapshot.key
      || snapshot.query === null
    ) {
      return;
    }
    rememberSourceArticleSnapshot(
      activeSourceSnapshot.key,
      snapshot.list,
      snapshot.total,
      snapshot.query,
      snapshot.totalKnown,
      snapshot.pageWasFull,
    );
  }, [collectionState.articles, activeSourceSnapshot?.key, rememberSourceArticleSnapshot]);

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
    wakeSearchOverlayWaiter();

    const activeSource = activeSourceRef.current;
    if (
      !activeSource
      || articleListSearchActiveRef.current
      || articleListScrollActiveRef.current
    ) {
      return;
    }

    flushPendingSwitchVisibleReconcileIfIdle();

    if (pendingBackgroundRefreshSourceKeyRef.current === activeSource.key) {
      void applyBackgroundRefreshForSource(activeSource);
    }
  }, [
    applyBackgroundRefreshForSource,
    flushPendingSwitchVisibleReconcileIfIdle,
    overlayState.articleViewOverlayPhase,
    wakeSearchOverlayWaiter,
  ]);

  useMountEffect(() => {
    isFeedProviderMountedRef.current = true;
    const stopMemoryDiagnostics = startRendererSessionMemoryDiagnostics(() => ({
      loadedArticleCount: currentArticlesRef.current.length,
      articlesTotalCount: nonSearchSnapshotRef.current.total,
      estimatedSerializedListKb: estimateSerializedArticleListKb(currentArticlesRef.current),
      internFeedCount: getInternedFeedMetadataCount(),
      articleViewOpen: articleViewOverlayPhaseRef.current !== 'closed',
      articleListScrollActive: articleListScrollActiveRef.current,
      searchActive: articleListSearchActiveRef.current,
    }));

    const unsubscribe = feedScheduler.on((event) => {
      if (event.type === 'cycle-start') {
        if (typeof event.cycleId === 'number') {
          activeSchedulerCycleIdRef.current = event.cycleId;
        }
        return;
      }

      if (event.type === 'cycle-complete') {
        if (
          typeof event.cycleId === 'number'
          && activeSchedulerCycleIdRef.current === event.cycleId
        ) {
          activeSchedulerCycleIdRef.current = null;
        }
        void flushSchedulerUiUpdates(true);
        return;
      }

      // Native cycles publish committed inserts in bounded mid-cycle windows
      // (long import-boost cycles) plus one batch at cycle end; the
      // cycle-complete flush right after consumes these pending updates and
      // re-queries the visible list when the active source is affected.
      if (event.type === 'feeds-batch-updated') {
        if (
          typeof event.cycleId === 'number'
          && activeSchedulerCycleIdRef.current !== null
          && event.cycleId !== activeSchedulerCycleIdRef.current
        ) {
          return;
        }
        const pendingUpdates = pendingSchedulerFeedUpdatesRef.current;
        for (const update of event.updates) {
          const previousNewArticleCount = pendingUpdates.get(update.feedId) ?? 0;
          pendingUpdates.set(update.feedId, Math.max(previousNewArticleCount, update.newArticleCount));
        }
        scheduleSchedulerUiFlush();
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
      isFeedProviderMountedRef.current = false;
      visibleListIntentGenerationRef.current += 1;
      articleListSearchRevisionRef.current += 1;
      articleListSearchQueryRef.current = null;
      settlePendingSearchRequest();
      wakeSearchOverlayWaiter();
      cancelActiveSearch();
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
      switchLifecycle.dispose();
      pendingSchedulerFeedUpdatesRef.current.clear();
      pendingBackgroundRefreshSourceKeyRef.current = null;
      pendingStationRefreshSourceKeyRef.current = null;
      schedulerUiFlushQueuedRef.current = false;
      schedulerUiFlushInFlightRef.current = false;
      feedScheduler.clearActiveStationFocus();
    };
  });

  const navigationValue = useMemo(() => ({
    ...navigationState,
    selectFeed,
    selectTag,
    selectSmartView,
    clearFeedSelection,
  }), [navigationState, selectFeed, selectTag, selectSmartView, clearFeedSelection]);

  const collectionArticlesValue = useMemo((): CollectionArticlesState => ({
    articles: collectionState.articles,
    articlesTotalCount: collectionState.articlesTotalCount,
    articlesTotalKnown: collectionState.articlesTotalKnown,
    pageWasFull: collectionState.pageWasFull,
    newArticleCount: collectionState.newArticleCount,
    newArticleHashes: collectionState.newArticleHashes,
    articleListScrollRequest: collectionState.articleListScrollRequest,
  }), [
    collectionState.articles,
    collectionState.articlesTotalCount,
    collectionState.articlesTotalKnown,
    collectionState.pageWasFull,
    collectionState.newArticleCount,
    collectionState.newArticleHashes,
    collectionState.articleListScrollRequest,
  ]);

  const collectionLoadingValue = useMemo((): CollectionLoadingState => ({
    isLoadingArticles: collectionState.isLoadingArticles,
    isLoadingMoreArticles: collectionState.isLoadingMoreArticles,
    isLoadMoreInFlight: collectionState.isLoadMoreInFlight,
    isSavedListLoading: collectionState.isSavedListLoading,
    searchStatus: collectionState.searchStatus,
  }), [
    collectionState.isLoadingArticles,
    collectionState.isLoadingMoreArticles,
    collectionState.isLoadMoreInFlight,
    collectionState.isSavedListLoading,
    collectionState.searchStatus,
  ]);

  const collectionActionsValue = useMemo((): CollectionActions => ({
    refreshFeed,
    reloadCurrentSourceFromStore,
    loadMoreArticles,
    updateArticleInList,
    syncArticleListViewport,
    searchCurrentSource,
    clearArticleListSearch,
    markCurrentSourceRead,
  }), [
    refreshFeed,
    reloadCurrentSourceFromStore,
    loadMoreArticles,
    updateArticleInList,
    syncArticleListViewport,
    searchCurrentSource,
    clearArticleListSearch,
    markCurrentSourceRead,
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
