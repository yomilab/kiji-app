import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useTransientNewArticleHashes } from '@/components/MainArea/hooks/useTransientNewArticleHashes';
import { useSourceSwitchGrace } from '@/components/MainArea/hooks/useSourceSwitchGrace';
import { useArticleListScrollReset } from '@/components/MainArea/hooks/useArticleListScrollReset';
import { useArticleListScrollOffsetSync } from '@/components/MainArea/hooks/useArticleListScrollOffsetSync';
import { useArticleListBackgroundScrollSync } from '@/components/MainArea/hooks/useArticleListBackgroundScrollSync';
import { useArticleListSearch } from '@/components/MainArea/hooks/useArticleListSearch';

describe('SharedArticleList hooks', () => {
  describe('useArticleListSearch', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears debounced highlights immediately when the search button closes the input', () => {
      const articleListRef = { current: document.createElement('div') } as RefObject<HTMLDivElement>;
      const { result } = renderHook(() => useArticleListSearch({
        articleListRef,
        totalFeeds: 1,
      }));

      act(() => {
        result.current.handleToggleSearch();
      });
      expect(result.current.isSearchOpen).toBe(true);

      act(() => {
        result.current.handleSearchChange('needle');
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current.searchQuery).toBe('needle');
      expect(result.current.debouncedSearchQuery).toBe('needle');

      act(() => {
        result.current.handleToggleSearch();
      });

      expect(result.current.isSearchOpen).toBe(false);
      expect(result.current.searchQuery).toBe('');
      expect(result.current.debouncedSearchQuery).toBe('');
    });
  });

  describe('useTransientNewArticleHashes', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears highlights immediately in saved view', () => {
      const { result, rerender } = renderHook(
        ({ isSavedView, hashes }) => useTransientNewArticleHashes(isSavedView, hashes),
        {
          initialProps: {
            isSavedView: false,
            hashes: new Set(['hash-1']),
          },
        }
      );

      expect(Array.from(result.current)).toEqual(['hash-1']);

      rerender({
        isSavedView: true,
        hashes: new Set(['hash-1']),
      });

      expect(result.current.size).toBe(0);
    });

    it('expires highlights after the timeout in common view', () => {
      const { result } = renderHook(() => useTransientNewArticleHashes(false, new Set(['hash-1'])));

      expect(Array.from(result.current)).toEqual(['hash-1']);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.size).toBe(0);
    });
  });

  describe('useSourceSwitchGrace', () => {
    it('triggers the grace callback once per actual source switch', () => {
      const applySourceSwitchGrace = vi.fn();
      const { rerender } = renderHook(
        ({ sourceKey }) => useSourceSwitchGrace({
          sourceKey,
          enabled: true,
          applySourceSwitchGrace,
        }),
        {
          initialProps: {
            sourceKey: 'feed:1',
          },
        }
      );

      expect(applySourceSwitchGrace).not.toHaveBeenCalled();

      rerender({ sourceKey: 'feed:1' });
      expect(applySourceSwitchGrace).not.toHaveBeenCalled();

      rerender({ sourceKey: 'feed:2' });
      expect(applySourceSwitchGrace).toHaveBeenCalledTimes(1);

      rerender({ sourceKey: 'feed:2' });
      expect(applySourceSwitchGrace).toHaveBeenCalledTimes(1);
    });
  });

  describe('useArticleListScrollReset', () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;

    beforeEach(() => {
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }) as typeof window.requestAnimationFrame;
    });

    afterEach(() => {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      vi.useRealTimers();
    });

    it('resets scroll on source switch via requestAnimationFrame', () => {
      const pendingFrames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        pendingFrames.push(callback);
        return pendingFrames.length;
      }) as typeof window.requestAnimationFrame;

      const scrollToIndex = vi.fn();
      const setHasListScrollOffset = vi.fn();
      const articleListItemsRef = {
        current: {
          scrollTop: 240,
        },
      } as RefObject<HTMLDivElement>;

      const { rerender } = renderHook(
        ({ sourceKey }) => useArticleListScrollReset({
          sourceKey,
          filteredCount: 3,
          articleListItemsRef,
          rowVirtualizer: { scrollToIndex },
          setHasListScrollOffset,
        }),
        {
          initialProps: {
            sourceKey: 'feed:1',
          },
        }
      );

      rerender({
        sourceKey: 'feed:2',
      });

      expect(articleListItemsRef.current?.scrollTop).toBe(240);
      expect(scrollToIndex).not.toHaveBeenCalled();

      act(() => {
        pendingFrames.at(-1)?.(0);
      });

      expect(articleListItemsRef.current?.scrollTop).toBe(0);
      expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' });
      expect(setHasListScrollOffset).toHaveBeenCalledWith(false);
    });

    it('does not let a stale reset frame from one source switch clear a newer source switch', () => {
      vi.useFakeTimers();
      const pendingFrames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        pendingFrames.push(callback);
        return pendingFrames.length;
      }) as typeof window.requestAnimationFrame;
      window.cancelAnimationFrame = ((frameId: number) => {
        pendingFrames[frameId - 1] = () => {};
      }) as typeof window.cancelAnimationFrame;

      const scrollToIndex = vi.fn();
      const setHasListScrollOffset = vi.fn();
      const articleListItemsRef = {
        current: {
          scrollTop: 240,
        },
      } as RefObject<HTMLDivElement>;

      const { rerender } = renderHook(
        ({ sourceKey }) => useArticleListScrollReset({
          sourceKey,
          filteredCount: 3,
          articleListItemsRef,
          rowVirtualizer: { scrollToIndex },
          setHasListScrollOffset,
        }),
        {
          initialProps: {
            sourceKey: 'feed:1',
          },
        }
      );

      rerender({
        sourceKey: 'feed:2',
      });
      rerender({
        sourceKey: 'feed:3',
      });

      articleListItemsRef.current!.scrollTop = 180;
      act(() => {
        pendingFrames[0]?.(0);
      });

      expect(articleListItemsRef.current?.scrollTop).toBe(180);
    });
  });

  describe('useArticleListScrollOffsetSync', () => {
    it('syncs the offset flag and viewport state from the current list scroll position', () => {
      const setHasListScrollOffset = vi.fn();
      const syncViewportSnapshot = vi.fn();
      const articleListItemsRef = {
        current: {
          scrollTop: 60,
        },
      } as RefObject<HTMLDivElement>;

        renderHook(() => useArticleListScrollOffsetSync({
          articleListItemsRef,
          sourceKey: 'feed:1',
          filteredCount: 5,
          isSearchActive: false,
          setHasListScrollOffset,
          syncViewportSnapshot,
        }));

      expect(setHasListScrollOffset).toHaveBeenCalledWith(true);
      expect(syncViewportSnapshot).toHaveBeenCalledWith(false, false, 60);
    });
  });

  describe('useArticleListBackgroundScrollSync', () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;

    beforeEach(() => {
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }) as typeof window.requestAnimationFrame;
    });

    afterEach(() => {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    });

    it('scrolls to the top when a top-aligned background request arrives', () => {
      const scrollToIndex = vi.fn();
      const ensureHashInView = vi.fn();
      const setHasListScrollOffset = vi.fn();
      const articleListItemsRef = {
        current: {
          scrollTop: 240,
        },
      } as RefObject<HTMLDivElement>;

      renderHook(() => useArticleListBackgroundScrollSync({
        articleListItemsRef,
        filteredCount: 4,
        scrollRequest: {
          revision: 1,
          mode: 'top',
          anchorHash: null,
        },
        rowVirtualizer: { scrollToIndex },
        ensureHashInView,
        setHasListScrollOffset,
      }));

      expect(articleListItemsRef.current?.scrollTop).toBe(0);
      expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' });
      expect(ensureHashInView).not.toHaveBeenCalled();
      expect(setHasListScrollOffset).toHaveBeenCalledWith(false);
    });

    it('preserves scroll offset when background inserts arrive away from the top', () => {
      const scrollToIndex = vi.fn();
      const ensureHashInView = vi.fn();
      const setHasListScrollOffset = vi.fn();
      const articleListItemsRef = {
        current: {
          scrollTop: 180,
        },
      } as RefObject<HTMLDivElement>;

      renderHook(() => useArticleListBackgroundScrollSync({
        articleListItemsRef,
        filteredCount: 8,
        scrollRequest: {
          revision: 2,
          mode: 'anchor',
          anchorHash: 'hash-2',
          preserveScrollTop: 180,
          prependedItemCount: 2,
        },
        rowVirtualizer: { scrollToIndex },
        ensureHashInView,
        setHasListScrollOffset,
      }));

      expect(articleListItemsRef.current?.scrollTop).toBe(180 + (2 * 112));
      expect(scrollToIndex).not.toHaveBeenCalled();
      expect(ensureHashInView).not.toHaveBeenCalled();
      expect(setHasListScrollOffset).toHaveBeenCalledWith(true);
    });

    it('does not replay an already-applied background scroll request on later rerenders', () => {
      const scrollToIndex = vi.fn();
      const ensureHashInView = vi.fn();
      const setHasListScrollOffset = vi.fn();
      const articleListItemsRef = {
        current: {
          scrollTop: 240,
        },
      } as RefObject<HTMLDivElement>;

      const { rerender } = renderHook(
        ({ filteredCount, ensureHashInViewMock }) => useArticleListBackgroundScrollSync({
          articleListItemsRef,
          filteredCount,
          scrollRequest: {
            revision: 3,
            mode: 'top',
            anchorHash: null,
          },
          rowVirtualizer: { scrollToIndex },
          ensureHashInView: ensureHashInViewMock,
          setHasListScrollOffset,
        }),
        {
          initialProps: {
            filteredCount: 4,
            ensureHashInViewMock: ensureHashInView,
          },
        }
      );

      expect(articleListItemsRef.current?.scrollTop).toBe(0);
      expect(scrollToIndex).toHaveBeenCalledTimes(1);

      articleListItemsRef.current!.scrollTop = 180;
      rerender({
        filteredCount: 4,
        ensureHashInViewMock: vi.fn(),
      });

      expect(articleListItemsRef.current?.scrollTop).toBe(180);
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(setHasListScrollOffset).toHaveBeenCalledTimes(1);
    });
  });
});
