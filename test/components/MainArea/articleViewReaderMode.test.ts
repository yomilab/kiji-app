import { describe, expect, it } from 'vitest';
import {
  canRetryReaderFailure,
  isArticleReaderModeRenderable,
  READER_FEED_COPY_NOTE,
  readerFailureMessage,
} from '@/components/MainArea/articleViewReaderMode';

describe('isArticleReaderModeRenderable', () => {
  it('renders reader mode only after the embedded overlay is fully open', () => {
    expect(isArticleReaderModeRenderable('reader', 'opening', false)).toBe(false);
    expect(isArticleReaderModeRenderable('reader', 'closing', false)).toBe(false);
    expect(isArticleReaderModeRenderable('reader', 'open', false)).toBe(true);
  });

  it('allows reader mode immediately in standalone windows', () => {
    expect(isArticleReaderModeRenderable('reader', 'opening', true)).toBe(true);
  });

  it('keeps basic mode off the reader render path', () => {
    expect(isArticleReaderModeRenderable('basic', 'open', false)).toBe(false);
  });
});

describe('reader failure copy', () => {
  it('never shows raw status codes', () => {
    for (const failure of ['blocked', 'not-found', 'unreachable', 'unreadable'] as const) {
      expect(`${readerFailureMessage(failure)} ${READER_FEED_COPY_NOTE}`).not.toMatch(/\d{3}|Error/);
    }
  });

  it('only offers a retry for connection problems', () => {
    expect(canRetryReaderFailure('unreachable')).toBe(true);
    expect(canRetryReaderFailure('blocked')).toBe(false);
    expect(canRetryReaderFailure('not-found')).toBe(false);
    expect(canRetryReaderFailure('unreadable')).toBe(false);
  });
});
