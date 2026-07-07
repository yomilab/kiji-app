import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';

interface UseArticleListScrollOffsetSyncOptions {
  articleListItemsRef: RefObject<HTMLDivElement>;
  sourceKey: string;
  filteredCount: number;
  isSearchActive: boolean;
  setHasListScrollOffset: Dispatch<SetStateAction<boolean>>;
  syncViewportSnapshot: (isAtTop: boolean, isScrolling?: boolean, scrollTop?: number) => void;
}

export const useArticleListScrollOffsetSync = ({
  articleListItemsRef,
  sourceKey,
  filteredCount,
  isSearchActive,
  setHasListScrollOffset,
  syncViewportSnapshot,
}: UseArticleListScrollOffsetSyncOptions): void => {
  useDependencyEffect(() => {
    const listElement = articleListItemsRef.current;
    const scrollTop = listElement?.scrollTop ?? 0;
    const isAtTop = scrollTop <= 0;
    setHasListScrollOffset(!isAtTop);
    syncViewportSnapshot(isAtTop, false, scrollTop);
  }, [
    articleListItemsRef,
    sourceKey,
    filteredCount,
    isSearchActive,
    setHasListScrollOffset,
    syncViewportSnapshot,
  ]);
};
