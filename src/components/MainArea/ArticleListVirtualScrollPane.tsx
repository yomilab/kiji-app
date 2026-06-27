import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from 'react';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';
import { motion } from 'motion/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Article } from '@/types/article';
import type { ArticleListScrollRequest, ArticleViewOverlayPhase } from '@/contexts/FeedContext';
import { ArticleListItem } from './ArticleListItem';
import { ArticleListSkeletonGroup } from './ArticleListSkeleton';
import { FeedLineLoader } from '@/components/common/FeedLineLoader';
import { InteractionProfiler } from '@/components/common/InteractionProfiler';
import { useArticleListScrollOffset } from './hooks/articleListScrollOffsetContext';
import { useArticleListKeyboardNavigation } from './hooks/useArticleListKeyboardNavigation';
import { useArticleListScrollReset } from './hooks/useArticleListScrollReset';
import { useArticleListScrollOffsetSync } from './hooks/useArticleListScrollOffsetSync';
import { useArticleListBackgroundScrollSync } from './hooks/useArticleListBackgroundScrollSync';
import { useArticleListPerformanceMetrics } from './hooks/useArticleListPerformanceMetrics';
import { ARTICLE_LIST_PREVIEW_SCROLL_IDLE_MS, ARTICLE_LIST_SOURCE_SWITCH_PREVIEW_DEFER_MS } from './articleListPreviewConstants';
import { shouldScrollArticleIndexIntoView, shouldScrollKeyboardFocusIntoView } from './articleListScrollIntoView';
import {
  ARTICLE_LIST_BOTTOM_SPACER_HEIGHT,
  ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
  getArticleListLoadMorePriority,
  measureArticleListScrollVelocity,
  shouldTriggerArticleListLoadMore,
  shouldTriggerArticleListLoadMoreFromScroll,
  type ArticleListScrollVelocitySample,
} from './articleListLoadMore';

const measureArticleRowHeight = (
  element: Element,
  entry?: ResizeObserverEntry,
): number => {
  return entry?.contentRect.height ?? element.getBoundingClientRect().height;
};

export interface ArticleListVirtualScrollPaneProps {
  articleListRef: RefObject<HTMLDivElement>;
  sourceKey: string;
  navigationNonce: number;
  sourceLabel: string | null;
  variant: 'common' | 'saved';
  filteredArticles: Article[];
  articlesTotalCount: number;
  activeArticleHash: string | null;
  articleViewOverlayPhase: ArticleViewOverlayPhase;
  isInitialLoading: boolean;
  isLoadingMoreArticles: boolean;
  isSearchActive: boolean;
  isSearchDebouncePending: boolean;
  debouncedSearchQuery: string;
  isSavedView: boolean;
  isFetchingNew: boolean;
  newArticleHashes: Set<string>;
  articleListScrollRequest: ArticleListScrollRequest | null;
  totalFeeds: number;
  selectArticle: (hash: string) => void;
  loadMoreArticles: (options: { showLoadingIndicator: boolean; priority: 'prefetch' | 'urgent' }) => Promise<void>;
  syncArticleListViewport: (snapshot: {
    isSearchActive: boolean;
    isAtTop: boolean;
    anchorHash: string | null;
    scrollTop?: number;
    isScrolling?: boolean;
  }) => void;
}

