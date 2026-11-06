import type { ReaderModeFailure } from '@/services/articles/readerModeService';
import { SHORTCUT_LABELS } from '@/services/shortcuts/shortcutService';
import { canRetryReaderFailure, READER_FEED_COPY_NOTE, readerFailureMessage } from './articleViewReaderMode';

interface ReaderFailureNoticeProps {
  failure: ReaderModeFailure;
  hasFeedCopy: boolean;
  onRetry: () => void;
  onOpenInBrowser?: () => void;
}

export function ReaderFailureNotice({ failure, hasFeedCopy, onRetry, onOpenInBrowser }: ReaderFailureNoticeProps) {
  const canRetry = canRetryReaderFailure(failure);
  return (
    <div className="reader-notice" role="status" data-reader-failure={failure}>
      <svg className="reader-notice-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.1" />
        <path d="M8 7.25v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="5.1" r="0.75" fill="currentColor" />
      </svg>
      <div className="reader-notice-body">
        <div className="reader-notice-text">
          <p className="reader-notice-title">{readerFailureMessage(failure)}</p>
          {hasFeedCopy ? <p className="reader-notice-detail">{READER_FEED_COPY_NOTE}</p> : null}
        </div>
        {canRetry || onOpenInBrowser ? (
          <div className="reader-notice-actions">
            {canRetry ? (
              <button type="button" className="reader-notice-action" onClick={onRetry}>
                Try again
              </button>
            ) : null}
            {onOpenInBrowser ? (
              <button
                type="button"
                className="reader-notice-action"
                aria-keyshortcuts={SHORTCUT_LABELS.OPEN_IN_BROWSER}
                onClick={onOpenInBrowser}
              >
                Open in Browser
                <kbd className="reader-notice-key" aria-hidden="true">{SHORTCUT_LABELS.OPEN_IN_BROWSER}</kbd>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
