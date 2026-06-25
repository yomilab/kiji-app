import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { useDependencyEffect } from '@/hooks/useLifecycleEffects';
import { ARTICLE_LIST_ESTIMATED_ROW_HEIGHT } from '../articleListLoadMore';

interface RowVirtualizerLike {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'center' | 'end' | 'start' }) => void;
}

interface ArticleListScrollRequestLike {
  revision: number;
  mode: 'top' | 'anchor';
  anchorHash: string | null;
  preserveScrollTop?: number;
  prependedItemCount?: number;
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

      if (scrollRequest.mode === 'top') {
        currentListElement.scrollTop = 0;
        if (filteredCount > 0) {
          rowVirtualizer.scrollToIndex(0, { align: 'start' });
        }
        setHasListScrollOffset(false);
        return;
      }

      if (typeof scrollRequest.preserveScrollTop === 'number') {
        const prependedDelta = (scrollRequest.prependedItemCount ?? 0) * ARTICLE_LIST_ESTIMATED_ROW_HEIGHT;
        currentListElement.scrollTop = scrollRequest.preserveScrollTop + prependedDelta;
        setHasListScrollOffset(currentListElement.scrollTop > 0);
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
