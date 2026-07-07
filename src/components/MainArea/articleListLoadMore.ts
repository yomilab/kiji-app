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
/** Downward scroll faster than ~900px/s counts as fast scroll. */
export const ARTICLE_LIST_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS = 0.9;
/** Ignore velocity samples older than this when estimating scroll speed. */
export const ARTICLE_LIST_FAST_SCROLL_SAMPLE_MAX_AGE_MS = 150;
/** Extra remaining-row budget while fast-scrolling near the loaded end. */
export const ARTICLE_LIST_FAST_SCROLL_PREFETCH_ROW_BOOST = 80;
/** Fast scroll can extend the pixel trigger up to ~12 row heights. */
export const ARTICLE_LIST_FAST_SCROLL_MAX_DISTANCE_PX = ARTICLE_LIST_ESTIMATED_ROW_HEIGHT * 12;
export const ARTICLE_LIST_FAST_SCROLL_DISTANCE_BOOST_FACTOR = 2.5;

export type ArticleListLoadMorePriority = 'prefetch' | 'urgent';

export type ArticleListScrollVelocitySample = {
  scrollTop: number;
  timestampMs: number;
};

export type ArticleListLoadMoreTriggerOptions = {
  scrollVelocityPxPerMs?: number;
};

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

export const measureArticleListScrollVelocity = (
  previous: ArticleListScrollVelocitySample | null,
  scrollTop: number,
  timestampMs: number,
): { velocityPxPerMs: number; sample: ArticleListScrollVelocitySample } => {
  const sample: ArticleListScrollVelocitySample = { scrollTop, timestampMs };

  if (!previous) {
    return { velocityPxPerMs: 0, sample };
  }

  const deltaMs = timestampMs - previous.timestampMs;
  if (deltaMs <= 0 || deltaMs > ARTICLE_LIST_FAST_SCROLL_SAMPLE_MAX_AGE_MS) {
    return { velocityPxPerMs: 0, sample };
  }

  const deltaTop = scrollTop - previous.scrollTop;
  if (deltaTop <= 0) {
    return { velocityPxPerMs: 0, sample };
  }

  return { velocityPxPerMs: deltaTop / deltaMs, sample };
};

export const getArticleListFastScrollPrefetchBoost = (
  velocityPxPerMs: number,
  prefetchRemainingRows: number,
  remainingLoadedRows: number,
): number => {
  if (velocityPxPerMs < ARTICLE_LIST_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS) {
    return 0;
  }

  // Only extend prefetch while the viewport is already approaching the loaded end.
  if (remainingLoadedRows > prefetchRemainingRows * 2) {
    return 0;
  }

  const velocityRatio = Math.min(
    1,
    (velocityPxPerMs - ARTICLE_LIST_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS)
      / ARTICLE_LIST_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS,
  );

  return Math.round(ARTICLE_LIST_FAST_SCROLL_PREFETCH_ROW_BOOST * velocityRatio);
};

export const getArticleListScrollLoadDistancePxForVelocity = (
  viewportHeightPx: number,
  scrollVelocityPxPerMs: number,
): number => {
  const baseDistancePx = getArticleListScrollLoadDistancePx(viewportHeightPx);
  if (scrollVelocityPxPerMs < ARTICLE_LIST_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS) {
    return baseDistancePx;
  }

  const velocityRatio = Math.min(
    ARTICLE_LIST_FAST_SCROLL_DISTANCE_BOOST_FACTOR - 1,
    scrollVelocityPxPerMs / ARTICLE_LIST_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS,
  );

  return Math.min(
    ARTICLE_LIST_FAST_SCROLL_MAX_DISTANCE_PX,
    Math.ceil(baseDistancePx * (1 + velocityRatio)),
  );
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
  options: ArticleListLoadMoreTriggerOptions = {},
): boolean => {
  if (loadedRowCount >= totalRowCount) {
    return false;
  }

  const remainingLoadedRows = getRemainingLoadedRows(loadedRowCount, lastVisibleIndex);
  const prefetchRemainingRows = getArticleListPrefetchRemainingRows(loadedRowCount);
  const criticalRemainingRows = getArticleListCriticalRemainingRows(loadedRowCount);
  const fastScrollBoost = getArticleListFastScrollPrefetchBoost(
    options.scrollVelocityPxPerMs ?? 0,
    prefetchRemainingRows,
    remainingLoadedRows,
  );

  return remainingLoadedRows <= prefetchRemainingRows + fastScrollBoost
    || remainingLoadedRows <= criticalRemainingRows;
};

export const getDistanceFromScrollBottom = (scrollElement: HTMLElement): number => (
  scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
);

export const shouldTriggerArticleListLoadMoreFromScroll = (
  scrollElement: HTMLElement,
  loadedRowCount: number,
  totalRowCount: number,
  scrollVelocityPxPerMs = 0,
): boolean => {
  if (loadedRowCount >= totalRowCount) {
    return false;
  }

  const triggerDistancePx = getArticleListScrollLoadDistancePxForVelocity(
    scrollElement.clientHeight,
    scrollVelocityPxPerMs,
  );
  return getDistanceFromScrollBottom(scrollElement) <= triggerDistancePx;
};
