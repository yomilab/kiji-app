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
  getShortcutPriorityLayer,
  keybindingService,
} from '@/services/shortcuts/shortcutService';
import { animateElementScrollTop, getScrollableBottom } from '@/utils/fixedTimeScroll';
import { recordRobustnessEvent } from '@/services/diagnostics/robustnessMetrics';
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
    // Fallback delay to arm RAF-driven repeat ONLY if the OS never sends a
    // repeat keydown (e.g., key repeat disabled). Deliberately longer than a
    // normal tap so a single press never yields a second step. The "sometimes
    // moves 2" bug came from stepping on a fixed timer that a slow tap could
    // cross; we now let the OS's own e.repeat signal decide tap-vs-hold.
    const KEY_REPEAT_FALLBACK_DELAY_MS = 450;
    const VIM_SEQUENCE_TIMEOUT_MS = 700;
    let holdDirection: -1 | 1 | 0 = 0;
    let holdRafId: number | null = null;
    // RAF repeat is armed only after the OS confirms a hold (e.repeat) or the
    // fallback timer fires. A tap never arms it, so a tap is always one step.
    let holdArmed = false;
    let nextStepAt = 0;
    let armFallbackTimerId: number | null = null;
    let pendingTopSequenceTimerId: number | null = null;
    let cancelScrollAnimation: (() => void) | null = null;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const isArticleListCovered = (): boolean => articleViewOverlayPhaseRef.current !== 'closed';

    // Keys a focused control handles itself: Space presses a button (toast
    // Undo, sidebar actions) and the arrows / Space move within the sidebar.
    const isOwnedByFocusedControl = (e: KeyboardEvent): boolean => {
      if (!(e.target instanceof Element)) return false;
      const isSpace = e.key === ' ' || e.code === 'Space';
      if (e.target.closest('[data-sidebar-nav-item]')) {
        return isSpace || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End';
      }
      return isSpace && e.target.closest('button, a[href], [role="button"], [role="link"]') !== null;
    };

    // Raw key match for hold release: deliberately ignores shortcut layer and
    // modifiers so a held j/k released under an overlay/modal or with
    // Cmd/Shift down still stops the hold loop.
    const isHoldStepKey = (e: KeyboardEvent): boolean => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return true;
      const key = e.key.toLowerCase();
      return key === 'j' || key === 'k';
    };

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

    const clearArmFallback = () => {
      if (armFallbackTimerId !== null) {
        window.clearTimeout(armFallbackTimerId);
        armFallbackTimerId = null;
      }
    };

    // Arm RAF-driven hold repeat. Called when the OS confirms a hold
    // (e.repeat) or when the fallback timer fires. Idempotent.
    const armHoldRepeat = () => {
      holdArmed = true;
      if (nextStepAt === 0) {
        nextStepAt = performance.now() + KEY_REPEAT_STEP_MS;
      }
      clearArmFallback();
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

    // `recordIfActive`: count a safety-net stop of an armed hold (cover, modal,
    // modifier keyup, blur, hidden, unmount). Taps and a plain keyup release of
    // a held key are the normal path and are not counted.
    const resetHold = (recordIfActive = false) => {
      if (recordIfActive && holdArmed && holdDirection !== 0) {
        recordRobustnessEvent('ui.keyboardHoldReset');
      }
      holdDirection = 0;
      holdArmed = false;
      nextStepAt = 0;
      clearArmFallback();
      if (holdRafId !== null) {
        cancelAnimationFrame(holdRafId);
        holdRafId = null;
      }
    };

    const startHoldLoop = () => {
      if (holdRafId !== null) return;

      const loop = (now: number) => {
        if (holdDirection === 0) {
          holdRafId = null;
          return;
        }

        // Article overlay or modal now covers the list: stop stepping. A new
        // keydown after the cover closes starts a fresh hold.
        if (isArticleListCovered() || getShortcutPriorityLayer() === 'modal') {
          holdRafId = null;
          resetHold(true);
          return;
        }

        // Only step once the hold is armed (OS e.repeat or fallback). A tap
        // never arms the loop, so it can't produce a second step here.
        if (holdArmed && now >= nextStepAt) {
          stepActiveArticle(holdDirection);
          nextStepAt = now + KEY_REPEAT_STEP_MS;
        }

        holdRafId = requestAnimationFrame(loop);
      };

      holdRafId = requestAnimationFrame(loop);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!articleListRef.current) return;
      if (isEditableTarget(e.target)) return;
      if (isArticleListCovered()) return;
      if (isOwnedByFocusedControl(e)) return;

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
        // Reset hold arming: a fresh press / direction change is treated as a
        // new tap until the OS confirms a hold via e.repeat.
        holdArmed = false;
        nextStepAt = 0;
      }

      if (e.repeat) {
        // OS confirms the key is held (not a tap) — arm RAF-driven repeat.
        armHoldRepeat();
      } else {
        // Fresh press: arm a fallback in case OS repeat never fires (e.g.,
        // key repeat disabled). Cleared by keyup or by armHoldRepeat.
        clearArmFallback();
        armFallbackTimerId = window.setTimeout(armHoldRepeat, KEY_REPEAT_FALLBACK_DELAY_MS);
      }

      startHoldLoop();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isHoldStepKey(e)) return;
      const isSafetyRelease = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey
        || isArticleListCovered() || getShortcutPriorityLayer() === 'modal';
      resetHold(isSafetyRelease);
    };

    // Keyup never arrives if focus leaves the window (Cmd+Tab) mid-hold.
    const handleWindowBlur = () => {
      resetHold(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetHold(true);
      }
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
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unregisterKeyDown();
      unregisterKeyUp();
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearPendingTopSequence();
      cancelActiveScrollAnimation();
      resetHold(true);
    };
  }, [articleListRef]);
};
