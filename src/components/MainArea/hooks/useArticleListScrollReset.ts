import { useCallback, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';

interface RowVirtualizerLike {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'center' | 'end' | 'start' }) => void;
}

interface UseArticleListScrollResetOptions {
  sourceKey: string;
  filteredCount: number;
  articleListItemsRef: RefObject<HTMLDivElement>;
  rowVirtualizer: RowVirtualizerLike;
  setHasListScrollOffset: Dispatch<SetStateAction<boolean>>;
}

export const useArticleListScrollReset = ({
  sourceKey,
  filteredCount,
  articleListItemsRef,
  rowVirtualizer,
  setHasListScrollOffset,
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
