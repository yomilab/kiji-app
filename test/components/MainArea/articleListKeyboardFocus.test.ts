import { describe, expect, it } from 'vitest';
import {
  resolveArticleListFocusHash,
  resolveArticleListFocusIndex,
} from '@/components/MainArea/articleListKeyboardFocus';

const articles = [
  { hash: 'a' },
  { hash: 'b' },
  { hash: 'c' },
];

describe('articleListKeyboardFocus', () => {
  it('prefers keyboard focus over overlay active article', () => {
    expect(resolveArticleListFocusHash('b', 'c')).toBe('b');
    expect(resolveArticleListFocusIndex(articles, 'b', 'c')).toBe(1);
  });

  it('falls back to active article when keyboard focus is unset', () => {
    expect(resolveArticleListFocusHash(null, 'c')).toBe('c');
    expect(resolveArticleListFocusIndex(articles, null, 'c')).toBe(2);
  });

  it('returns -1 when no focus hash resolves in the list', () => {
    expect(resolveArticleListFocusIndex(articles, null, 'missing')).toBe(-1);
  });
});
