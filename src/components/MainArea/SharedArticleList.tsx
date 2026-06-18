import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFeedNavigation, useFeedCollection, useFeedOverlay, useFeedUI } from '@/contexts/FeedContext';
import { LayoutType } from '@/services/settings/types';
import { ArticleListWidgets } from './ArticleListWidgets';
import { ArticleListSearchInput } from './ArticleListSearchInput';
import { ArticleListItem } from './ArticleListItem';
import { ArticleListSkeletonGroup, ArticleListHeaderSkeleton } from './ArticleListSkeleton';
import { useFetchIndicatorState } from './hooks/useFetchIndicatorState';
import { useArticleListKeyboardNavigation } from './hooks/useArticleListKeyboardNavigation';
import { useArticleListSearch } from './hooks/useArticleListSearch';
import { useArticleListLayoutResize } from './hooks/useArticleListLayoutResize';
import { useTransientNewArticleHashes } from './hooks/useTransientNewArticleHashes';
import { useSourceSwitchGrace } from './hooks/useSourceSwitchGrace';
import { useArticleListScrollReset } from './hooks/useArticleListScrollReset';
import { useArticleListScrollOffsetSync } from './hooks/useArticleListScrollOffsetSync';
import { useArticleListBackgroundScrollSync } from './hooks/useArticleListBackgroundScrollSync';
import { useArticleListPerformanceMetrics } from './hooks/useArticleListPerformanceMetrics';
import { InteractionProfiler } from '@/components/common/InteractionProfiler';
import { FeedLineLoader } from '@/components/common/FeedLineLoader';
import { ARTICLE_LIST_PREVIEW_SCROLL_IDLE_MS } from './articleListPreviewConstants';
import {
  ARTICLE_LIST_BOTTOM_SPACER_HEIGHT,
  ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
  getArticleListLoadMorePriority,
  shouldTriggerArticleListLoadMore,
  shouldTriggerArticleListLoadMoreFromScroll,
} from './articleListLoadMore';
import './ArticleList.css';

interface SharedArticleListProps {
  layout?: LayoutType;
  variant: 'common' | 'saved';
}

const TITLE_LOADER_FOLD_ANIMATION_SECONDS = 0.38;

const measureArticleRowHeight = (
  element: Element,
  entry?: ResizeObserverEntry
): number => {
  // Prefer ResizeObserver measurements so scroll-time virtualization does not
  // repeatedly force layout with getBoundingClientRect().
  return entry?.contentRect.height ?? element.getBoundingClientRect().height;
};

