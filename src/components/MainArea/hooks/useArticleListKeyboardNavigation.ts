import { useEffect, type RefObject } from 'react';
import type { Article } from '@/types/article';
import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';
import {
  isOpenArticleShortcut,
  isScrollDownShortcut,
  isScrollUpShortcut,
  isVimScrollBottomShortcut,
  isVimScrollHalfDownShortcut,
  isVimScrollHalfUpShortcut,
  isVimScrollTopKey,
  keybindingService,
} from '@/services/shortcuts/shortcutService';
import { animateElementScrollTop, getScrollableBottom } from '@/utils/fixedTimeScroll';

interface UseArticleListKeyboardNavigationOptions {
  articleListRef: RefObject<HTMLDivElement>;
  filteredArticles: Article[];
  activeArticleHash: string | null;
  articleViewOverlayPhase: ArticleViewOverlayPhase;
  selectArticle: (hash: string) => void;
  setActiveArticle: (hash: string | null) => void;
  ensureHashInView: (hash: string) => void;
}

export const useArticleListKeyboardNavigation = ({
  articleListRef,
  filteredArticles,
  activeArticleHash,
  articleViewOverlayPhase,
  selectArticle,
  setActiveArticle,
  ensureHashInView,
}: UseArticleListKeyboardNavigationOptions) => {
  useEffect(() => {
    const KEY_REPEAT_STEP_MS = 85;
    const VIM_SEQUENCE_TIMEOUT_MS = 700;
    let holdDirection: -1 | 1 | 0 = 0;
    let holdRafId: number | null = null;
    let lastStepAt = 0;
    let pendingTopSequenceTimerId: number | null = null;
    let cancelScrollAnimation: (() => void) | null = null;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const isArticleListCovered = (): boolean => articleViewOverlayPhase !== 'closed';

    const keepHashInView = (hash: string) => {
      ensureHashInView(hash);
    };

    const clearPendingTopSequence = () => {
      if (pendingTopSequenceTimerId !== null) {
        window.clearTimeout(pendingTopSequenceTimerId);
        pendingTopSequenceTimerId = null;
      }
    };

    const cancelActiveScrollAnimation = () => {
      if (cancelScrollAnimation) {
        cancelScrollAnimation();
        cancelScrollAnimation = null;
      }
    };

    const animateListTo = (top: number) => {
      const listElement = articleListRef.current?.querySelector<HTMLDivElement>('.article-list-items');
      if (!listElement) return;
      cancelActiveScrollAnimation();
      cancelScrollAnimation = animateElementScrollTop(listElement, top);
    };

    const animateListBy = (delta: number) => {
      const listElement = articleListRef.current?.querySelector<HTMLDivElement>('.article-list-items');
      if (!listElement) return;
      animateListTo(listElement.scrollTop + delta);
    };

    const handleVimScrollShortcut = (e: KeyboardEvent): boolean => {
      const listElement = articleListRef.current?.querySelector<HTMLDivElement>('.article-list-items');
      if (!listElement) return false;

      if (isVimScrollTopKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (pendingTopSequenceTimerId !== null) {
          clearPendingTopSequence();
          animateListTo(0);
          return true;
        }

        pendingTopSequenceTimerId = window.setTimeout(() => {
          pendingTopSequenceTimerId = null;
        }, VIM_SEQUENCE_TIMEOUT_MS);
        return true;
      }

      clearPendingTopSequence();

      if (isVimScrollBottomShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        animateListTo(getScrollableBottom(listElement));
        return true;
      }

      if (isVimScrollHalfDownShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        animateListBy(listElement.clientHeight / 2);
        return true;
      }

      if (isVimScrollHalfUpShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        animateListBy(-listElement.clientHeight / 2);
        return true;
      }

      return false;
    };

    const stepActiveArticle = (direction: -1 | 1) => {
      if (filteredArticles.length === 0) return;

      const currentIndex = activeArticleHash
        ? filteredArticles.findIndex((article) => article.hash === activeArticleHash)
        : -1;
      const fallbackIndex = direction > 0 ? 0 : filteredArticles.length - 1;
      const nextIndex = currentIndex === -1
        ? fallbackIndex
        : Math.max(0, Math.min(filteredArticles.length - 1, currentIndex + direction));

      const nextArticle = filteredArticles[nextIndex];
      if (!nextArticle) return;

      if (nextArticle.hash === activeArticleHash) {
        requestAnimationFrame(() => {
          keepHashInView(nextArticle.hash);
        });
        return;
      }

      setActiveArticle(nextArticle.hash);
      requestAnimationFrame(() => {
        keepHashInView(nextArticle.hash);
      });
    };

    const startHoldLoop = () => {
      if (holdRafId !== null) return;

      const loop = (now: number) => {
        if (holdDirection === 0) {
          holdRafId = null;
          return;
        }

        if (lastStepAt === 0 || now - lastStepAt >= KEY_REPEAT_STEP_MS) {
          stepActiveArticle(holdDirection);
          lastStepAt = now;
        }

        holdRafId = requestAnimationFrame(loop);
      };

      holdRafId = requestAnimationFrame(loop);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!articleListRef.current) return;
      if (isEditableTarget(e.target)) return;
      if (isArticleListCovered()) return;

      if (handleVimScrollShortcut(e)) return;

      if (isOpenArticleShortcut(e)) {
        const activeHashInList = activeArticleHash && filteredArticles.some((article) => article.hash === activeArticleHash)
          ? activeArticleHash
          : null;
        const firstHash = filteredArticles[0]?.hash;

        if (!activeHashInList && firstHash) {
          e.preventDefault();
          setActiveArticle(firstHash);
          requestAnimationFrame(() => {
            keepHashInView(firstHash);
          });
          return;
        }

        if (activeHashInList) {
          e.preventDefault();
          selectArticle(activeHashInList);
        }
        return;
      }

      if (!isScrollDownShortcut(e) && !isScrollUpShortcut(e)) return;
      e.preventDefault();

      const direction: -1 | 1 = isScrollDownShortcut(e) ? 1 : -1;
      const isDirectionChanged = holdDirection !== direction;
      holdDirection = direction;

      if (!e.repeat || isDirectionChanged) {
        stepActiveArticle(direction);
        lastStepAt = performance.now();
      }

      startHoldLoop();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isArticleListCovered()) return;
      if (!isScrollDownShortcut(e) && !isScrollUpShortcut(e)) return;
      holdDirection = 0;
      lastStepAt = 0;
    };

    const unregisterKeyDown = keybindingService.register({
      type: 'keydown',
      priority: 8,
      handler: handleKeyDown,
    });
    const unregisterKeyUp = keybindingService.register({
      type: 'keyup',
      priority: 8,
      handler: handleKeyUp,
    });

    return () => {
      unregisterKeyDown();
      unregisterKeyUp();
      clearPendingTopSequence();
      cancelActiveScrollAnimation();
      if (holdRafId !== null) {
        cancelAnimationFrame(holdRafId);
      }
    };
  }, [articleListRef, filteredArticles, activeArticleHash, articleViewOverlayPhase, selectArticle, setActiveArticle, ensureHashInView]);
};
