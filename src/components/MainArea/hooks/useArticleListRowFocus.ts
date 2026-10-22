import { useEffect, useRef, type RefObject } from 'react';
import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';

const ROW_SELECTOR = '.article-list-item[data-entity-id]';

const findRow = (list: HTMLElement, hash: string): HTMLElement | null => {
  for (const row of list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    if (row.dataset.entityId === hash) return row;
  }
  return null;
};

/** Focus left the reader (now hidden) or nothing holds it: safe to take it back. */
const isFocusOrphaned = (): boolean => {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) return true;
  return active.closest('[data-section="article-layer"], [data-component="article-view"]') !== null;
};

/**
 * Keeps DOM focus in step with the list for keyboard and screen reader users:
 * - while a row has focus, j/k / arrow moves carry focus to the new row, so
 *   VoiceOver reads the row the highlight moved to;
 * - when the reader closes, focus returns to the article's row instead of
 *   falling to the page.
 */
export function useArticleListRowFocus(params: {
  listRef: RefObject<HTMLElement>;
  highlightedHash: string | null;
  activeArticleHash: string | null;
  overlayPhase: ArticleViewOverlayPhase;
  /** Changes when the mounted row window changes (virtualization). */
  mountedRowsKey: string;
}): void {
  const { listRef, highlightedHash, activeArticleHash, overlayPhase, mountedRowsKey } = params;
  const previousPhaseRef = useRef(overlayPhase);
  // The open article may be cleared as the reader closes; remember its row.
  const lastOpenHashRef = useRef<string | null>(activeArticleHash);
  if (activeArticleHash) lastOpenHashRef.current = activeArticleHash;

  useEffect(() => {
    const list = listRef.current;
    if (!list || !highlightedHash) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.matches(ROW_SELECTOR) || !list.contains(active)) return;
    if (active.dataset.entityId === highlightedHash) return;
    findRow(list, highlightedHash)?.focus({ preventScroll: true });
  }, [highlightedHash, listRef, mountedRowsKey]);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = overlayPhase;
    if (overlayPhase !== 'closed' || previousPhase === 'closed') return;
    const hash = activeArticleHash ?? lastOpenHashRef.current ?? highlightedHash;
    if (!hash) return;

    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list || !isFocusOrphaned()) return;
      findRow(list, hash)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
    // Only the phase edge matters; the hashes are read at that moment.
  }, [overlayPhase]);
}
