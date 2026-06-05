import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';

interface UseArticleListScrollOffsetSyncOptions {
  articleListItemsRef: RefObject<HTMLDivElement>;
  sourceKey: string;
  filteredCount: number;
  isSearchActive: boolean;
  setHasListScrollOffset: Dispatch<SetStateAction<boolean>>;
  syncViewportSnapshot: (isAtTop: boolean) => void;
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
    const isAtTop = (listElement?.scrollTop ?? 0) <= 0;
    setHasListScrollOffset(!isAtTop);
    syncViewportSnapshot(isAtTop);
  }, [
    articleListItemsRef,
    sourceKey,
    filteredCount,
    isSearchActive,
    setHasListScrollOffset,
    syncViewportSnapshot,
  ]);
};
