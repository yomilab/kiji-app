import {
  ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
  getArticleListPhantomRowCount,
  getArticleListScrollLoadDistancePx,
} from './articleListLoadMore';

export const getArticleListScrollViewportRowRange = (
  scrollTopPx: number,
  viewportHeightPx: number,
  maxIndex: number,
  estimatedRowHeightPx = ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
): { startIndex: number; endIndex: number } => {
  if (maxIndex < 0 || viewportHeightPx <= 0) {
    return { startIndex: 0, endIndex: -1 };
  }

  const startIndex = Math.max(0, Math.floor(scrollTopPx / estimatedRowHeightPx));
  const endIndex = Math.min(
    maxIndex,
    Math.ceil((scrollTopPx + viewportHeightPx) / estimatedRowHeightPx),
  );

  return { startIndex, endIndex };
};

export const isArticleListScrollNearBottom = (
  scrollTopPx: number,
  scrollHeightPx: number,
  viewportHeightPx: number,
): boolean => {
  if (scrollHeightPx <= viewportHeightPx) {
    return true;
  }

  const distanceFromBottom = scrollHeightPx - scrollTopPx - viewportHeightPx;
  return distanceFromBottom <= getArticleListScrollLoadDistancePx(viewportHeightPx);
};

/**
 * Indexes that should be visible for the current scroll position but are not
 * mounted by the virtualizer yet — render skeleton rows at these positions.
 */
export const getArticleListScrollGapSkeletonIndexes = (options: {
  scrollTopPx: number;
  viewportHeightPx: number;
  scrollHeightPx: number;
  loadedRowCount: number;
  totalRowCount: number;
  mountedIndexes: ReadonlySet<number>;
  estimatedRowHeightPx?: number;
}): number[] => {
  const {
    scrollTopPx,
    viewportHeightPx,
    scrollHeightPx,
    loadedRowCount,
    totalRowCount,
    mountedIndexes,
    estimatedRowHeightPx = ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
  } = options;

  if (loadedRowCount === 0 || viewportHeightPx <= 0) {
    return [];
  }

  const hasMoreArticles = loadedRowCount < totalRowCount;
  const tailSkeletonCount = hasMoreArticles && isArticleListScrollNearBottom(
    scrollTopPx,
    scrollHeightPx,
    viewportHeightPx,
  )
    ? getArticleListPhantomRowCount(loadedRowCount, totalRowCount, viewportHeightPx)
    : 0;

  const maxRenderableIndex = loadedRowCount + Math.max(0, tailSkeletonCount) - 1;
  const { startIndex, endIndex } = getArticleListScrollViewportRowRange(
    scrollTopPx,
    viewportHeightPx,
    maxRenderableIndex,
    estimatedRowHeightPx,
  );

  if (endIndex < startIndex) {
    return [];
  }

  const maxFillRows = Math.ceil(viewportHeightPx / estimatedRowHeightPx) + 6;
  const gapIndexes: number[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (mountedIndexes.has(index)) {
      continue;
    }

    gapIndexes.push(index);
    if (gapIndexes.length >= maxFillRows) {
      break;
    }
  }

  return gapIndexes;
};

export const getArticleListScrollGapRowStartPx = (
  index: number,
  loadedRowCount: number,
  loadedTotalSizePx: number,
  estimatedRowHeightPx = ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
  getOffsetForIndex?: (index: number) => number,
): number => {
  if (index < loadedRowCount && getOffsetForIndex) {
    return getOffsetForIndex(index);
  }

  if (index < loadedRowCount) {
    return index * estimatedRowHeightPx;
  }

  return loadedTotalSizePx + (index - loadedRowCount) * estimatedRowHeightPx;
};