export const ArticleListVirtualScrollPane = memo(function ArticleListVirtualScrollPane({
  articleListRef,
  sourceKey,
  navigationNonce,
  sourceLabel,
  variant,
  filteredArticles,
  articlesTotalCount,
  activeArticleHash,
  articleViewOverlayPhase,
  isInitialLoading,
  isLoadingMoreArticles,
  isSearchActive,
  isSearchDebouncePending,
  debouncedSearchQuery,
  isSavedView,
  isFetchingNew,
  newArticleHashes,
  articleListScrollRequest,
  totalFeeds,
  selectArticle,
  loadMoreArticles,
  syncArticleListViewport,
}: ArticleListVirtualScrollPaneProps) {
  const { setHasListScrollOffset } = useArticleListScrollOffset();
  const [keyboardFocusHash, setKeyboardFocusHash] = useState<string | null>(null);
  const [deferPreviewImages, setDeferPreviewImages] = useState(false);
  const articleListItemsRef = useRef<HTMLDivElement>(null);
  const previewImageScrollIdleTimerRef = useRef<number | null>(null);
  const scrollVelocitySampleRef = useRef<ArticleListScrollVelocitySample | null>(null);
  const scrollVelocityPxPerMsRef = useRef(0);

  const hasMoreArticles = filteredArticles.length < articlesTotalCount;
  const virtualRowCount = filteredArticles.length;

  const newArticleAnimationOrderMap = useMemo(() => {
    const orderMap = new Map<string, number>();
    if (newArticleHashes.size === 0) {
      return orderMap;
    }

    let order = 0;
    for (const article of filteredArticles) {
      if (newArticleHashes.has(article.hash)) {
        orderMap.set(article.hash, order);
        order += 1;
      }
    }
    return orderMap;
  }, [filteredArticles, newArticleHashes]);

  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement: () => articleListItemsRef.current,
    estimateSize: () => ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
    overscan: deferPreviewImages ? 28 : 16,
    getItemKey: (index) => filteredArticles[index]?.hash ?? index,
    measureElement: measureArticleRowHeight,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const firstVirtualIndex = virtualItems[0]?.index ?? 0;
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  const highlightedArticleHash = keyboardFocusHash ?? activeArticleHash;

  const ensureHashInView = useCallback((hash: string) => {
    const index = filteredArticles.findIndex((article) => article.hash === hash);
    if (index === -1) return;
    if (!shouldScrollArticleIndexIntoView(index, firstVirtualIndex, lastVirtualIndex)) {
      return;
    }
    rowVirtualizer.scrollToIndex(index, { align: 'auto' });
  }, [filteredArticles, firstVirtualIndex, lastVirtualIndex, rowVirtualizer]);

  const scrollKeyboardFocusIntoView = useCallback((hash: string) => {
    const index = filteredArticles.findIndex((article) => article.hash === hash);
    if (index === -1) return;

    const listElement = articleListItemsRef.current;
    if (!listElement) return;

    const virtualRows = virtualItems.map((item) => ({
      index: item.index,
      start: item.start,
      end: item.end,
    }));

    if (!shouldScrollKeyboardFocusIntoView(
      index,
      listElement.scrollTop,
      listElement.clientHeight,
      virtualRows,
    )) {
      return;
    }

    rowVirtualizer.scrollToIndex(index, { align: 'auto' });
  }, [filteredArticles, virtualItems, rowVirtualizer]);

  const syncViewportSnapshot = useCallback((isAtTop: boolean, isScrolling = false, scrollTop?: number) => {
    const anchorHash = filteredArticles[firstVirtualIndex]?.hash ?? filteredArticles[0]?.hash ?? null;
    const resolvedScrollTop = scrollTop ?? articleListItemsRef.current?.scrollTop ?? 0;

    syncArticleListViewport({
      isSearchActive,
      isAtTop,
      anchorHash,
      scrollTop: resolvedScrollTop,
      isScrolling,
    });
  }, [filteredArticles, firstVirtualIndex, isSearchActive, syncArticleListViewport]);

  const handleOpenArticle = useCallback(
    (hash: string) => {
      setKeyboardFocusHash(null);
      selectArticle(hash);
    },
    [selectArticle],
  );

  const formatDateDisplay = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);

    if (compareDate.getTime() === today.getTime()) {
      return '';
    }
    if (compareDate.getTime() === yesterday.getTime()) {
      return 'yesterday';
    }
    return date.toLocaleDateString();
  }, []);

  useDependencyEffect(() => {
    setKeyboardFocusHash(null);
    setDeferPreviewImages(true);
    const timer = window.setTimeout(() => {
      setDeferPreviewImages(false);
    }, ARTICLE_LIST_SOURCE_SWITCH_PREVIEW_DEFER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [sourceKey]);

  useArticleListKeyboardNavigation({
    articleListRef,
    filteredArticles,
    keyboardFocusHash,
    activeArticleHash,
    articleViewOverlayPhase,
    selectArticle: handleOpenArticle,
    setKeyboardFocusHash,
    scrollKeyboardFocusIntoView,
  });

  useArticleListScrollReset({
    sourceKey,
    filteredCount: filteredArticles.length,
    articleListItemsRef,
    rowVirtualizer,
    setHasListScrollOffset,
  });

  const requestLoadMoreArticles = useCallback((lastVisibleIndex: number, scrollVelocityPxPerMs = scrollVelocityPxPerMsRef.current) => {
    if (!shouldTriggerArticleListLoadMore(
      filteredArticles.length,
      articlesTotalCount,
      lastVisibleIndex,
      { scrollVelocityPxPerMs },
    )) {
      return;
    }

    void loadMoreArticles({
      showLoadingIndicator: false,
      priority: getArticleListLoadMorePriority(filteredArticles.length, lastVisibleIndex),
    });
  }, [articlesTotalCount, filteredArticles.length, loadMoreArticles]);

  useEffect(() => {
    if (isSearchDebouncePending || lastVirtualIndex < 0 || !hasMoreArticles) {
      return;
    }

    requestLoadMoreArticles(lastVirtualIndex);
  }, [
    hasMoreArticles,
    isSearchDebouncePending,
    lastVirtualIndex,
    requestLoadMoreArticles,
  ]);

  const handleArticleListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const scrollElement = event.currentTarget;
    const { scrollTop } = scrollElement;
    const { velocityPxPerMs, sample } = measureArticleListScrollVelocity(
      scrollVelocitySampleRef.current,
      scrollTop,
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now(),
    );
    scrollVelocitySampleRef.current = sample;
    scrollVelocityPxPerMsRef.current = velocityPxPerMs;
    const isScrolled = scrollTop > 0;
    setHasListScrollOffset((previous) => (previous === isScrolled ? previous : isScrolled));
    setDeferPreviewImages(true);
    if (previewImageScrollIdleTimerRef.current !== null) {
      window.clearTimeout(previewImageScrollIdleTimerRef.current);
    }
    previewImageScrollIdleTimerRef.current = window.setTimeout(() => {
      previewImageScrollIdleTimerRef.current = null;
      setDeferPreviewImages(false);
    }, ARTICLE_LIST_PREVIEW_SCROLL_IDLE_MS);
    syncViewportSnapshot(!isScrolled, true, scrollTop);

    if (
      !isSearchDebouncePending
      && shouldTriggerArticleListLoadMoreFromScroll(
        scrollElement,
        filteredArticles.length,
        articlesTotalCount,
        velocityPxPerMs,
      )
    ) {
      requestLoadMoreArticles(lastVirtualIndex, velocityPxPerMs);
    }
  }, [
    articlesTotalCount,
    filteredArticles.length,
    isSearchDebouncePending,
    lastVirtualIndex,
    requestLoadMoreArticles,
    setHasListScrollOffset,
    syncViewportSnapshot,
  ]);

  useArticleListScrollOffsetSync({
    articleListItemsRef,
    sourceKey,
    filteredCount: filteredArticles.length,
    isSearchActive,
    setHasListScrollOffset,
    syncViewportSnapshot,
  });

  useArticleListBackgroundScrollSync({
    articleListItemsRef,
    filteredCount: filteredArticles.length,
    scrollRequest: articleListScrollRequest,
    rowVirtualizer,
    ensureHashInView,
    setHasListScrollOffset,
  });

  useEffect(() => {
    return () => {
      if (previewImageScrollIdleTimerRef.current !== null) {
        window.clearTimeout(previewImageScrollIdleTimerRef.current);
      }
    };
  }, []);

  const { handleListProfilerRender, handleScrollPerformanceEvent } = useArticleListPerformanceMetrics({
    sourceKey,
    navigationNonce,
    sourceLabel,
    variant,
    filteredCount: filteredArticles.length,
    visibleRowCount: virtualItems.length,
    totalVirtualSizePx: rowVirtualizer.getTotalSize(),
    isSearchActive,
    isFetchingNew,
    isLoadingMoreArticles,
    articleListItemsRef,
  });

  return (
    <InteractionProfiler id={`article-list:${sourceKey}:${navigationNonce}`} onRender={handleListProfilerRender}>
      <div
        ref={articleListItemsRef}
        data-section="article-list-items"
        className={`article-list-items ${totalFeeds === 0 || filteredArticles.length === 0 ? 'no-scrollbar' : ''}`}
        onScroll={(event) => {
          handleScrollPerformanceEvent(event.currentTarget.scrollTop);
          handleArticleListScroll(event);
        }}
      >
        {isInitialLoading ? (
          <ArticleListSkeletonGroup key="skeleton" count={10} />
        ) : filteredArticles.length === 0 ? (
          !isInitialLoading && debouncedSearchQuery.trim() ? (
            <motion.div
              key="empty-search"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 1, y: 10 }}
              className="article-list-empty theme-text-secondary"
            >
              <p>No articles match your search.</p>
            </motion.div>
          ) : null
        ) : (
          <div
            className="article-list-virtual-spacer"
            style={{ height: `${rowVirtualizer.getTotalSize() + ARTICLE_LIST_BOTTOM_SPACER_HEIGHT}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const article = filteredArticles[virtualRow.index];
              if (!article) return null;

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  className="article-list-virtual-row"
                  data-index={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <ArticleListItem
                    article={article}
                    isActive={highlightedArticleHash === article.hash}
                    isNew={newArticleHashes.has(article.hash)}
                    newAnimationOrder={newArticleAnimationOrderMap.get(article.hash) ?? -1}
                    readStateMode={isSavedView ? 'none' : 'normal'}
                    searchQuery={debouncedSearchQuery}
                    deferPreviewImages={deferPreviewImages}
                    onSelect={handleOpenArticle}
                    formatDateDisplay={formatDateDisplay}
                    enableLayoutAnimation={false}
                  />
                </div>
              );
            })}
            <div
              className="article-list-bottom-spacer"
              style={{ transform: `translateY(${rowVirtualizer.getTotalSize()}px)`, height: `${ARTICLE_LIST_BOTTOM_SPACER_HEIGHT}px` }}
              aria-hidden="true"
            />
          </div>
        )}
        {isLoadingMoreArticles && (
          <div className="article-list-load-more">
            <FeedLineLoader
              size="sm"
              color="var(--theme-primary-color)"
              ariaLabel="Loading more articles"
            />
          </div>
        )}
      </div>
    </InteractionProfiler>
  );
}, areArticleListVirtualScrollPanePropsEqual);

function areArticleListVirtualScrollPanePropsEqual(
  previous: ArticleListVirtualScrollPaneProps,
  next: ArticleListVirtualScrollPaneProps,
): boolean {
  if (previous.filteredArticles !== next.filteredArticles) return false;
  if (previous.newArticleHashes !== next.newArticleHashes) return false;
  if (previous.articleListScrollRequest !== next.articleListScrollRequest) return false;

  return (
    previous.sourceKey === next.sourceKey
    && previous.navigationNonce === next.navigationNonce
    && previous.sourceLabel === next.sourceLabel
    && previous.variant === next.variant
    && previous.articlesTotalCount === next.articlesTotalCount
    && previous.activeArticleHash === next.activeArticleHash
    && previous.articleViewOverlayPhase === next.articleViewOverlayPhase
    && previous.isInitialLoading === next.isInitialLoading
    && previous.isLoadingMoreArticles === next.isLoadingMoreArticles
    && previous.isSearchActive === next.isSearchActive
    && previous.isSearchDebouncePending === next.isSearchDebouncePending
    && previous.debouncedSearchQuery === next.debouncedSearchQuery
    && previous.isSavedView === next.isSavedView
    && previous.totalFeeds === next.totalFeeds
    && previous.selectArticle === next.selectArticle
    && previous.loadMoreArticles === next.loadMoreArticles
    && previous.syncArticleListViewport === next.syncArticleListViewport
    && previous.articleListRef === next.articleListRef
  );
}
