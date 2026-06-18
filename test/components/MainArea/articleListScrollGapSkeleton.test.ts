import { describe, expect, it } from 'vitest';
import {
  getArticleListScrollGapRowStartPx,
  getArticleListScrollGapSkeletonIndexes,
  getArticleListScrollViewportRowRange,
} from '@/components/MainArea/articleListScrollGapSkeleton';

describe('articleListScrollGapSkeleton', () => {
  it('derives the viewport row range from scroll offsets', () => {
    expect(getArticleListScrollViewportRowRange(1120, 560, 499)).toEqual({
      startIndex: 10,
      endIndex: 15,
    });
  });

  it('returns skeleton indexes for unmounted rows inside the viewport', () => {
    const mountedIndexes = new Set([10, 11, 12, 13, 14, 15]);

    expect(getArticleListScrollGapSkeletonIndexes({
      scrollTopPx: 1120,
      viewportHeightPx: 560,
      scrollHeightPx: 60000,
      loadedRowCount: 400,
      totalRowCount: 3000,
      mountedIndexes,
    })).toEqual([]);
  });

  it('fills the viewport gap when fast scroll outruns virtualizer mounting', () => {
    const mountedIndexes = new Set([10, 11, 12]);

    expect(getArticleListScrollGapSkeletonIndexes({
      scrollTopPx: 1120,
      viewportHeightPx: 560,
      scrollHeightPx: 60000,
      loadedRowCount: 400,
      totalRowCount: 3000,
      mountedIndexes,
    })).toEqual([13, 14, 15]);
  });

  it('extends tail skeleton indexes near the loaded bottom while more articles exist', () => {
    const mountedIndexes = new Set(Array.from({ length: 400 }, (_, index) => index));

    expect(getArticleListScrollGapSkeletonIndexes({
      scrollTopPx: 44000,
      viewportHeightPx: 857,
      scrollHeightPx: 45000,
      loadedRowCount: 400,
      totalRowCount: 3000,
      mountedIndexes,
    }).slice(0, 4)).toEqual([400, 401]);
  });

  it('positions tail gap rows after the measured loaded block', () => {
    expect(getArticleListScrollGapRowStartPx(402, 400, 44800)).toBe(45024);
  });
});
