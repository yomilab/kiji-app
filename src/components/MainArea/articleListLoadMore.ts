export const ARTICLE_LIST_ESTIMATED_ROW_HEIGHT = 112;
export const ARTICLE_LIST_BOTTOM_SPACER_HEIGHT = 50;
export const ARTICLE_LIST_PREFETCH_MAX_REMAINING_ROWS = 80;
export const ARTICLE_LIST_PREFETCH_MIN_REMAINING_ROWS = 40;
export const ARTICLE_LIST_CRITICAL_MAX_REMAINING_ROWS = 24;
export const ARTICLE_LIST_CRITICAL_MIN_REMAINING_ROWS = 12;
/** ~1 row — floor so tiny viewports still prefetch before the hard stop. */
export const ARTICLE_LIST_SCROLL_LOAD_MIN_DISTANCE_PX = ARTICLE_LIST_ESTIMATED_ROW_HEIGHT;
/** ~5 rows — cap so tall windows do not prefetch unbounded screens ahead. */
export const ARTICLE_LIST_SCROLL_LOAD_MAX_DISTANCE_PX = ARTICLE_LIST_ESTIMATED_ROW_HEIGHT * 5;
/** Prefetch when within this many viewport heights of the loaded bottom. */
export const ARTICLE_LIST_SCROLL_LOAD_VIEWPORT_FACTOR = 1.5;

export type ArticleListLoadMorePriority = 'prefetch' | 'urgent';

/**
 * Distance from the loaded scroll bottom that should start prefetch.
 * Scales with the list viewport (short windows) and caps on tall layouts.
 */
export const getArticleListScrollLoadDistancePx = (viewportHeightPx: number): number => {
  const safeViewportHeight = Math.max(0, viewportHeightPx);
  const viewportBasedDistance = Math.ceil(safeViewportHeight * ARTICLE_LIST_SCROLL_LOAD_VIEWPORT_FACTOR);

  return Math.min(
    ARTICLE_LIST_SCROLL_LOAD_MAX_DISTANCE_PX,
    Math.max(ARTICLE_LIST_SCROLL_LOAD_MIN_DISTANCE_PX, viewportBasedDistance),
  );
};

export const getArticleListPrefetchRemainingRows = (loadedRowCount: number): number => {
  const dynamicThreshold = Math.floor(loadedRowCount * 0.35);
  return Math.min(
    ARTICLE_LIST_PREFETCH_MAX_REMAINING_ROWS,
    Math.max(ARTICLE_LIST_PREFETCH_MIN_REMAINING_ROWS, dynamicThreshold),
  );
};

export const getArticleListCriticalRemainingRows = (loadedRowCount: number): number => {
  const dynamicThreshold = Math.floor(loadedRowCount * 0.12);
  return Math.min(
    ARTICLE_LIST_CRITICAL_MAX_REMAINING_ROWS,
    Math.max(ARTICLE_LIST_CRITICAL_MIN_REMAINING_ROWS, dynamicThreshold),
  );
};

export const getRemainingLoadedRows = (
  loadedRowCount: number,
  lastVisibleIndex: number,
): number => {
  if (loadedRowCount === 0 || lastVisibleIndex < 0) {
    return loadedRowCount;
  }

  return loadedRowCount - 1 - lastVisibleIndex;
};

export const getArticleListLoadMorePriority = (
  loadedRowCount: number,
  lastVisibleIndex: number,
): ArticleListLoadMorePriority => {
  const remainingLoadedRows = getRemainingLoadedRows(loadedRowCount, lastVisibleIndex);
  const criticalRemainingRows = getArticleListCriticalRemainingRows(loadedRowCount);

  return remainingLoadedRows <= criticalRemainingRows ? 'urgent' : 'prefetch';
};

export const shouldTriggerArticleListLoadMore = (
  loadedRowCount: number,
  totalRowCount: number,
  lastVisibleIndex: number,
): boolean => {
  if (loadedRowCount >= totalRowCount) {
    return false;
  }

  const remainingLoadedRows = getRemainingLoadedRows(loadedRowCount, lastVisibleIndex);
  const prefetchRemainingRows = getArticleListPrefetchRemainingRows(loadedRowCount);
  const criticalRemainingRows = getArticleListCriticalRemainingRows(loadedRowCount);

  return remainingLoadedRows <= prefetchRemainingRows
    || remainingLoadedRows <= criticalRemainingRows;
};

export const getDistanceFromScrollBottom = (scrollElement: HTMLElement): number => (
  scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
);

export const shouldTriggerArticleListLoadMoreFromScroll = (
  scrollElement: HTMLElement,
  loadedRowCount: number,
  totalRowCount: number,
): boolean => {
  if (loadedRowCount >= totalRowCount) {
    return false;
  }

  const triggerDistancePx = getArticleListScrollLoadDistancePx(scrollElement.clientHeight);
  return getDistanceFromScrollBottom(scrollElement) <= triggerDistancePx;
};
