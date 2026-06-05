import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { useDependencyEffect } from '@/hooks/useLifecycleEffects';

interface RowVirtualizerLike {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'center' | 'end' | 'start' }) => void;
}

interface ArticleListScrollRequestLike {
  revision: number;
  mode: 'top' | 'anchor';
  anchorHash: string | null;
}

interface UseArticleListBackgroundScrollSyncOptions {
  articleListItemsRef: RefObject<HTMLDivElement>;
  filteredCount: number;
  scrollRequest: ArticleListScrollRequestLike | null;
  rowVirtualizer: RowVirtualizerLike;
  ensureHashInView: (hash: string) => void;
  setHasListScrollOffset: Dispatch<SetStateAction<boolean>>;
}

export const useArticleListBackgroundScrollSync = ({
  articleListItemsRef,
  filteredCount,
  scrollRequest,
  rowVirtualizer,
  ensureHashInView,
  setHasListScrollOffset,
}: UseArticleListBackgroundScrollSyncOptions): void => {
  const lastAppliedRevisionRef = useRef<number | null>(null);

  useDependencyEffect(() => {
    if (!scrollRequest) {
      return;
    }
    if (lastAppliedRevisionRef.current === scrollRequest.revision) {
      return;
    }

    const listElement = articleListItemsRef.current;
    if (!listElement) {
      return;
    }

    requestAnimationFrame(() => {
      const currentListElement = articleListItemsRef.current;
      if (!currentListElement) {
        return;
      }
      lastAppliedRevisionRef.current = scrollRequest.revision;

      // Keep the visible viewport anchored after background inserts so users
      // either see the fresh top entries immediately or stay near their row.
      if (scrollRequest.mode === 'top') {
        currentListElement.scrollTop = 0;
        if (filteredCount > 0) {
          rowVirtualizer.scrollToIndex(0, { align: 'start' });
        }
        setHasListScrollOffset(false);
        return;
      }

      if (scrollRequest.anchorHash) {
        ensureHashInView(scrollRequest.anchorHash);
      }
      setHasListScrollOffset((currentListElement.scrollTop ?? 0) > 0);
    });
  }, [
    articleListItemsRef,
    ensureHashInView,
    filteredCount,
    rowVirtualizer,
    scrollRequest,
    setHasListScrollOffset,
  ]);
};
