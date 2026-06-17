import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';

export type ArticleDisplayMode = 'basic' | 'reader';

/**
 * Reader-mode body work must not run during the deck slide (`opening` / `closing`).
 * Phase 2 post-open sync configures reader mode once the overlay is `open`.
 */
export const isArticleReaderModeRenderable = (
  displayMode: ArticleDisplayMode,
  overlayPhase: ArticleViewOverlayPhase | string,
  standalone: boolean,
): boolean => displayMode === 'reader' && (standalone || overlayPhase === 'open');
