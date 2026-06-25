import { describe, expect, it } from 'vitest';
import { shouldScrollArticleIndexIntoView } from '@/components/MainArea/articleListScrollIntoView';

describe('shouldScrollArticleIndexIntoView', () => {
  it('skips scroll when the row is already visible', () => {
    expect(shouldScrollArticleIndexIntoView(2, 0, 8)).toBe(false);
    expect(shouldScrollArticleIndexIntoView(0, 0, 8)).toBe(false);
    expect(shouldScrollArticleIndexIntoView(8, 0, 8)).toBe(false);
  });

  it('scrolls when the row is outside the visible range', () => {
    expect(shouldScrollArticleIndexIntoView(12, 0, 8)).toBe(true);
    expect(shouldScrollArticleIndexIntoView(0, 4, 8)).toBe(true);
  });

  it('respects padding around the visible window', () => {
    expect(shouldScrollArticleIndexIntoView(2, 4, 8, 1)).toBe(true);
    expect(shouldScrollArticleIndexIntoView(4, 4, 8, 1)).toBe(false);
  });
});
