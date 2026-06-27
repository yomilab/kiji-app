import { describe, expect, it } from 'vitest';
import {
  shouldScrollArticleIndexIntoView,
  shouldScrollKeyboardFocusIntoView,
} from '@/components/MainArea/articleListScrollIntoView';

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

describe('shouldScrollKeyboardFocusIntoView', () => {
  const rows = [
    { index: 0, start: 0, end: 112 },
    { index: 1, start: 112, end: 224 },
    { index: 2, start: 224, end: 336 },
    { index: 3, start: 336, end: 448 },
    { index: 4, start: 448, end: 560 },
  ];

  it('skips scroll when the focused row is inside the viewport', () => {
    expect(shouldScrollKeyboardFocusIntoView(1, 0, 400, rows)).toBe(false);
    expect(shouldScrollKeyboardFocusIntoView(2, 100, 400, rows)).toBe(false);
  });

  it('scrolls when the focused row is below the viewport', () => {
    expect(shouldScrollKeyboardFocusIntoView(4, 0, 300, rows)).toBe(true);
  });

  it('scrolls when the focused row is above the viewport', () => {
    expect(shouldScrollKeyboardFocusIntoView(0, 250, 300, rows)).toBe(true);
  });

  it('scrolls when the row is only in virtualizer overscan, not the viewport', () => {
    // Index 3 is rendered below a 300px viewport starting at scrollTop 0 (only 0-2 fully visible)
    expect(shouldScrollKeyboardFocusIntoView(3, 0, 300, rows)).toBe(true);
    // Virtualizer range might include index 3 as "visible" — keyboard path must still scroll
    expect(shouldScrollArticleIndexIntoView(3, 0, 4, 1)).toBe(false);
  });

  it('scrolls when the focused row is not mounted yet', () => {
    expect(shouldScrollKeyboardFocusIntoView(12, 0, 400, rows)).toBe(true);
  });
});
