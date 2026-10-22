import { useLayoutEffect, type RefObject } from 'react';
import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';

const setInert = (element: HTMLElement | null, inert: boolean): void => {
  if (!element) return;
  element.toggleAttribute('inert', inert);
};

/**
 * The deck keeps every layer mounted and only slides them. Layers that are off
 * screen or covered must also be out of the Tab order and hidden from
 * VoiceOver: the reader while it is closed, the sidebar and list while the
 * reader covers them. During the close slide the list is live again so focus
 * can return to the article's row.
 */
export function useDeckLayerInert(params: {
  libraryLayerRefs: ReadonlyArray<RefObject<HTMLElement>>;
  articleLayerRef: RefObject<HTMLElement>;
  overlayPhase: ArticleViewOverlayPhase;
  isDeckOpen: boolean;
}): void {
  const { libraryLayerRefs, articleLayerRef, overlayPhase, isDeckOpen } = params;
  const libraryCovered = overlayPhase === 'opening' || overlayPhase === 'open';
  const readerHidden = overlayPhase === 'closed' && !isDeckOpen;

  useLayoutEffect(() => {
    for (const ref of libraryLayerRefs) setInert(ref.current, libraryCovered);
    setInert(articleLayerRef.current, readerHidden);
  });
}
