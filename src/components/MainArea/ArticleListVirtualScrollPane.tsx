import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';
import { motion } from 'motion/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Article } from '@/types/article';
import type {
  ArticleListScrollRequest,
  ArticleListSearchStatus,
  ArticleViewOverlayPhase,
} from '@/contexts/FeedContext';
import { ArticleListItem } from './ArticleListItem';
import { ArticleListSkeletonGroup } from './ArticleListSkeleton';
import { FeedLineLoader } from '@/components/common/FeedLineLoader';
import { InteractionProfiler } from '@/components/common/InteractionProfiler';
import { useArticleListScrollOffset } from './hooks/articleListScrollOffsetContext';
import { useArticleListKeyboardNavigation } from './hooks/useArticleListKeyboardNavigation';
import { useArticleListRowFocus } from './hooks/useArticleListRowFocus';
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
import { articleListHasMore } from '@/services/articles/articleListTotal';
import { isUsableImageUrl } from '@/utils/mediaUrl';
import {
  ARTICLE_LIST_DENSITY_ESTIMATED_ROW_HEIGHT,
  DEFAULT_ARTICLE_LIST_DENSITY,
  type ArticleListDensity,
} from '@/lib/articleListDensity';
import {
  captureArticleListScrollAnchor,
  resolveArticleListAnchorScrollTop,
} from './articleListDensityAnchor';

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
  articlesTotalKnown: boolean;
  pageWasFull: boolean;
  activeArticleHash: string | null;
  articleViewOverlayPhase: ArticleViewOverlayPhase;
  isInitialLoading: boolean;
  isLoadingMoreArticles: boolean;
  isSearchActive: boolean;
  isSearchDebouncePending: boolean;
  searchStatus: ArticleListSearchStatus;
  debouncedSearchQuery: string;
  isSavedView: boolean;
  newArticleHashes: Set<string>;
  articleListScrollRequest: ArticleListScrollRequest | null;
  totalFeeds: number;
  density?: ArticleListDensity;
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
  articlesTotalKnown,
  pageWasFull,
  activeArticleHash,
  articleViewOverlayPhase,
  isInitialLoading,
  isLoadingMoreArticles,
  isSearchActive,
  isSearchDebouncePending,
  searchStatus,
  debouncedSearchQuery,
  isSavedView,
  newArticleHashes,
  articleListScrollRequest,
  totalFeeds,
  density = DEFAULT_ARTICLE_LIST_DENSITY,
  selectArticle,
  loadMoreArticles,
  syncArticleListViewport,
}: ArticleListVirtualScrollPaneProps) {
  const { setHasListScrollOffset } = useArticleListScrollOffset();
  const [keyboardFocusHash, setKeyboardFocusHash] = useState<string | null>(null);
  const [deferPreviewImages, setDeferPreviewImages] = useState(false);
  const articleListItemsRef = useRef<HTMLDivElement>(null);
  const virtualSpacerRef = useRef<HTMLDivElement>(null);
  const previousDensityRef = useRef(density);
  const previewImageScrollIdleTimerRef = useRef<number | null>(null);
  const scrollVelocitySampleRef = useRef<ArticleListScrollVelocitySample | null>(null);
  const scrollVelocityPxPerMsRef = useRef(0);

  const hasMoreArticles = articleListHasMore({
    loadedCount: filteredArticles.length,
    totalCount: articlesTotalCount,
    totalKnown: articlesTotalKnown ?? true,
    pageWasFull: pageWasFull ?? false,
  });
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
    estimateSize: (index) => (
      density === 'large-images' && !isUsableImageUrl(filteredArticles[index]?.previewImage)
        ? ARTICLE_LIST_ESTIMATED_ROW_HEIGHT
        : ARTICLE_LIST_DENSITY_ESTIMATED_ROW_HEIGHT[density]
    ),
    overscan: deferPreviewImages ? 28 : 16,
    getItemKey: (index) => filteredArticles[index]?.hash ?? index,
    measureElement: measureArticleRowHeight,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const firstVirtualIndex = virtualItems[0]?.index ?? 0;
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  const highlightedArticleHash = keyboardFocusHash ?? activeArticleHash;
  // One Tab stop for the whole list: the highlighted row, else the first row.
  const tabStopHash = useMemo(() => (
    highlightedArticleHash && filteredArticles.some((article) => article.hash === highlightedArticleHash)
      ? highlightedArticleHash
      : filteredArticles[0]?.hash ?? null
  ), [filteredArticles, highlightedArticleHash]);
  // Rows mount in a window; screen readers get the real position and size.
  // While more pages can load the size is unknown (-1).
  const listSetSize = hasMoreArticles ? -1 : filteredArticles.length;

  // Density change: every row changes height. Re-measure all rows, then put the
  // active row (or the top visible row) back where it was instead of jumping.
  useLayoutEffect(() => {
    if (previousDensityRef.current === density) return;
    previousDensityRef.current = density;

    const listElement = articleListItemsRef.current;
    const activeIndex = highlightedArticleHash
      ? filteredArticles.findIndex((article) => article.hash === highlightedArticleHash)
      : -1;
    const anchor = listElement
      ? captureArticleListScrollAnchor(
        rowVirtualizer.getVirtualItems(),
        listElement.scrollTop,
        listElement.clientHeight,
        activeIndex,
      )
      : null;

    rowVirtualizer.measure();
    if (!listElement) return;

    // Mounted rows keep their measure ref, so read their new heights now. The
    // virtualizer's own above-viewport scroll nudges are skipped: the anchor
    // below sets the final position in one step.
    const previousShouldAdjust = rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange;
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
    try {
      listElement.querySelectorAll<HTMLDivElement>('.article-list-virtual-row').forEach((row) => {
        rowVirtualizer.measureElement(row);
      });
    } finally {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = previousShouldAdjust;
    }

    if (!anchor) return;
    const totalSize = rowVirtualizer.getTotalSize();
    // The spacer re-renders next; size it now so the target offset is not clamped.
    if (virtualSpacerRef.current) {
      virtualSpacerRef.current.style.height = `${totalSize + ARTICLE_LIST_BOTTOM_SPACER_HEIGHT}px`;
    }
    const anchorItem = rowVirtualizer.measurementsCache[anchor.index];
    if (!anchorItem) return;
    rowVirtualizer.scrollToOffset(
      resolveArticleListAnchorScrollTop(anchor, anchorItem.start, anchorItem.size),
    );
  }, [density, filteredArticles, highlightedArticleHash, rowVirtualizer]);

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

  useArticleListRowFocus({
    listRef: articleListItemsRef,
    highlightedHash: highlightedArticleHash,
    activeArticleHash,
    overlayPhase: articleViewOverlayPhase,
    mountedRowsKey: `${firstVirtualIndex}:${lastVirtualIndex}`,
  });

  // Tab / VoiceOver focus on a row makes it the keyboard row, so the arrows
  // act on what is being read.
  const handleRowFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const row = event.target;
    if (!(row instanceof HTMLElement) || !row.matches('.article-list-item[data-entity-id]')) return;
    const hash = row.dataset.entityId;
    if (!hash || hash === highlightedArticleHash) return;
    try {
      if (!row.matches(':focus-visible')) return;
    } catch {
      // Engines without :focus-visible: treat as keyboard focus.
    }
    setKeyboardFocusHash(hash);
  }, [highlightedArticleHash]);

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
    isInitialLoading,
  });

  const requestLoadMoreArticles = useCallback((lastVisibleIndex: number, scrollVelocityPxPerMs = scrollVelocityPxPerMsRef.current) => {
    if (!shouldTriggerArticleListLoadMore(
      filteredArticles.length,
      articlesTotalCount,
      lastVisibleIndex,
      {
        scrollVelocityPxPerMs,
        totalKnown: articlesTotalKnown ?? true,
        pageWasFull: pageWasFull ?? false,
      },
    )) {
      return;
    }

    void loadMoreArticles({
      showLoadingIndicator: false,
      priority: getArticleListLoadMorePriority(filteredArticles.length, lastVisibleIndex),
    });
  }, [articlesTotalCount, articlesTotalKnown, filteredArticles.length, loadMoreArticles, pageWasFull]);

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
    // Wheel still lands on the scroller; do not compact the header or snapshot as scrolled.
    if (isInitialLoading) {
      setHasListScrollOffset(false);
      return;
    }

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
        { totalKnown: articlesTotalKnown ?? true, pageWasFull: pageWasFull ?? false },
      )
    ) {
      requestLoadMoreArticles(lastVirtualIndex, velocityPxPerMs);
    }
  }, [
    articlesTotalCount,
    articlesTotalKnown,
    pageWasFull,
    filteredArticles.length,
    isSearchDebouncePending,
    lastVirtualIndex,
    isInitialLoading,
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
    isInitialLoading,
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
    isLoadingMoreArticles,
    articleListItemsRef,
  });

  return (
    <InteractionProfiler id={`article-list:${sourceKey}:${navigationNonce}`} onRender={handleListProfilerRender}>
      <div
        ref={articleListItemsRef}
        data-section="article-list-items"
        className={`article-list-items${totalFeeds === 0 || filteredArticles.length === 0 ? ' no-scrollbar' : ''}${isInitialLoading ? ' article-list-items--skeleton' : ''}`}
        onScroll={(event) => {
          handleScrollPerformanceEvent(event.currentTarget.scrollTop);
          handleArticleListScroll(event);
        }}
        onFocus={handleRowFocus}
      >
        {isInitialLoading ? (
          <ArticleListSkeletonGroup key="skeleton" />
        ) : filteredArticles.length === 0 ? (
          !isInitialLoading && debouncedSearchQuery.trim() ? (
            <motion.div
              key="empty-search"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 1, y: 10 }}
              className="article-list-empty theme-text-secondary"
            >
              <p>
                {searchStatus === 'pending'
                  ? 'Searching…'
                  : searchStatus === 'error'
                    ? 'Search failed. Try another query.'
                    : 'No articles match your search.'}
              </p>
            </motion.div>
          ) : null
        ) : (
          <div
            ref={virtualSpacerRef}
            className="article-list-virtual-spacer"
            role="listbox"
            aria-label={sourceLabel ? `${sourceLabel} articles` : 'Articles'}
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
                    density={density}
                    posInSet={virtualRow.index + 1}
                    setSize={listSetSize}
                    isTabStop={tabStopHash === article.hash}
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
        {!isInitialLoading && isLoadingMoreArticles && (
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
    && previous.articlesTotalKnown === next.articlesTotalKnown
    && previous.pageWasFull === next.pageWasFull
    && previous.activeArticleHash === next.activeArticleHash
    && previous.articleViewOverlayPhase === next.articleViewOverlayPhase
    && previous.isInitialLoading === next.isInitialLoading
    && previous.isLoadingMoreArticles === next.isLoadingMoreArticles
    && previous.isSearchActive === next.isSearchActive
    && previous.isSearchDebouncePending === next.isSearchDebouncePending
    && previous.searchStatus === next.searchStatus
    && previous.debouncedSearchQuery === next.debouncedSearchQuery
    && previous.isSavedView === next.isSavedView
    && previous.totalFeeds === next.totalFeeds
    && previous.density === next.density
    && previous.selectArticle === next.selectArticle
    && previous.loadMoreArticles === next.loadMoreArticles
    && previous.syncArticleListViewport === next.syncArticleListViewport
    && previous.articleListRef === next.articleListRef
  );
}
