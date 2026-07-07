import { describe, expect, it } from 'vitest';
import { isArticleReaderModeRenderable } from '@/components/MainArea/articleViewReaderMode';

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
