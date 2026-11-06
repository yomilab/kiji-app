import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';
import type { ReaderModeFailure } from '@/services/articles/readerModeService';

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

const READER_FAILURE_MESSAGES: Record<ReaderModeFailure, string> = {
  blocked: 'We couldn’t load the full article from this site.',
  'not-found': 'This article is no longer on the site.',
  unreachable: 'We couldn’t reach this site.',
  unreadable: 'We couldn’t find the article text on this page.',
};

export const READER_FEED_COPY_NOTE = 'Showing the version from the feed.';

export const readerFailureMessage = (failure: ReaderModeFailure): string => READER_FAILURE_MESSAGES[failure];

/** Only a connection problem can clear up on its own; a block or missing page won't. */
export const canRetryReaderFailure = (failure: ReaderModeFailure): boolean => failure === 'unreachable';