export const SharedArticleList: React.FC<SharedArticleListProps> = ({ layout = '2-column', variant }) => {
  const {
    selectedFeedTitle,
    selectedFeedId,
    selectedTag,
    selectedSmartView,
    navigationNonce,
  } = useFeedNavigation();

  const {
    articles,
    articlesTotalCount,
    isLoadingArticles,
    isLoadingMoreArticles,
    isSavedListLoading,
    isGlobalLoadingIndicatorActive,
    loadMoreArticles,
    newArticleHashes: contextNewArticleHashes,
    articleListScrollRequest,
    syncArticleListViewport,
    searchCurrentSource,
    clearArticleListSearch,
  } = useFeedCollection();

  const {
    activeArticleHash,
    selectArticle,
    setActiveArticle,
    articleViewOverlayPhase,
  } = useFeedOverlay();

  const { error, totalFeeds } = useFeedUI();

  const [hasListScrollOffset, setHasListScrollOffset] = useState(false);
  const [deferPreviewImages, setDeferPreviewImages] = useState(false);
  const articleListRef = useRef<HTMLDivElement>(null);
  const articleListItemsRef = useRef<HTMLDivElement>(null);
  const previewImageScrollIdleTimerRef = useRef<number | null>(null);
  
  const {
    searchQuery,
    debouncedSearchQuery,
    isSearchOpen,
    handleSearchChange,
    handleToggleSearch,
    handleCloseSearch,
  } = useArticleListSearch({
    articleListRef,
    totalFeeds,
  });
  
  const {
    isDragging,
    widthStyle,
    showResizeHandle,
    handleBorderMouseDown,
  } = useArticleListLayoutResize({
    articleListRef,
    layout,
  });

  const isSavedView = variant === 'saved';
  const sourceArticles = articles;
  const isListLoading = isSavedView ? isSavedListLoading : isLoadingArticles;
  const showFetchIndicator = !isSavedView;
  const newArticleHashes = useTransientNewArticleHashes(isSavedView, contextNewArticleHashes);
  const isSearchActive = isSearchOpen && searchQuery.trim().length > 0;

  const filteredArticles = sourceArticles;
  const hasMoreArticles = filteredArticles.length < articlesTotalCount;
  const virtualRowCount = filteredArticles.length;

  const subtitleCount = articlesTotalCount;
  const subtitleText = `${subtitleCount} Items`;

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
  const isSearchDebouncePending = searchQuery.trim() !== debouncedSearchQuery.trim();

  const ensureHashInView = useCallback((hash: string) => {
    const index = filteredArticles.findIndex((article) => article.hash === hash);
    if (index === -1) return;
    rowVirtualizer.scrollToIndex(index, { align: 'auto' });
  }, [filteredArticles, rowVirtualizer]);
  const syncViewportSnapshot = useCallback((isAtTop: boolean, isScrolling = false) => {
    const anchorHash = filteredArticles[firstVirtualIndex]?.hash ?? filteredArticles[0]?.hash ?? null;

    syncArticleListViewport({
      isSearchActive,
      isAtTop,
      anchorHash,
      isScrolling,
    });
  }, [filteredArticles, firstVirtualIndex, isSearchActive, syncArticleListViewport]);

  const sourceKey = useMemo(() => {
    if (selectedFeedId) return `feed:${selectedFeedId}`;
    if (selectedTag) return `tag:${selectedTag}`;
    if (selectedSmartView) return `smart:${selectedSmartView}`;
    return 'none';
  }, [selectedFeedId, selectedTag, selectedSmartView]);

  useEffect(() => {
    const query = debouncedSearchQuery.trim();
    if (!isSearchOpen || !query) {
      void clearArticleListSearch();
      return;
    }

    void searchCurrentSource(query);
  }, [clearArticleListSearch, debouncedSearchQuery, isSearchOpen, searchCurrentSource, sourceKey]);

  const { isFetchIndicatorVisible, applySourceSwitchGrace } = useFetchIndicatorState({
    enabled: showFetchIndicator,
    isActive: isGlobalLoadingIndicatorActive,
    sourceKey,
  });

  useSourceSwitchGrace({
    sourceKey,
    enabled: showFetchIndicator,
    applySourceSwitchGrace,
  });

  // Memoized callbacks
  const handleSelectArticle = useCallback(
    (hash: string) => {
      selectArticle(hash);
    },
    [selectArticle]
  );

  const formatDateDisplay = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Hide the redundant "today" label because the row already shows the time.
    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);

    if (compareDate.getTime() === today.getTime()) {
      return '';
    } else if (compareDate.getTime() === yesterday.getTime()) {
      return 'yesterday';
    } else {
      return date.toLocaleDateString();
    }
  }, []);

  useArticleListKeyboardNavigation({
    articleListRef,
    filteredArticles,
    activeArticleHash,
    articleViewOverlayPhase,
    selectArticle,
    setActiveArticle,
    ensureHashInView,
  });

  useArticleListScrollReset({
    sourceKey,
    filteredCount: filteredArticles.length,
    articleListItemsRef,
    rowVirtualizer,
    setHasListScrollOffset,
  });

  const requestLoadMoreArticles = useCallback((lastVisibleIndex: number) => {
    if (!shouldTriggerArticleListLoadMore(
      filteredArticles.length,
      articlesTotalCount,
      lastVisibleIndex,
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

  const handleArticleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const scrollElement = event.currentTarget;
    const { scrollTop } = scrollElement;
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
    syncViewportSnapshot(!isScrolled, true);

    if (
      !isSearchDebouncePending
      && shouldTriggerArticleListLoadMoreFromScroll(scrollElement, filteredArticles.length, articlesTotalCount)
    ) {
      requestLoadMoreArticles(lastVirtualIndex);
    }
  }, [
    articlesTotalCount,
    filteredArticles.length,
    isSearchDebouncePending,
    lastVirtualIndex,
    requestLoadMoreArticles,
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

  const isInitialLoading = isListLoading && sourceArticles.length === 0;
  const hasStoredArticles = sourceArticles.length > 0;
  const showBlockingError = !!error && !hasStoredArticles;
  const shouldShowHeaderLoader = isInitialLoading || (showFetchIndicator && isFetchIndicatorVisible);
  const headerLoaderLabel = isInitialLoading ? 'Loading articles' : 'Fetching latest articles';
  const titleSectionClassName = `article-list-title-section ${hasListScrollOffset ? 'article-list-title-section-scrolled' : ''}`;
  const { handleListProfilerRender, handleScrollPerformanceEvent } = useArticleListPerformanceMetrics({
    sourceKey,
    sourceLabel: selectedFeedTitle,
    variant,
    filteredCount: filteredArticles.length,
    visibleRowCount: virtualItems.length,
    totalVirtualSizePx: rowVirtualizer.getTotalSize(),
    isSearchActive,
    isFetchingNew: isGlobalLoadingIndicatorActive,
    isLoadingMoreArticles,
    articleListItemsRef,
  });


  if (showBlockingError) {
    return (
      <div ref={articleListRef} className="article-list" style={widthStyle}>
        {showResizeHandle && (
          <div className={`article-list-resize-handle ${isDragging ? 'is-dragging' : ''}`} onMouseDown={handleBorderMouseDown} />
        )}
        <div className={titleSectionClassName} data-section="article-list-title">
          <ArticleListWidgets
            onToggleSearch={handleToggleSearch}
            isSavedView={isSavedView}
          />
          <div className="article-list-title-content">
            <ArticleListSearchInput
              isOpen={isSearchOpen}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              onClose={handleCloseSearch}
              ignoredOutsideClickRef={articleListRef}
            />
          </div>
        </div>
        <div className="article-list-error">
          <p className="theme-text-danger">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <InteractionProfiler id={`article-list:${sourceKey}:${navigationNonce}`} onRender={handleListProfilerRender}>
      <div ref={articleListRef} className="article-list" style={widthStyle}>
        {showResizeHandle && (
          <div className={`article-list-resize-handle ${isDragging ? 'is-dragging' : ''}`} onMouseDown={handleBorderMouseDown} />
        )}
        <div className={titleSectionClassName} data-section="article-list-title">
          <ArticleListWidgets
            onToggleSearch={handleToggleSearch}
            isSavedView={isSavedView}
          />
          <div className="article-list-title-content">
            <motion.div
              className="article-list-fixed-loader-shell"
              initial={false}
              animate={{
                opacity: shouldShowHeaderLoader ? 1 : 0,
                y: shouldShowHeaderLoader ? 0 : -14,
              }}
              transition={{ duration: TITLE_LOADER_FOLD_ANIMATION_SECONDS, ease: 'easeInOut' }}
              aria-hidden={!shouldShowHeaderLoader}
            >
              <div className="article-list-fixed-loader">
                <FeedLineLoader
                  size={18}
                  variant="ring"
                  color="var(--theme-primary-color)"
                  ariaLabel={headerLoaderLabel}
                />
              </div>
            </motion.div>
            <ArticleListSearchInput
              isOpen={isSearchOpen}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              onClose={handleCloseSearch}
              ignoredOutsideClickRef={articleListRef}
            />
            {isInitialLoading ? (
              <ArticleListHeaderSkeleton />
            ) : (
              (selectedFeedId || selectedTag || selectedSmartView) && (
                <>
                  <h2 className="article-list-title">{selectedFeedTitle}</h2>
                  <p className="article-list-subtitle">{subtitleText}</p>
                </>
              )
            )}
          </div>
        </div>

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
                      isActive={activeArticleHash === article.hash}
                      isNew={newArticleHashes.has(article.hash)}
                      newAnimationOrder={newArticleAnimationOrderMap.get(article.hash) ?? -1}
                      readStateMode={isSavedView ? 'none' : 'normal'}
                      searchQuery={debouncedSearchQuery}
                      deferPreviewImages={deferPreviewImages}
                      onSelect={handleSelectArticle}
                      formatDateDisplay={formatDateDisplay}
                      enableLayoutAnimation={false}
                    />
                  </div>
                );
              })}
              {/* Keep a literal trailing block inside the virtual canvas so the
                  spacer only appears once users reach the actual bottom. */}
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
      </div>
    </InteractionProfiler>
  );
};
