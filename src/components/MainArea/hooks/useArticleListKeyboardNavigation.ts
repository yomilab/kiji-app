import { useEffect, useRef, type RefObject } from 'react';
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
import { resolveArticleListFocusHash, resolveArticleListFocusIndex } from '../articleListKeyboardFocus';

interface UseArticleListKeyboardNavigationOptions {
  articleListRef: RefObject<HTMLDivElement>;
  filteredArticles: Article[];
  keyboardFocusHash: string | null;
  activeArticleHash: string | null;
  articleViewOverlayPhase: ArticleViewOverlayPhase;
  selectArticle: (hash: string) => void;
  setKeyboardFocusHash: (hash: string | null) => void;
  scrollKeyboardFocusIntoView: (hash: string) => void;
}

export const useArticleListKeyboardNavigation = ({
  articleListRef,
  filteredArticles,
  keyboardFocusHash,
  activeArticleHash,
  articleViewOverlayPhase,
  selectArticle,
  setKeyboardFocusHash,
  scrollKeyboardFocusIntoView,
}: UseArticleListKeyboardNavigationOptions) => {
  const keyboardFocusHashRef = useRef(keyboardFocusHash);
  keyboardFocusHashRef.current = keyboardFocusHash;

  const activeArticleHashRef = useRef(activeArticleHash);
  activeArticleHashRef.current = activeArticleHash;

  const filteredArticlesRef = useRef(filteredArticles);
  filteredArticlesRef.current = filteredArticles;

  const articleViewOverlayPhaseRef = useRef(articleViewOverlayPhase);
  articleViewOverlayPhaseRef.current = articleViewOverlayPhase;

  const selectArticleRef = useRef(selectArticle);
  selectArticleRef.current = selectArticle;

  const setKeyboardFocusHashRef = useRef(setKeyboardFocusHash);
  setKeyboardFocusHashRef.current = setKeyboardFocusHash;

  const scrollKeyboardFocusIntoViewRef = useRef(scrollKeyboardFocusIntoView);
  scrollKeyboardFocusIntoViewRef.current = scrollKeyboardFocusIntoView;

  const focusIndexRef = useRef(-1);

  useEffect(() => {
    focusIndexRef.current = resolveArticleListFocusIndex(
      filteredArticles,
      keyboardFocusHash,
      activeArticleHash,
    );
  }, [keyboardFocusHash, activeArticleHash, filteredArticles]);

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

    const isArticleListCovered = (): boolean => articleViewOverlayPhaseRef.current !== 'closed';

    const keepHashInView = (hash: string) => {
      scrollKeyboardFocusIntoViewRef.current(hash);
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

    const resolveCurrentFocusIndex = (): number => {
      const resolved = resolveArticleListFocusIndex(
        filteredArticlesRef.current,
        keyboardFocusHashRef.current,
        activeArticleHashRef.current,
      );
      if (resolved >= 0) {
        focusIndexRef.current = resolved;
      }
      return resolved;
    };

    const stepActiveArticle = (direction: -1 | 1) => {
      const articles = filteredArticlesRef.current;
      if (articles.length === 0) return;

      const currentIndex = focusIndexRef.current >= 0
        ? focusIndexRef.current
        : resolveCurrentFocusIndex();
      const fallbackIndex = direction > 0 ? 0 : articles.length - 1;
      const nextIndex = currentIndex === -1
        ? fallbackIndex
        : Math.max(0, Math.min(articles.length - 1, currentIndex + direction));

      const nextArticle = articles[nextIndex];
      if (!nextArticle) return;

      const focusedHash = resolveArticleListFocusHash(
        keyboardFocusHashRef.current,
        activeArticleHashRef.current,
      );
      if (nextArticle.hash === focusedHash) {
        requestAnimationFrame(() => {
          keepHashInView(nextArticle.hash);
        });
        return;
      }

      focusIndexRef.current = nextIndex;
      keyboardFocusHashRef.current = nextArticle.hash;
      setKeyboardFocusHashRef.current(nextArticle.hash);
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
        const articles = filteredArticlesRef.current;
        const focusedHash = resolveArticleListFocusHash(
          keyboardFocusHashRef.current,
          activeArticleHashRef.current,
        );
        const resolvedFocusHash = focusedHash && articles.some((article) => article.hash === focusedHash)
          ? focusedHash
          : null;
        const firstHash = articles[0]?.hash;

        if (!resolvedFocusHash && firstHash) {
          e.preventDefault();
          focusIndexRef.current = 0;
          keyboardFocusHashRef.current = firstHash;
          setKeyboardFocusHashRef.current(firstHash);
          requestAnimationFrame(() => {
            keepHashInView(firstHash);
          });
          return;
        }

        if (resolvedFocusHash) {
          e.preventDefault();
          selectArticleRef.current(resolvedFocusHash);
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
  }, [articleListRef]);
};
