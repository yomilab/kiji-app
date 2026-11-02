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
  blocked: 'This site doesn’t let apps load its full articles.',
  'not-found': 'This article is no longer on the site.',
  unreachable: 'Couldn’t reach this site.',
  unreadable: 'Couldn’t find the article text on this page.',
};

export const readerFailureMessage = (failure: ReaderModeFailure, hasFeedCopy: boolean): string => (
  hasFeedCopy
    ? `${READER_FAILURE_MESSAGES[failure]} Showing the version from the feed.`
    : READER_FAILURE_MESSAGES[failure]
);

/** Only a connection problem can clear up on its own; a block or missing page won't. */
export const canRetryReaderFailure = (failure: ReaderModeFailure): boolean => failure === 'unreachable';
