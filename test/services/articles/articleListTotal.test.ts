import { describe, expect, it } from 'vitest';
import { articleListHasMore, resolveDeferredPageTotal } from '@/services/articles/articleListTotal';

describe('articleListTotal', () => {
  it('keeps hasMore true for a full unknown page even when loaded === floor total', () => {
    expect(articleListHasMore({
      loadedCount: 100,
      totalCount: 100,
      totalKnown: false,
      pageWasFull: true,
    })).toBe(true);
  });

  it('stops hasMore after an exact COUNT or a short page', () => {
    expect(articleListHasMore({
      loadedCount: 100,
      totalCount: 100,
      totalKnown: true,
      pageWasFull: false,
    })).toBe(false);
    expect(articleListHasMore({
      loadedCount: 40,
      totalCount: 77129,
      totalKnown: true,
      pageWasFull: true,
    })).toBe(true);
  });

  it('treats a short deferred page as exact and a full page as unknown', () => {
    expect(resolveDeferredPageTotal(37, 100)).toEqual({
      total: 37,
      totalKnown: true,
      pageWasFull: false,
    });
    expect(resolveDeferredPageTotal(100, 100)).toEqual({
      total: 100,
      totalKnown: false,
      pageWasFull: true,
    });
  });
});
