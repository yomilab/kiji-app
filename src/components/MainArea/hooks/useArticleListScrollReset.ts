import { useCallback, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useDependencyEffect, useLayoutDependencyEffect } from '@/hooks/useLifecycleEffects';

interface RowVirtualizerLike {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'center' | 'end' | 'start' }) => void;
}

interface UseArticleListScrollResetOptions {
  sourceKey: string;
  filteredCount: number;
  articleListItemsRef: RefObject<HTMLDivElement>;
  rowVirtualizer: RowVirtualizerLike;
  setHasListScrollOffset: Dispatch<SetStateAction<boolean>>;
  isInitialLoading?: boolean;
}

export const useArticleListScrollReset = ({
  sourceKey,
  filteredCount,
  articleListItemsRef,
  rowVirtualizer,
  setHasListScrollOffset,
  isInitialLoading = false,
}: UseArticleListScrollResetOptions): void => {
  const currentSourceKeyRef = useRef(sourceKey);
  const resetFrameRef = useRef<number | null>(null);

  const resetScrollPosition = useCallback((): boolean => {
    const listElement = articleListItemsRef.current;
    if (!listElement) return false;

    listElement.scrollTop = 0;
    if (filteredCount > 0) {
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
    setHasListScrollOffset(false);
    return true;
  }, [articleListItemsRef, filteredCount, rowVirtualizer, setHasListScrollOffset]);

  // overflow:hidden does not zero leftover scrollTop; abspos skeleton would still shift.
  useLayoutDependencyEffect(() => {
    if (!isInitialLoading) return;
    const listElement = articleListItemsRef.current;
    if (!listElement) return;
    listElement.scrollTop = 0;
    setHasListScrollOffset(false);
  }, [articleListItemsRef, isInitialLoading, setHasListScrollOffset, sourceKey]);

  useDependencyEffect(() => {
    if (sourceKey === currentSourceKeyRef.current) return;

    currentSourceKeyRef.current = sourceKey;
    if (resetFrameRef.current !== null) {
      window.cancelAnimationFrame(resetFrameRef.current);
      resetFrameRef.current = null;
    }

    resetFrameRef.current = requestAnimationFrame(() => {
      resetFrameRef.current = null;
      resetScrollPosition();
    });

    return () => {
      if (resetFrameRef.current !== null) {
        window.cancelAnimationFrame(resetFrameRef.current);
        resetFrameRef.current = null;
      }
    };
  }, [resetScrollPosition, sourceKey]);
};
